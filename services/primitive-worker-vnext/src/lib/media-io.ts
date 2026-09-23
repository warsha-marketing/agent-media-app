// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Media I/O the Preset render activities share: measuring a file with ffprobe,
 * and reading an object from the PRIVATE bucket (never the public one).
 */

import { ApplicationFailure } from '@temporalio/activity';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { WorkerConfig } from '../config.js';
import { r2GetPrivateObject } from '../client/r2.js';

const execFileP = promisify(execFile);

/** Duration in seconds of the container, or of one stream when `stream` is given. */
export async function probeSeconds(path: string, stream?: 'a:0' | 'v:0'): Promise<number> {
  const args = ['-v', 'error'];
  if (stream) args.push('-select_streams', stream, '-show_entries', 'stream=duration');
  else args.push('-show_entries', 'format=duration');
  args.push('-of', 'default=noprint_wrappers=1:nokey=1', path);
  const { stdout } = await execFileP('ffprobe', args);
  const secs = parseFloat(stdout.trim().split('\n')[0] ?? '');
  if (!Number.isFinite(secs) || secs <= 0) throw new Error(`ffprobe could not measure ${path}: ${stdout.trim()}`);
  return secs;
}

/** What is being read, and the non-retryable codes its failures carry. */
export interface PrivateObjectKind {
  /** For messages, e.g. 'draft audio', 'Music Bed track'. */
  what: string;
  /** No private bucket on this worker (R2_PRIVATE_BUCKET unset). */
  unconfiguredCode: string;
  /** The object is absent or empty. */
  missingCode: string;
}

export const DRAFT_AUDIO: PrivateObjectKind = {
  what: 'draft audio',
  unconfiguredCode: 'DRAFT_STORAGE_UNCONFIGURED',
  missingCode: 'DRAFT_AUDIO_MISSING',
};

export const MUSIC_BED_TRACK: PrivateObjectKind = {
  what: 'Music Bed track',
  unconfiguredCode: 'MUSIC_BED_STORAGE_UNCONFIGURED',
  missingCode: 'MUSIC_BED_TRACK_MISSING',
};

/**
 * Read `key` from the private bucket. Both failures are non-retryable: retrying
 * cannot configure a bucket or create the object, so the render fails (and is
 * refunded) now.
 */
export async function readPrivateObject(cfg: WorkerConfig, key: string, kind: PrivateObjectKind): Promise<Buffer> {
  if (!cfg.r2.privateBucket) {
    throw ApplicationFailure.nonRetryable(
      `${kind.what} storage is not configured on this worker: set R2_PRIVATE_BUCKET (the same bucket as api-v2)`,
      kind.unconfiguredCode,
    );
  }
  const bytes = await r2GetPrivateObject(cfg.r2, key);
  if (!bytes || bytes.byteLength < 256) {
    throw ApplicationFailure.nonRetryable(`${kind.what} ${key} is missing or empty`, kind.missingCode);
  }
  return bytes;
}
