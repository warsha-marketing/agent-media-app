// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Music Bed mix (#9) — lays one licensed track under a finished Short's voice.
 *
 * Runs after the cut (muxProductHero) only when api-v2 chose a track
 * (resolveMusicBed in @agentmedia/schema; the set and its licences are data in
 * packages/schema/src/music-bed/). With the Music Bed off, or no licensed track
 * for the Preset, this step does not run and the Short's audio is the draft
 * voice exactly as muxed.
 *
 * The mix:
 *   - voice = the approved draft audio (private key), in whole: never trimmed,
 *     stretched or re-voiced; it is the mix's first input and sets its length;
 *   - bed   = the track (private key under music-bed/), looped if shorter than the
 *     voice, cut to the voice's length, faded in and out, at a fixed low gain,
 *     and ducked further under speech by a sidechain compressor keyed on the voice;
 *   - video = the cut Short's video stream, copied (not re-encoded).
 * So the Music Bed can never make the Short longer than its audio.
 *
 * Free, like the mux: the Music Bed never changes the price.
 */

import { ApplicationFailure, Context } from '@temporalio/activity';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MUSIC_BED_STORAGE_PREFIX, isMusicBedStorageKey } from '@agentmedia/schema';
import type { WorkerConfig } from '../config.js';
import { getDb } from '../client/db.js';
import { r2GetPrivateObject, r2UploadVnext } from '../client/r2.js';

const execFileP = promisify(execFile);

/** Fixed mix levels — the Preset's sound, not a user setting. */
export const MUSIC_BED_MIX = {
  /** Bed level before ducking (≈ −16 dB): present, never competing. */
  bedGain: 0.16,
  fadeInSeconds: 0.4,
  fadeOutSeconds: 1.0,
  /** Sidechain ducking keyed on the voice. */
  duck: { threshold: 0.03, ratio: 8, attackMs: 20, releaseMs: 400 },
} as const;

export interface MixMusicBedInput {
  primitive_run_id: string;
  user_id: string;
  skill_run_id: string;
  /** The cut Short (R2 public URL) whose video stream is kept. */
  short_url: string;
  /** The approved draft's audio (private key) — the voice, mixed in whole. */
  audio_key: string;
  /** The voice's measured length; the mix is exactly this long. */
  audio_duration_ms: number;
  /** The Preset id, recorded on the Short. */
  preset: string;
  track_id: string;
  /** Private-bucket key of the track (under music-bed/). */
  track_storage_key: string;
}

export interface MixMusicBedResult {
  primitive_run_id: string;
  video_url: string;
  /** Length of the finished Short, measured from the output file. */
  duration_ms: number;
  artifact_id: string;
}

/**
 * The ffmpeg filter graph for inputs [0]=Short video, [1]=voice, [2]=bed
 * (looped). Output label [a] is exactly `seconds` long: the voice leads
 * (amix duration=first) and a final atrim pins it.
 */
export function musicBedMixFilter(seconds: number): string {
  const d = seconds.toFixed(3);
  const { bedGain, fadeInSeconds, duck } = MUSIC_BED_MIX;
  const fadeOut = Math.min(MUSIC_BED_MIX.fadeOutSeconds, seconds / 2);
  const fadeOutStart = Math.max(0, seconds - fadeOut).toFixed(3);
  const fmt = 'aformat=sample_rates=44100:channel_layouts=stereo';
  return [
    `[2:a]${fmt},atrim=duration=${d},asetpts=PTS-STARTPTS,volume=${bedGain},` +
      `afade=t=in:st=0:d=${fadeInSeconds},afade=t=out:st=${fadeOutStart}:d=${fadeOut.toFixed(3)}[bed]`,
    `[1:a]${fmt},asplit=2[voice][key]`,
    `[bed][key]sidechaincompress=threshold=${duck.threshold}:ratio=${duck.ratio}:attack=${duck.attackMs}:release=${duck.releaseMs}[ducked]`,
    `[voice][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,atrim=duration=${d}[a]`,
  ].join(';');
}

