// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The Preset render activities (ADR 0001: audio first, the video model never
 * speaks). Every Preset's render (workflows/render-preset.ts,
 * renderPreset) runs them in order:
 *
 *   fetchDraftAudio — read the approved draft's PRIVATE audio by key and measure it
 *   presetClip      — one silent clip from its start image (the shot's
 *                     starting frame, else the product photo), prompted by its
 *                     Preset for its shot kind (generate_audio: false), on the
 *                     video model its shot kind names (#25, ../video-models;
 *                     Seedance via EvoLink when it names none)
 *   presetMux       — hard-cut the clips, trim/hold the visuals to the audio's exact
 *                     length, and mux the draft audio in untouched (never trimmed,
 *                     never stretched)
 *
 * The persisted names still date from Product Hero, the first Preset, and stay
 * stable for existing rows and readers: primitive ids `product_hero_clip` and
 * `product_hero_mux` (captions/short-captions.ts in api-v2 reads the latter).
 *
 * Each writes its own primitive_runs row under the parent skill run. Only the
 * clips are charged, at their shot's price (@agentmedia/schema shotClipCredits:
 * the most its model chain charges — what the quote summed — whichever model ran). They are exempt from the
 * per-primitive cap (a 10 s clip alone exceeds it): the Preset's declared budget
 * (PresetDefinition.budget in @agentmedia/schema) governs the whole render, and
 * the shot plan is held to it by tests. The day cap still applies.
 *
 * Extension points (later tickets, deliberately not built here): the Music Bed
 * and Captions attach at the mux — a ducked bed as one more audio input, and
 * burned Captions as one more pass over the muxed Short.
 */

import { ApplicationFailure, Context } from '@temporalio/activity';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkerConfig } from '../config.js';
import { getDb } from '../client/db.js';
import { r2UploadVnext } from '../client/r2.js';
import { DRAFT_AUDIO, probeSeconds, readPrivateObject } from '../lib/media-io.js';
import { downloadProviderVideo } from '../lib/provider-video.js';
import { runChargedStep } from './charged-step.js';
import { modelClipUsd, modelTakesPersonImage, shotFrame, shotModelChain, shotVideo, type ShotVideo, type VideoModelId } from '@agentmedia/schema';
import { presetRender } from '../presets/index.js';
import { videoModel, type VideoModelClient } from '../video-models/index.js';
import { hasReferenceTokens } from '@agentmedia/shot-prompts';
import { PROVIDER_FAILED } from '../failure-policy.js';
import { providerFailure } from '../client/provider-failure.js';

const execFileP = promisify(execFile);

/** The 9:16 canvas every Preset Short is cut onto. */
const CANVAS = { w: 1080, h: 1920 };
const FPS = 30;

// ── fetchDraftAudio ──────────────────────────────────────────────────────────

export interface FetchDraftAudioInput {
  primitive_run_id: string;
  user_id: string;
  skill_run_id: string;
  draft_id: string;
  /** Private storage key of the draft's audio (short_drafts.audio_key). */
  audio_key: string;
  /** The duration stored on the draft (measured when it was voiced). */
  duration_ms: number;
}

export interface FetchDraftAudioResult {
  primitive_run_id: string;
  audio_key: string;
  /** Measured now, from the bytes that will be muxed. The cut is trimmed to this. */
  duration_ms: number;
}

