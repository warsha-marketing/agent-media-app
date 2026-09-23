// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Arabic Captions burn (#10) — the last step of a Preset render, when the user
 * turned Captions on.
 *
 * The render workflow derives the cues from the draft's stored TTS alignment
 * (captionCuesFromAlignment in @agentmedia/schema: the voiced Script's words,
 * Delivery Tags stripped, timed by their characters) and hands them here. This
 * activity only draws them: no speech-to-text, so a caption can never differ
 * from the Script. (The English Whisper path, ./subtitles.ts, is separate.)
 *
 * It burns onto the finished Short (after the cut and any Music Bed): the video
 * is re-encoded frame for frame with the captions drawn right-to-left in Noto
 * Sans Arabic (../lib/arabic-captions-ass.ts), the audio copied untouched, so
 * the Short keeps its length and its sound.
 *
 * Free, like the mux and the Music Bed: Captions never change the price.
 */

import { ApplicationFailure, Context } from '@temporalio/activity';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CaptionCue, PresetDefinition } from '@agentmedia/schema';
import type { WorkerConfig } from '../config.js';
import { getDb } from '../client/db.js';
import { r2UploadVnext } from '../client/r2.js';
import { probeSeconds } from '../lib/media-io.js';
import { arabicCaptionsAss, captionBurnArgs } from '../lib/arabic-captions-ass.js';

const execFileP = promisify(execFile);

export interface BurnCaptionsInput {
  primitive_run_id: string;
  user_id: string;
  skill_run_id: string;
  /** The finished Short (R2 public URL): the cut, or the cut with its Music Bed. */
  short_url: string;
  /** The cues to draw, derived from the draft alignment by the workflow. */
  cues: CaptionCue[];
  /** The voice's measured length; the Short keeps exactly this length. */
  audio_duration_ms: number;
  /** The Preset id and aspect ratio, recorded on the Short. */
  preset: string;
  aspect_ratio: PresetDefinition['aspectRatio'];
}

export interface BurnCaptionsResult {
  primitive_run_id: string;
  video_url: string;
  /** Length of the captioned Short, measured from the output file. */
  duration_ms: number;
  artifact_id: string;
}

export function makeBurnCaptionsActivity(cfg: WorkerConfig) {
  return async function burnCaptions(input: BurnCaptionsInput): Promise<BurnCaptionsResult> {
    if (!Array.isArray(input.cues) || input.cues.length === 0) {
      throw ApplicationFailure.nonRetryable('no caption cues to burn', 'CAPTIONS_UNAVAILABLE');
    }
    const allowedPrefix = cfg.r2.publicUrl.replace(/\/+$/, '') + '/';
    if (!input.short_url.startsWith(allowedPrefix)) {
      throw ApplicationFailure.nonRetryable('short_url must be hosted on the configured R2 public URL', 'REFERENCE_URL_NOT_ALLOWED');
    }
    const db = getDb(cfg.supabase.url, cfg.supabase.serviceRoleKey);
    const startedAt = new Date().toISOString();

    const workDir = await mkdtemp(join(tmpdir(), `vnext-hero-captions-${input.primitive_run_id}-`));
    let videoBytes: Buffer;
    let durationMs: number;
    try {
      const resp = await fetch(input.short_url, { redirect: 'follow', signal: AbortSignal.timeout(180_000) });
      if (!resp.ok) throw new Error(`short download ${resp.status}`);
      const inPath = join(workDir, 'short.mp4');
      await writeFile(inPath, Buffer.from(await resp.arrayBuffer()));
      const assPath = join(workDir, 'captions.ass');
      await writeFile(assPath, arabicCaptionsAss(input.cues), 'utf8');
      Context.current().heartbeat({ stage: 'inputs_ready' });

      const outPath = join(workDir, 'short-captioned.mp4');
      await execFileP('ffmpeg', captionBurnArgs({ inPath, assPath, outPath }), { maxBuffer: 1024 * 1024 * 64 });
      Context.current().heartbeat({ stage: 'burned' });
      durationMs = Math.round((await probeSeconds(outPath)) * 1000);
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
        primitive_id: 'arabic_captions',
        status: 'submitted',
        input: { cue_count: input.cues.length, audio_duration_ms: input.audio_duration_ms, source: 'draft_alignment' },
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
          aspect_ratio: input.aspect_ratio,
          duration_ms: durationMs,
          audio_duration_ms: input.audio_duration_ms,
          captions: { language: 'ar', direction: 'rtl', cues: input.cues.length },
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
