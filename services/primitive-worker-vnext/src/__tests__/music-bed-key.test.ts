// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The Music Bed mix reads a track from the PRIVATE bucket by key. The key is
// checked before anything is read: only an object under music-bed/ — no `..`,
// no absolute path, nothing that normalises elsewhere — so a forged workflow
// input can never mix (and publish) another private object such as a draft.

import { describe, it, expect } from 'vitest';
import { makeMixMusicBedActivity, type MixMusicBedInput } from '../activities/music-bed.js';
import type { WorkerConfig } from '../config.js';

const cfg = {
  supabase: { url: 'https://db.example.test', serviceRoleKey: 'x' },
  r2: { publicUrl: 'https://r2.example.test', privateBucket: 'private' },
} as unknown as WorkerConfig;

const input = (track_storage_key: string): MixMusicBedInput => ({
  primitive_run_id: 'run-1',
  user_id: 'user-1',
  skill_run_id: 'skill-1',
  short_url: 'https://r2.example.test/vnext/short.mp4',
  audio_key: 'vnext/drafts/user-1/d.mp3',
  audio_duration_ms: 9_000,
  preset: 'product_hero',
  track_id: 't',
  track_storage_key,
});

describe('mixMusicBed track key', () => {
  it.each([
    'music-bed/../vnext/drafts/user-2/d.mp3',
    'music-bed/product_hero/../../x',
    '/music-bed/x.mp3',
    'vnext/drafts/user-2/d.mp3',
    'music-bed//x.mp3',
  ])('refuses %s before reading anything', async (key) => {
    const mix = makeMixMusicBedActivity(cfg);
    await expect(mix(input(key))).rejects.toMatchObject({ type: 'INVALID_INPUT', nonRetryable: true });
  });
});