export function makeFetchDraftAudioActivity(cfg: WorkerConfig) {
  return async function fetchDraftAudio(input: FetchDraftAudioInput): Promise<FetchDraftAudioResult> {
    const db = getDb(cfg.supabase.url, cfg.supabase.serviceRoleKey);
    const startedAt = new Date().toISOString();
    const bytes = await readPrivateObject(cfg, input.audio_key, DRAFT_AUDIO);

    const workDir = await mkdtemp(join(tmpdir(), `vnext-hero-audio-${input.primitive_run_id}-`));
    let durationMs: number;
    try {
      const audioPath = join(workDir, 'draft.mp3');
      await writeFile(audioPath, bytes);
      durationMs = Math.round((await probeSeconds(audioPath)) * 1000);
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }

    // The draft's audio is the Short's audio; record the step (free) under the run.
    const { error } = await db.from('primitive_runs').upsert(
      {
        id: input.primitive_run_id,
        user_id: input.user_id,
        skill_run_id: input.skill_run_id,
        primitive_id: 'draft_audio',
        status: 'succeeded',
        // The key is a server-side handle; the row is service-role only.
        input: { draft_id: input.draft_id, audio_key: input.audio_key, stored_duration_ms: input.duration_ms },
        estimated_credits_usd: 0,
        actual_credits_usd: 0,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
    if (error) throw new Error(`primitive_runs upsert failed: ${error.message}`);

    return { primitive_run_id: input.primitive_run_id, audio_key: input.audio_key, duration_ms: durationMs };
  };
}

// ── presetClip ──────────────────────────────────────────────────────────

export interface PresetClipInput {
  primitive_run_id: string;
  user_id: string;
  skill_run_id: string;
  /**
   * The R2-hosted image the shot is animated from (`@image1`): the shot's
   * starting frame if its kind has one (#18), else the product photo
   * (re-hosted and moderated by api-v2).
   */
  start_image_url: string;
  duration: 5 | 10;
  /** 0-based position of this shot in the Short, and how many shots it has. */
  shot_index: number;
  shot_count: number;
  /** The Preset rendering this shot, and the shot's kind in its plan. */
  preset: string;
  shot_kind: string;
  /**
   * The shot's Shot Prompt (#26): its scene plus the worker's Guardrails, with
   * the reference images as tokens (@agentmedia/shot-prompts REFERENCE_TOKENS),
   * which this activity swaps for the model's own syntax (client.promptFor).
   */
  prompt: string;
  /** Preset visuals are always silent: the draft audio is the only voice. */
  generate_audio: false;
  /**
   * R2-hosted reference of the person on screen (`@image2` in the prompt), set
   * only on shots that show a person (Reaction, #19), and only for a model
   * that takes a re-hosted face (ADR 0003: never ModelArk, which gets the
   * person in words instead). Never on a product shot.
   */
  character_image_url?: string;
  /**
   * Which model of the shot kind's chain renders this attempt (#25): the
   * kind's model, or its fallback after that one refused or failed. Absent =
   * the kind's model. Must be in the chain the Preset declares for the kind.
   */
  model?: VideoModelId;
}

export interface PresetClipResult {
  primitive_run_id: string;
  video_url: string;
  duration_seconds: 5 | 10;
  credits_actual_usd: number;
  /** The model that rendered the clip (absent on a result recorded before #26). */
  model?: VideoModelId;
  /** The prompt exactly as sent to it (#26: stored on the Short as what ran; absent before #26). */
  prompt?: string;
}

/**
 * Run a provider step of a clip. On a model whose job a rerun would submit and
 * pay for again (fal, `resubmitOnRetry: false`), any failure is final
 * (PROVIDER_FAILED unless the client already classified it): Temporal never
 * reruns the clip, and the shot's fallback model is its only retry (#25).
 */
async function finalUnlessResubmittable<T>(client: VideoModelClient, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (err) {
    if (client.resubmitOnRetry || err instanceof ApplicationFailure) throw err;
    throw providerFailure(`${client.id}: ${(err as Error)?.message ?? String(err)}`.slice(0, 500), PROVIDER_FAILED);
  }
}

export function makePresetClipActivity(cfg: WorkerConfig) {
  return async function presetClip(input: PresetClipInput): Promise<PresetClipResult> {
    const db = getDb(cfg.supabase.url, cfg.supabase.serviceRoleKey);

    if (input.generate_audio !== false) {
      throw ApplicationFailure.nonRetryable('Preset clips never generate audio', 'INVALID_INPUT');
    }
    if (input.duration !== 5 && input.duration !== 10) {
      throw ApplicationFailure.nonRetryable(`invalid Preset clip length ${input.duration}`, 'INVALID_INPUT');
    }
    if (typeof input.prompt !== 'string' || input.prompt.trim() === '') {
      throw ApplicationFailure.nonRetryable(`no prompt for ${input.preset} shot ${input.shot_kind}`, 'INVALID_INPUT');
    }
    // The shot's model chain comes from the Preset's definition (server-side),
    // never from the input: the input only says which model of it to run now.
    let video: ShotVideo;
    let startImageIsFrame = false;
    try {
      const definition = presetRender(input.preset);
      video = shotVideo(definition, input.shot_kind);
      startImageIsFrame = shotFrame(definition, input.shot_kind) !== undefined;
    } catch (err) {
      throw ApplicationFailure.nonRetryable((err as Error).message, 'INVALID_INPUT');
    }
    const model = input.model ?? video.model;
    if (!shotModelChain(video).includes(model)) {
      throw ApplicationFailure.nonRetryable(`${input.preset} ${input.shot_kind} shots do not render on ${String(model)}`, 'INVALID_INPUT');
    }
    const client = videoModel(model);

    const characterImageUrl = input.character_image_url;
    // A character reference is always re-hosted on R2 (checked below): never
    // send it to a model that refuses a re-hosted face (ADR 0003). The render
    // never asks; this refuses a caller that does, before any spend.
    if (characterImageUrl !== undefined && !modelTakesPersonImage(model, 'rehosted')) {
      throw ApplicationFailure.nonRetryable(`${model} never gets a re-hosted face: the person is described in words`, 'INVALID_INPUT');
    }
    // The Shot Prompt in this model's reference syntax: what is sent, and what is recorded.
    const prompt = client.promptFor(input.prompt);
    if (hasReferenceTokens(prompt)) {
      throw ApplicationFailure.nonRetryable(`${model} left a reference token in the prompt`, 'INVALID_INPUT');
    }
    // Spend: the per-primitive cap does not apply (the Preset's budget governs
    // the whole render; see the header). The day cap still does (runChargedStep).
    // The charge is the shot's (its chain's), whichever model runs, so a
    // fallback never changes the price the user was quoted. The cost is this
    // attempt's model; the day cap is held to the worst case left for the shot
    // (this model, then every fallback after it), as the Preset budgets it.
    const chain = shotModelChain(video);
    const estimatedUsd = modelClipUsd(model, input.duration);
    const worstCaseUsd = chain.slice(chain.indexOf(model)).reduce((sum, m) => sum + modelClipUsd(m, input.duration), 0);
    return runChargedStep({
      cfg,
      db,
      primitiveRunId: input.primitive_run_id,
      userId: input.user_id,
      skillRunId: input.skill_run_id,
      primitiveId: 'product_hero_clip',
      r2Refs: [
        ['start_image_url', input.start_image_url],
        ...(characterImageUrl !== undefined ? ([['character_image_url', characterImageUrl]] as const) : []),
      ],
      estimatedUsd: worstCaseUsd,
      rowInput: {
        start_image_url: input.start_image_url,
        duration: input.duration,
        shot_index: input.shot_index,
        shot_count: input.shot_count,
        shot_kind: input.shot_kind,
        model,
        generate_audio: false,
        prompt,
        ...(characterImageUrl ? { character_image_url: characterImageUrl } : {}),
      },
      charge: {
        primitive: 'product_hero_clip',
        duration: input.duration,
        video,
        description: `vNext product_hero clip ${input.shot_index + 1}/${input.shot_count} ${input.duration}s`,
      },
      replay: (prior) => ({
        primitive_run_id: input.primitive_run_id,
        video_url: prior.url,
        duration_seconds: input.duration,
        credits_actual_usd: prior.actualUsd,
        model,
        prompt,
      }),
      work: async () => {
        let videoBytes: Buffer;
        let providerTaskId: string | null = null;
        let providerVideoUrl: string | null = null;
        if (cfg.openai.simulate) {
          videoBytes = Buffer.from('SIMULATED', 'utf8');
        } else {
          const made = await finalUnlessResubmittable(client, () =>
            client.generate({
              prompt,
              startImageUrl: input.start_image_url,
              ...(characterImageUrl ? { characterImageUrl } : {}),
              ...(startImageIsFrame ? { startImageIsFrame } : {}),
              seconds: input.duration,
              // ADR 0001: the video model never speaks.
              generateAudio: false,
              onProgress: (stage) => Context.current().heartbeat({ stage: 'provider_poll', provider_status: stage }),
            }),
          );
          providerTaskId = made.taskId;
          providerVideoUrl = made.videoUrl;
          Context.current().heartbeat({ stage: 'provider_done', taskId: providerTaskId });
          const videoUrl = providerVideoUrl;
          // Only from the provider CDNs we know, never redirected off them, size-capped.
          videoBytes = await finalUnlessResubmittable(client, () => downloadProviderVideo(videoUrl));
        }
        Context.current().heartbeat({ stage: 'video_downloaded', bytes: videoBytes.byteLength });

        const { publicUrl } = await r2UploadVnext(
          cfg.r2,
          input.primitive_run_id,
          `product-hero-shot-${input.shot_index + 1}.mp4`,
          videoBytes,
          'video/mp4',
        );

        if (providerTaskId) {
          await db.from('provider_tasks').insert({
            primitive_run_id: input.primitive_run_id,
            provider: client.provider,
            external_task_id: providerTaskId,
            status: 'succeeded',
            raw_response: { provider_video_url: providerVideoUrl, model },
          });
        }

        const { error: artErr } = await db.from('primitive_artifacts').insert({
          primitive_run_id: input.primitive_run_id,
          kind: 'product_hero_clip',
          url: publicUrl,
          bytes: videoBytes.byteLength,
          mime: 'video/mp4',
          metadata: {
            provider: client.provider,
            model: client.modelName(),
            video_model: model,
            simulated: cfg.openai.simulate,
            aspect_ratio: '9:16',
            duration_seconds: input.duration,
            generate_audio: false,
            shot_index: input.shot_index,
            source_start_image_url: input.start_image_url,
            ...(characterImageUrl ? { source_character_image_url: characterImageUrl } : {}),
          },
        });
        if (artErr) throw new Error(`primitive_artifacts insert failed: ${artErr.message}`);

        const { error: finErr } = await db
          .from('primitive_runs')
          .update({
            status: 'succeeded',
            actual_credits_usd: estimatedUsd,
            finished_at: new Date().toISOString(),
            provider_task_id: providerTaskId,
          })
          .eq('id', input.primitive_run_id);
        if (finErr) throw new Error(`primitive_runs finalize failed: ${finErr.message}`);

        return {
          primitive_run_id: input.primitive_run_id,
          video_url: publicUrl,
          duration_seconds: input.duration,
          credits_actual_usd: estimatedUsd,
          model,
          prompt,
        };
      },
    });
  };
}

// ── presetMux ───────────────────────────────────────────────────────────

export interface PresetMuxInput {
  primitive_run_id: string;
  user_id: string;
  skill_run_id: string;
  /** Silent clips (R2 URLs) in shot order. */
  clip_urls: string[];
  /** The draft audio (private key) — muxed in whole, never trimmed or stretched. */
  audio_key: string;
  /** The audio's measured length; the visuals are cut to exactly this. */
  audio_duration_ms: number;
  aspect_ratio: '9:16';
  /** The Preset this Short was rendered as (recorded on the Short). */
  preset: string;
  /**
   * How long each shot stays on screen, in ms, in shot order (an intercut
   * Preset's plan, e.g. Reaction #19). Absent: the clips play whole and the
   * tail is trimmed to the audio.
   */
  shot_ms?: number[];
}

export interface PresetMuxResult {
  primitive_run_id: string;
  video_url: string;
  /** Length of the finished Short, measured from the output file. */
  duration_ms: number;
  artifact_id: string;
}

/**
 * Build the ffmpeg filter that hard-cuts the clips onto the 9:16 canvas, holds
 * the last frame if the clips fall a few ms short, and trims the visuals to
 * exactly `seconds`. Clip audio (there should be none) is never mapped.
 */
export function presetCutFilter(clipCount: number, seconds: number, shotMs?: readonly number[]): string {
  // An intercut Preset's shot is cut to its planned share before the concat.
  const cut = (i: number) => (shotMs ? `trim=duration=${(shotMs[i] / 1000).toFixed(3)},` : '');
  const segs = Array.from({ length: clipCount }, (_, i) =>
    `[${i}:v]scale=${CANVAS.w}:${CANVAS.h}:force_original_aspect_ratio=increase,` +
    `crop=${CANVAS.w}:${CANVAS.h},fps=${FPS},format=yuv420p,setsar=1,${cut(i)}setpts=PTS-STARTPTS[v${i}]`,
  );
  const ins = Array.from({ length: clipCount }, (_, i) => `[v${i}]`).join('');
  const s = seconds.toFixed(3);
  return (
    `${segs.join(';')};${ins}concat=n=${clipCount}:v=1:a=0,` +
    `tpad=stop_mode=clone:stop_duration=1,trim=duration=${s},setpts=PTS-STARTPTS[v]`
  );
}

export function makePresetMuxActivity(cfg: WorkerConfig) {
  return async function presetMux(input: PresetMuxInput): Promise<PresetMuxResult> {
    const db = getDb(cfg.supabase.url, cfg.supabase.serviceRoleKey);
    if (!Array.isArray(input.clip_urls) || input.clip_urls.length === 0) {
      throw ApplicationFailure.nonRetryable('no clips to cut', 'INVALID_INPUT');
    }
    const allowedPrefix = cfg.r2.publicUrl.replace(/\/+$/, '') + '/';
    for (const url of input.clip_urls) {
      if (!url.startsWith(allowedPrefix)) {
        throw ApplicationFailure.nonRetryable(`clip ${url} must be hosted on the configured R2 public URL`, 'REFERENCE_URL_NOT_ALLOWED');
      }
    }
    const shotMs = input.shot_ms;
    if (
      shotMs !== undefined &&
      (!Array.isArray(shotMs) || shotMs.length !== input.clip_urls.length || !shotMs.every((ms) => Number.isFinite(ms) && ms > 0))
    ) {
      throw ApplicationFailure.nonRetryable('shot_ms must give every clip a positive length', 'INVALID_INPUT');
    }
    const startedAt = new Date().toISOString();

    const workDir = await mkdtemp(join(tmpdir(), `vnext-hero-mux-${input.primitive_run_id}-`));
    let videoBytes: Buffer;
    let durationMs: number;
    try {
      const clipPaths: string[] = [];
      for (let i = 0; i < input.clip_urls.length; i += 1) {
        const resp = await fetch(input.clip_urls[i], { redirect: 'follow', signal: AbortSignal.timeout(180_000) });
        if (!resp.ok) throw new Error(`clip ${i} download ${resp.status}`);
        const p = join(workDir, `clip-${i}.mp4`);
        await writeFile(p, Buffer.from(await resp.arrayBuffer()));
        clipPaths.push(p);
        Context.current().heartbeat({ stage: 'clip_downloaded', index: i });
      }
      const audioPath = join(workDir, 'draft.mp3');
      await writeFile(audioPath, await readPrivateObject(cfg, input.audio_key, DRAFT_AUDIO));

      // Cut to the audio as it is on disk, so the visuals match the exact bytes
      // being muxed even if the stored measurement differs by a few ms.
      const audioSeconds = await probeSeconds(audioPath);
      const outPath = join(workDir, 'short.mp4');
      await execFileP(
        'ffmpeg',
        [
          '-y',
          ...clipPaths.flatMap((p) => ['-i', p]),
          '-i', audioPath,
          '-filter_complex', presetCutFilter(clipPaths.length, audioSeconds, shotMs),
          '-map', '[v]',
          // The whole draft audio: no -t, no -shortest, no atempo.
          '-map', `${clipPaths.length}:a:0`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
          '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
          '-movflags', '+faststart',
          outPath,
        ],
        { maxBuffer: 1024 * 1024 * 64 },
      );
      Context.current().heartbeat({ stage: 'muxed' });
      durationMs = Math.round((await probeSeconds(outPath, 'v:0')) * 1000);
      videoBytes = await readFile(outPath);
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }

    const { publicUrl } = await r2UploadVnext(cfg.r2, input.primitive_run_id, 'product-hero.mp4', videoBytes, 'video/mp4');

    const { error: upErr } = await db.from('primitive_runs').upsert(
      {
        id: input.primitive_run_id,
        user_id: input.user_id,
        skill_run_id: input.skill_run_id,
        primitive_id: 'product_hero_mux',
        status: 'submitted',
        input: { clip_count: input.clip_urls.length, audio_duration_ms: input.audio_duration_ms, aspect_ratio: '9:16' },
        estimated_credits_usd: 0,
        started_at: startedAt,
      },
      { onConflict: 'id' },
    );
    if (upErr) throw new Error(`primitive_runs upsert failed: ${upErr.message}`);

    const { data: artifact, error: artErr } = await db
      .from('primitive_artifacts')
      .insert({
        primitive_run_id: input.primitive_run_id,
        kind: 'short',
        url: publicUrl,
        bytes: videoBytes.byteLength,
        mime: 'video/mp4',
        metadata: {
          preset: input.preset,
          aspect_ratio: '9:16',
          duration_ms: durationMs,
          audio_duration_ms: input.audio_duration_ms,
          clip_count: input.clip_urls.length,
        },
      })
      .select('id')
      .single();
    if (artErr || !artifact) throw new Error(`primitive_artifacts insert failed: ${artErr?.message ?? 'no row'}`);

    const { error: finErr } = await db
      .from('primitive_runs')
      .update({ status: 'succeeded', actual_credits_usd: 0, finished_at: new Date().toISOString() })
      .eq('id', input.primitive_run_id);
    if (finErr) throw new Error(`primitive_runs finalize failed: ${finErr.message}`);

    return { primitive_run_id: input.primitive_run_id, video_url: publicUrl, duration_ms: durationMs, artifact_id: artifact.id as string };
  };
}

// ── releaseDraftRender ───────────────────────────────────────────────────────

export interface ReleaseDraftRenderInput {
  skill_run_id: string;
  draft_id: string;
}

/**
 * Give the draft back after this render terminally failed (and was refunded),
 * so the user can render the same approved audio again. Runs only after the
 * skill run is recorded failed: the short_drafts guard releases a claim only
 * once its run failed. Conditional on this run still holding the claim, so it
 * is idempotent and never frees a claim another run holds.
 */
export function makeReleaseDraftRenderActivity(cfg: WorkerConfig) {
  return async function releaseDraftRender(input: ReleaseDraftRenderInput): Promise<void> {
    const db = getDb(cfg.supabase.url, cfg.supabase.serviceRoleKey);
    const { error } = await db
      .from('short_drafts')
      .update({ render_run_id: null })
      .eq('id', input.draft_id)
      .eq('render_run_id', input.skill_run_id);
    if (error) throw new Error(`short_drafts release failed: ${error.message}`);
  };
}
