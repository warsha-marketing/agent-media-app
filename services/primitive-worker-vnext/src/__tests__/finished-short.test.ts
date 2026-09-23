// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The Music Bed mix and the Captions burn share one pass over the finished
// Short (lib/finished-short.ts). Both refuse a Short that is not on our R2
// before downloading anything; the burn also refuses an empty cue list.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeBurnCaptionsActivity, type BurnCaptionsInput } from '../activities/captions.js';
import { makeMixMusicBedActivity, type MixMusicBedInput } from '../activities/music-bed.js';
import type { WorkerConfig } from '../config.js';

const cfg = {
  supabase: { url: 'https://db.example.test', serviceRoleKey: 'x' },
  r2: { publicUrl: 'https://r2.example.test/', privateBucket: 'private' },
} as unknown as WorkerConfig;

const base = {
  primitive_run_id: 'run-1',
  user_id: 'user-1',
  skill_run_id: 'skill-1',
  short_url: 'https://evil.example.test/vnext/short.mp4',
  audio_duration_ms: 9_000,
  preset: 'product_hero',
  aspect_ratio: '9:16' as const,
};
const cue = { words: ['أ'], text: 'أ', start: 0, end: 1 };

afterEach(() => vi.unstubAllGlobals());

describe('a pass over the finished Short', () => {
  it.each([
    ['burnCaptions', () => makeBurnCaptionsActivity(cfg)({ ...base, cues: [cue] } as BurnCaptionsInput)],
    ['mixMusicBed', () => makeMixMusicBedActivity(cfg)({ ...base, audio_key: 'k', track_id: 't', track_storage_key: 'music-bed/product_hero/a.mp3' } as MixMusicBedInput)],
  ])('%s refuses a Short that is not on the configured R2, before fetching it', async (_name, run) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(run()).rejects.toMatchObject({ type: 'REFERENCE_URL_NOT_ALLOWED', nonRetryable: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('burnCaptions refuses an empty cue list', async () => {
    await expect(makeBurnCaptionsActivity(cfg)({ ...base, short_url: 'https://r2.example.test/s.mp4', cues: [] })).rejects.toMatchObject({
      type: 'CAPTIONS_UNAVAILABLE',
      nonRetryable: true,
    });
  });

  it('burnCaptions refuses a style off the whitelist before fetching anything (#22)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const style = { position: 'top', size: 'l', colour: '&H000000FF' } as unknown as BurnCaptionsInput['style'];
    await expect(makeBurnCaptionsActivity(cfg)({ ...base, short_url: 'https://r2.example.test/s.mp4', cues: [cue], style })).rejects.toMatchObject({
      type: 'INVALID_INPUT',
      nonRetryable: true,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
