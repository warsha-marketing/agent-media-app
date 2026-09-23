// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * One ffmpeg pass over a finished Short (the cut from muxProductHero, or its
 * previous pass), published as the Short's new version. The Music Bed mix and
 * the Arabic Captions burn are both this; each supplies only its inputs and
 * its ffmpeg arguments.
 *
 *   short_url (our R2 only) ─ download ─ prepare inputs ─ ffmpeg ─ measure
 *     ─ upload product-hero.mp4 ─ primitive_runs (submitted) ─ primitive_artifacts
 *     (kind 'short') ─ primitive_runs (succeeded)
 *
 * Free: the run is recorded at 0 credits. The temp dir is removed whatever
 * happens; failures before the upload leave nothing behind.
 */

import { ApplicationFailure, Context } from '@temporalio/activity';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PresetDefinition } from '@agentmedia/schema';
import type { WorkerConfig } from '../config.js';
import { getDb } from '../client/db.js';
import { r2UploadVnext } from '../client/r2.js';
import { probeSeconds } from './media-io.js';

const execFileP = promisify(execFile);

/** What every pass over the Short is given by the workflow. */
export interface FinishedShortInput {
  primitive_run_id: string;
  user_id: string;
  skill_run_id: string;
  /** The finished Short (R2 public URL). */
  short_url: string;
  /** The voice's measured length. */
  audio_duration_ms: number;
  /** The Preset id, recorded on the Short. */
  preset: string;
  /** The Preset's aspect ratio, recorded on the Short when given. */
  aspect_ratio?: PresetDefinition['aspectRatio'];
}

export interface FinishedShortResult {
  primitive_run_id: string;
  video_url: string;
  /** Length of the new Short, measured from the output file. */
  duration_ms: number;
  artifact_id: string;
}

export interface FinishedShortPass {
  /** primitive_runs.primitive_id, e.g. 'music_bed_mix'. */
  primitiveId: string;
  /** Names the temp dir (`vnext-hero-<tag>-<run>-`). */
  tag: string;
  /** Recorded as primitive_runs.input. */
  runInput: Record<string, unknown>;
  /** Added to the artifact's metadata (after preset, aspect_ratio, duration_ms, audio_duration_ms). */
  metadata: Record<string, unknown>;
  /** Heartbeat stage once ffmpeg is done, e.g. 'mixed'. */
  doneStage: string;
  /**
   * Write this pass's other inputs into `workDir` and return the ffmpeg
   * arguments that read `shortPath` and write `outPath`.
   */
  prepare(files: { workDir: string; shortPath: string; outPath: string }): Promise<string[]>;
}

export async function processFinishedShort(
  cfg: WorkerConfig,
  input: FinishedShortInput,
  pass: FinishedShortPass,
): Promise<FinishedShortResult> {
  const allowedPrefix = cfg.r2.publicUrl.replace(/\/+$/, '') + '/';
  if (!input.short_url.startsWith(allowedPrefix)) {
    throw ApplicationFailure.nonRetryable('short_url must be hosted on the configured R2 public URL', 'REFERENCE_URL_NOT_ALLOWED');
  }
  const db = getDb(cfg.supabase.url, cfg.supabase.serviceRoleKey);
  const startedAt = new Date().toISOString();

  const workDir = await mkdtemp(join(tmpdir(), `vnext-hero-${pass.tag}-${input.primitive_run_id}-`));
  let videoBytes: Buffer;
  let durationMs: number;
  try {
    const resp = await fetch(input.short_url, { redirect: 'follow', signal: AbortSignal.timeout(180_000) });
    if (!resp.ok) throw new Error(`short download ${resp.status}`);
    const shortPath = join(workDir, 'short.mp4');
    await writeFile(shortPath, Buffer.from(await resp.arrayBuffer()));
    const outPath = join(workDir, `short-${pass.tag}.mp4`);
    const args = await pass.prepare({ workDir, shortPath, outPath });
    Context.current().heartbeat({ stage: 'inputs_ready' });

    await execFileP('ffmpeg', args, { maxBuffer: 1024 * 1024 * 64 });
    Context.current().heartbeat({ stage: pass.doneStage });
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
      primitive_id: pass.primitiveId,
      status: 'submitted',
      input: pass.runInput,
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
        ...(input.aspect_ratio ? { aspect_ratio: input.aspect_ratio } : {}),
        duration_ms: durationMs,
        audio_duration_ms: input.audio_duration_ms,
        ...pass.metadata,
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
}
