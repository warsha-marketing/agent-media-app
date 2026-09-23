// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Music Bed mix (#9) — lays one licensed track under a finished Short's voice.
 *
 * Runs after the cut (presetMux) only when api-v2 chose a track
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
 * Free, like the mux: the Music Bed never changes the price. The download,
 * upload and run records are shared with the Captions burn (../lib/finished-short.ts).
 */

import { ApplicationFailure } from '@temporalio/activity';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MUSIC_BED_STORAGE_PREFIX, isMusicBedStorageKey } from '@agentmedia/schema';
import type { WorkerConfig } from '../config.js';
import { DRAFT_AUDIO, MUSIC_BED_TRACK, probeSeconds, readPrivateObject } from '../lib/media-io.js';
import { processFinishedShort, type FinishedShortInput, type FinishedShortResult } from '../lib/finished-short.js';

/** Fixed mix levels — the Preset's sound, not a user setting. */
export const MUSIC_BED_MIX = {
  /** Bed level before ducking (≈ −16 dB): present, never competing. */
  bedGain: 0.16,
  fadeInSeconds: 0.4,
  fadeOutSeconds: 1.0,
  /** Sidechain ducking keyed on the voice. */
  duck: { threshold: 0.03, ratio: 8, attackMs: 20, releaseMs: 400 },
} as const;

export interface MixMusicBedInput extends FinishedShortInput {
  /** The approved draft's audio (private key) — the voice, mixed in whole. The mix is exactly audio_duration_ms long. */
  audio_key: string;
  track_id: string;
  /** Private-bucket key of the track (under music-bed/). */
  track_storage_key: string;
}

export type MixMusicBedResult = FinishedShortResult;

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

export function makeMixMusicBedActivity(cfg: WorkerConfig) {
  return async function mixMusicBed(input: MixMusicBedInput): Promise<MixMusicBedResult> {
    // Only an object under music-bed/ (no `..`, no absolute path): a forged key
    // must never mix another private object (e.g. someone's draft) into a Short.
    if (!isMusicBedStorageKey(input.track_storage_key)) {
      throw ApplicationFailure.nonRetryable(`Music Bed tracks are read only from ${MUSIC_BED_STORAGE_PREFIX}`, 'INVALID_INPUT');
    }
    return processFinishedShort(cfg, input, {
      primitiveId: 'music_bed_mix',
      tag: 'bed',
      runInput: { track_id: input.track_id, audio_duration_ms: input.audio_duration_ms },
      metadata: { music_bed: input.track_id },
      doneStage: 'mixed',
      async prepare({ workDir, shortPath, outPath }) {
        const voicePath = join(workDir, 'voice.mp3');
        await writeFile(voicePath, await readPrivateObject(cfg, input.audio_key, DRAFT_AUDIO));
        const bedPath = join(workDir, 'bed.audio');
        await writeFile(bedPath, await readPrivateObject(cfg, input.track_storage_key, MUSIC_BED_TRACK));
        const seconds = await probeSeconds(voicePath);
        return musicBedMixArgs({ shortPath, voicePath, bedPath, outPath, seconds });
      },
    });
  };
}
