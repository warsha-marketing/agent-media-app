// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The Preset render activities (ADR 0001: audio first, the video model never
 * speaks). Every Preset's render (workflows/render-preset.ts,
 * renderPreset) runs them in order; the names date from Product Hero,
 * the first Preset, and stay stable for in-flight runs:
 *
 *   fetchDraftAudio  — read the approved draft's PRIVATE audio by key and measure it
 *   productHeroClip  — one silent Seedance clip from the product photo, prompted by
 *                      its Preset for its shot kind (generate_audio: false)
 *   muxProductHero   — hard-cut the clips, trim/hold the visuals to the audio's exact
 *                      length, and mux the draft audio in untouched (never trimmed,
 *                      never stretched)
 *
 * Each writes its own primitive_runs row under the parent skill run. Only the
 * clips are charged, at the shared per-clip price. They are exempt from the
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
import { generateSimpleSelfieEvolink } from '../client/evolink.js';
import { deductPrimitiveCredits, refundPrimitiveCredits } from '../client/credits.js';
import { VIDEO_CLIP_USD } from '@agentmedia/schema';

const execFileP = promisify(execFile);

/** The 9:16 canvas every Product Hero Short is cut onto. */
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

// ── productHeroClip ──────────────────────────────────────────────────────────

export interface ProductHeroClipInput {
  primitive_run_id: string;
  user_id: string;
  skill_run_id: string;
  /** R2-hosted product photo (re-hosted and moderated by api-v2). */
  product_image_url: string;
  duration: 5 | 10;
  /** 0-based position of this shot in the Short, and how many shots it has. */
  shot_index: number;
  shot_count: number;
  /** The Preset rendering this shot, the shot's kind in its plan, and the
   *  Preset's prompt for that kind (server-side; see ../presets). */
  preset: string;
  shot_kind: string;
  prompt: string;
  /** Preset visuals are always silent: the draft audio is the only voice. */
  generate_audio: false;
  /**
   * R2-hosted reference of the person on screen (`@image2` in the prompt), set
   * only on shots that show a person (Reaction, #19). Never on a product shot.
   */
  character_image_url?: string;
}

export interface ProductHeroClipResult {
  primitive_run_id: string;
  video_url: string;
  duration_seconds: 5 | 10;
  credits_actual_usd: number;
}