/** The ffmpeg arguments for the mix (exported for the real-ffmpeg test). */
export function musicBedMixArgs(p: { shortPath: string; voicePath: string; bedPath: string; outPath: string; seconds: number }): string[] {
  return [
    '-y',
    '-i', p.shortPath,
    '-i', p.voicePath,
    '-stream_loop', '-1', '-i', p.bedPath,
    '-filter_complex', musicBedMixFilter(p.seconds),
    '-map', '0:v:0',
    '-map', '[a]',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
    '-movflags', '+faststart',
    p.outPath,
  ];
}

async function probeSeconds(path: string, stream?: 'a:0' | 'v:0'): Promise<number> {
  const args = ['-v', 'error'];
  if (stream) args.push('-select_streams', stream, '-show_entries', 'stream=duration');
  else args.push('-show_entries', 'format=duration');
  args.push('-of', 'default=noprint_wrappers=1:nokey=1', path);
  const { stdout } = await execFileP('ffprobe', args);
  const secs = parseFloat(stdout.trim().split('\n')[0] ?? '');
  if (!Number.isFinite(secs) || secs <= 0) throw new Error(`ffprobe could not measure ${path}: ${stdout.trim()}`);
  return secs;
}

async function readPrivate(cfg: WorkerConfig, key: string, what: string, missingCode: string): Promise<Buffer> {
  if (!cfg.r2.privateBucket) {
    throw ApplicationFailure.nonRetryable(
      'private storage is not configured on this worker: set R2_PRIVATE_BUCKET (the same bucket as api-v2)',
      'DRAFT_STORAGE_UNCONFIGURED',
    );
  }
  const bytes = await r2GetPrivateObject(cfg.r2, key);
  if (!bytes || bytes.byteLength < 256) throw ApplicationFailure.nonRetryable(`${what} ${key} is missing or empty`, missingCode);
  return bytes;
}

export function makeMixMusicBedActivity(cfg: WorkerConfig) {
  return async function mixMusicBed(input: MixMusicBedInput): Promise<MixMusicBedResult> {
    // Only an object under music-bed/ (no `..`, no absolute path): a forged key
    // must never mix another private object (e.g. someone's draft) into a Short.
    if (!isMusicBedStorageKey(input.track_storage_key)) {
      throw ApplicationFailure.nonRetryable(`Music Bed tracks are read only from ${MUSIC_BED_STORAGE_PREFIX}`, 'INVALID_INPUT');
    }
    const db = getDb(cfg.supabase.url, cfg.supabase.serviceRoleKey);
    const allowedPrefix = cfg.r2.publicUrl.replace(/\/+$/, '') + '/';
    if (!input.short_url.startsWith(allowedPrefix)) {
      throw ApplicationFailure.nonRetryable('short_url must be hosted on the configured R2 public URL', 'REFERENCE_URL_NOT_ALLOWED');
    }
    const startedAt = new Date().toISOString();

    const workDir = await mkdtemp(join(tmpdir(), `vnext-hero-bed-${input.primitive_run_id}-`));
    let videoBytes: Buffer;
    let durationMs: number;
    try {
      const resp = await fetch(input.short_url, { redirect: 'follow', signal: AbortSignal.timeout(180_000) });
      if (!resp.ok) throw new Error(`short download ${resp.status}`);
      const shortPath = join(workDir, 'short.mp4');
      await writeFile(shortPath, Buffer.from(await resp.arrayBuffer()));
      const voicePath = join(workDir, 'voice.mp3');
      await writeFile(voicePath, await readPrivate(cfg, input.audio_key, 'draft audio', 'DRAFT_AUDIO_MISSING'));
      const bedPath = join(workDir, 'bed.audio');
      await writeFile(bedPath, await readPrivate(cfg, input.track_storage_key, 'Music Bed track', 'MUSIC_BED_TRACK_MISSING'));
      Context.current().heartbeat({ stage: 'inputs_ready' });

      const outPath = join(workDir, 'short-bed.mp4');
      const seconds = await probeSeconds(voicePath);
      await execFileP('ffmpeg', musicBedMixArgs({ shortPath, voicePath, bedPath, outPath, seconds }), { maxBuffer: 1024 * 1024 * 64 });
      Context.current().heartbeat({ stage: 'mixed' });
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
        primitive_id: 'music_bed_mix',
        status: 'submitted',
        input: { track_id: input.track_id, audio_duration_ms: input.audio_duration_ms },
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
          music_bed: input.track_id,
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