export function makeProductHeroClipActivity(cfg: WorkerConfig) {
  return async function productHeroClip(input: ProductHeroClipInput): Promise<ProductHeroClipResult> {
    const db = getDb(cfg.supabase.url, cfg.supabase.serviceRoleKey);

    if (input.generate_audio !== false) {
      throw ApplicationFailure.nonRetryable('Product Hero clips never generate audio', 'INVALID_INPUT');
    }
    if (input.duration !== 5 && input.duration !== 10) {
      throw ApplicationFailure.nonRetryable(`invalid Product Hero clip length ${input.duration}`, 'INVALID_INPUT');
    }
    if (typeof input.prompt !== 'string' || input.prompt.trim() === '') {
      throw ApplicationFailure.nonRetryable(`no prompt for ${input.preset} shot ${input.shot_kind}`, 'INVALID_INPUT');
    }

    // Retry-safety: a clip that already rendered is returned, not re-rendered.
    const { data: existing, error: existingErr } = await db
      .from('primitive_runs')
      .select('status, actual_credits_usd, primitive_artifacts(id, url)')
      .eq('id', input.primitive_run_id)
      .maybeSingle();
    if (existingErr) throw new Error(`primitive_runs lookup failed: ${existingErr.message}`);
    if (existing && existing.status === 'succeeded') {
      const art = (existing.primitive_artifacts as Array<{ id: string; url: string }> | null)?.[0];
      if (!art) throw new Error(`inconsistent state: primitive_run ${input.primitive_run_id} succeeded without an artifact`);
      return {
        primitive_run_id: input.primitive_run_id,
        video_url: art.url,
        duration_seconds: input.duration,
        credits_actual_usd: Number(existing.actual_credits_usd ?? 0),
      };
    }

    // SSRF guard — the product photo must be on our R2.
    const allowedPrefix = cfg.r2.publicUrl.replace(/\/+$/, '') + '/';
    if (!input.product_image_url.startsWith(allowedPrefix)) {
      throw ApplicationFailure.nonRetryable(
        `product_image_url must be hosted on the configured R2 public URL (${allowedPrefix})`,
        'REFERENCE_URL_NOT_ALLOWED',
      );
    }
    const characterImageUrl = input.character_image_url;
    if (characterImageUrl !== undefined && !characterImageUrl.startsWith(allowedPrefix)) {
      throw ApplicationFailure.nonRetryable(
        `character_image_url must be hosted on the configured R2 public URL (${allowedPrefix})`,
        'REFERENCE_URL_NOT_ALLOWED',
      );
    }

    // Spend: the per-primitive cap does not apply (the Preset's budget governs
    // the whole render; see the header). The day cap still does.
    const estimatedUsd = VIDEO_CLIP_USD[input.duration];
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const { data: dayRows, error: dayErr } = await db
      .from('primitive_runs')
      .select('actual_credits_usd')
      .eq('user_id', input.user_id)
      .gte('created_at', since.toISOString())
      .not('actual_credits_usd', 'is', null);
    if (dayErr) throw new Error(`day-cap query failed: ${dayErr.message}`);
    const dayUsed = (dayRows ?? []).reduce((s, r) => s + Number(r.actual_credits_usd ?? 0), 0);
    if (dayUsed + estimatedUsd > cfg.caps.dayUsd) {
      throw ApplicationFailure.nonRetryable(
        `day budget exceeded: used $${dayUsed.toFixed(2)} + estimate $${estimatedUsd} > cap $${cfg.caps.dayUsd}`,
        'BUDGET_CAP_DAY',
      );
    }

    const prompt = input.prompt;
    const { error: upsertErr } = await db.from('primitive_runs').upsert(
      {
        id: input.primitive_run_id,
        user_id: input.user_id,
        skill_run_id: input.skill_run_id,
        primitive_id: 'product_hero_clip',
        status: 'submitted',
        input: {
          product_image_url: input.product_image_url,
          duration: input.duration,
          shot_index: input.shot_index,
          shot_count: input.shot_count,
          shot_kind: input.shot_kind,
          generate_audio: false,
          prompt,
          ...(characterImageUrl ? { character_image_url: characterImageUrl } : {}),
        },
        estimated_credits_usd: estimatedUsd,
        started_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
    if (upsertErr) throw new Error(`primitive_runs upsert failed: ${upsertErr.message}`);

    await deductPrimitiveCredits({
      db,
      userId: input.user_id,
      primitiveRunId: input.primitive_run_id,
      primitive: 'product_hero_clip',
      duration: input.duration,
      description: `vNext product_hero clip ${input.shot_index + 1}/${input.shot_count} ${input.duration}s`,
    });

    try {
      let videoBytes: Buffer;
      let providerTaskId: string | null = null;
      let providerVideoUrl: string | null = null;
      if (cfg.openai.simulate) {
        videoBytes = Buffer.from('SIMULATED', 'utf8');
      } else {
        const evolinkKey = process.env.EVOLINK_API_KEY?.trim() || process.env.EVOLINK_API_KEYS?.trim();
        if (!evolinkKey) {
          throw ApplicationFailure.nonRetryable('EVOLINK_API_KEY not configured on primitive-worker-vnext', 'PROVIDER_UNCONFIGURED');
        }
        try {
          const result = await generateSimpleSelfieEvolink({
            prompt,
            // @image1 the product; @image2 the person, on a shot that shows one.
            imageUrls: characterImageUrl ? [input.product_image_url, characterImageUrl] : [input.product_image_url],
            duration: input.duration,
            aspectRatio: '9:16',
            // ADR 0001: the video model never speaks.
            generateAudio: false,
            quality: '720p',
          });
          providerTaskId = result.taskId;
          providerVideoUrl = result.videoUrl;
        } catch (err) {
          // A moderation verdict arrives from the poll as a non-retryable
          // EVOLINK_CONTENT_POLICY_VIOLATION — pass it through untouched.
          if (err instanceof ApplicationFailure) throw err;
          const msg = err instanceof Error ? err.message : String(err);
          const status = (err as { status?: number })?.status;
          // 429 / 402 are transient; other 4xx are caller faults (incl. a photo
          // refused at submit) and must not be resubmitted.
          if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429 && status !== 402) {
            throw ApplicationFailure.nonRetryable(`evolink ${status}: ${msg}`, `EVOLINK_${status}`);
          }
          throw err instanceof Error ? err : new Error(msg);
        }
        Context.current().heartbeat({ stage: 'provider_done', taskId: providerTaskId });
        const dl = await fetch(providerVideoUrl, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
        if (!dl.ok) throw new Error(`clip download ${dl.status}`);
        videoBytes = Buffer.from(await dl.arrayBuffer());
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
          provider: 'seedance-2-0',
          external_task_id: providerTaskId,
          status: 'succeeded',
          raw_response: { provider_video_url: providerVideoUrl },
        });
      }

      const { error: artErr } = await db.from('primitive_artifacts').insert({
        primitive_run_id: input.primitive_run_id,
        kind: 'product_hero_clip',
        url: publicUrl,
        bytes: videoBytes.byteLength,
        mime: 'video/mp4',
        metadata: {
          provider: 'seedance-2-0',
          model: process.env.EVOLINK_SEEDANCE_MODEL || 'seedance-2.0-mini-reference-to-video',
          simulated: cfg.openai.simulate,
          aspect_ratio: '9:16',
          duration_seconds: input.duration,
          generate_audio: false,
          shot_index: input.shot_index,
          source_product_image_url: input.product_image_url,
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
      };
    } catch (err) {
      if (err instanceof ApplicationFailure && err.nonRetryable) {
        await refundPrimitiveCredits(db, input.primitive_run_id);
      }
      throw err;
    }
  };
}

// ── muxProductHero ───────────────────────────────────────────────────────────

export interface MuxProductHeroInput {
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

export interface MuxProductHeroResult {
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
export function productHeroCutFilter(clipCount: number, seconds: number, shotMs?: readonly number[]): string {
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

export function makeMuxProductHeroActivity(cfg: WorkerConfig) {
  return async function muxProductHero(input: MuxProductHeroInput): Promise<MuxProductHeroResult> {
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
          '-filter_complex', productHeroCutFilter(clipPaths.length, audioSeconds, shotMs),
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
