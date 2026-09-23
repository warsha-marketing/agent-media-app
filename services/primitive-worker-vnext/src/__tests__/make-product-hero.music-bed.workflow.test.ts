// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// make_product_hero × Music Bed (#9), through the real workflow with faked
// activities. api-v2 decides the bed (resolveMusicBed in @agentmedia/schema) and
// hands the workflow the chosen track, or none. With a track, a mix step lays it
// ducked under the draft voice after the cut; without one, nothing is mixed and
// the Short's audio is the mux's — exactly the draft voice.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ApplicationFailure } from '@temporalio/activity';
import { WorkflowFailedError } from '@temporalio/client';
import { startWorkflowHarness, fakeActivities, type CannedActivities, type WorkflowHarness } from './support/workflow-harness.js';
import type { MakeProductHeroWorkflowInput } from '../workflows/make-product-hero.js';
import type { FetchDraftAudioInput, ProductHeroClipInput, MuxProductHeroInput } from '../activities/product-hero.js';
import type { MixMusicBedInput } from '../activities/music-bed.js';

const SKILL_RUN_ID = '21111111-2222-4333-8444-555555555555';
const AUDIO_KEY = 'vnext/drafts/user-1/draft-1.mp3';
const TRACK = { track_id: 'ph-luxurious-01', storage_key: 'music-bed/product_hero/ph-luxurious-01.mp3' };
const MUX_URL = 'https://r2.example.test/shorts/voice-only.mp4';
const MIX_URL = 'https://r2.example.test/shorts/with-bed.mp4';

function renderInput(durationMs: number, musicBed?: MakeProductHeroWorkflowInput['music_bed']): MakeProductHeroWorkflowInput {
  const input: MakeProductHeroWorkflowInput = {
    skill_run_id: SKILL_RUN_ID,
    user_id: 'user-1',
    draft_id: 'draft-1',
    audio_key: AUDIO_KEY,
    duration_ms: durationMs,
    product_image_url: 'https://r2.example.test/uploads/product.png',
    aspect_ratio: '9:16',
  };
  if (musicBed !== undefined) input.music_bed = musicBed;
  return input;
}

function fakes(overrides: CannedActivities = {}) {
  return fakeActivities({
    composedSkillState: undefined,
    refundCredits: undefined,
    markPrimitiveRunFailed: undefined,
    releaseDraftRender: undefined,
    fetchDraftAudio: (i: FetchDraftAudioInput) => ({ primitive_run_id: i.primitive_run_id, audio_key: i.audio_key, duration_ms: i.duration_ms }),
    productHeroClip: (i: ProductHeroClipInput) => ({
      primitive_run_id: i.primitive_run_id,
      video_url: `https://r2.example.test/clips/${i.shot_index}.mp4`,
      duration_seconds: i.duration,
      credits_actual_usd: 0.6,
    }),
    muxProductHero: (i: MuxProductHeroInput) => ({
      primitive_run_id: i.primitive_run_id,
      video_url: MUX_URL,
      duration_ms: i.audio_duration_ms + 20,
      artifact_id: 'artifact-voice-only',
    }),
    mixMusicBed: (i: MixMusicBedInput) => ({
      primitive_run_id: i.primitive_run_id,
      video_url: MIX_URL,
      duration_ms: i.audio_duration_ms + 20,
      artifact_id: 'artifact-with-bed',
    }),
    ...overrides,
  });
}

let harness: WorkflowHarness;
beforeAll(async () => {
  harness = await startWorkflowHarness();
}, 120_000);
afterAll(async () => {
  await harness?.teardown();
});

describe('makeProductHeroWorkflow — Music Bed on', () => {
  it('mixes the chosen track under the draft voice, after the cut, and ships the mixed Short', async () => {
    const f = fakes();
    const result = await harness.execute('makeProductHeroWorkflow', [renderInput(12_000, TRACK)], f);

    const steps = f.names().filter((n) => n !== 'composedSkillState');
    expect(steps).toEqual(['fetchDraftAudio', 'productHeroClip', 'productHeroClip', 'muxProductHero', 'mixMusicBed']);
    const [mix] = f.callsTo('mixMusicBed') as MixMusicBedInput[];
    expect(mix).toMatchObject({
      skill_run_id: SKILL_RUN_ID,
      short_url: MUX_URL,
      audio_key: AUDIO_KEY, // the draft voice, not a re-voicing
      audio_duration_ms: 12_000,
      preset: 'product_hero',
      track_id: TRACK.track_id,
      track_storage_key: TRACK.storage_key,
    });
    expect(result.video_url).toBe(MIX_URL);
    expect(result.duration_ms).toBe(12_020);

    const done = (f.callsTo('composedSkillState') as Array<Record<string, unknown>>).at(-1)!;
    expect(done.final_output).toMatchObject({ video_url: MIX_URL, music_bed: TRACK.track_id });
  });

  it('refuses a mix that makes the Short longer than the audio (the bed never extends it)', async () => {
    const f = fakes({
      mixMusicBed: (i: MixMusicBedInput) => ({ primitive_run_id: i.primitive_run_id, video_url: MIX_URL, duration_ms: i.audio_duration_ms + 4_000, artifact_id: 'a' }),
    });
    const run = harness.execute('makeProductHeroWorkflow', [renderInput(9_000, TRACK)], f);
    await expect(run).rejects.toBeInstanceOf(WorkflowFailedError);
    const done = (f.callsTo('composedSkillState') as Array<Record<string, unknown>>).at(-1)!;
    expect(done).toMatchObject({ status: 'failed', error_code: 'CUT_DURATION_MISMATCH' });
  });

  it('a failed mix refunds every clip, fails the run and gives the draft back', async () => {
    const f = fakes({ mixMusicBed: () => { throw ApplicationFailure.nonRetryable('ffmpeg exploded', 'MIX_FAILED'); } });
    const run = harness.execute('makeProductHeroWorkflow', [renderInput(12_000, TRACK)], f);
    await expect(run).rejects.toBeInstanceOf(WorkflowFailedError);

    const refunded = new Set((f.callsTo('refundCredits') as Array<{ primitive_run_id: string }>).map((r) => r.primitive_run_id));
    for (const clip of f.callsTo('productHeroClip') as ProductHeroClipInput[]) expect(refunded.has(clip.primitive_run_id)).toBe(true);
    const [mix] = f.callsTo('mixMusicBed') as MixMusicBedInput[];
    expect(f.callsTo('markPrimitiveRunFailed')).toEqual([
      expect.objectContaining({ primitive_run_id: mix.primitive_run_id, error_code: 'MIX_FAILED' }),
    ]);
    expect(f.callsTo('releaseDraftRender')).toHaveLength(1);
  });
});

describe('makeProductHeroWorkflow — Music Bed off (or no licensed track)', () => {
  it.each([
    ['off (null)', null],
    ['not given (runs started before the Music Bed)', undefined],
  ] as const)('%s: no mix step, and the Short is the mux of the draft voice alone', async (_label, bed) => {
    const f = fakes();
    const result = await harness.execute('makeProductHeroWorkflow', [renderInput(8_000, bed)], f);

    expect(f.names()).not.toContain('mixMusicBed');
    const [mux] = f.callsTo('muxProductHero') as MuxProductHeroInput[];
    expect(mux.audio_key).toBe(AUDIO_KEY); // the draft voice, muxed in whole
    expect(result.video_url).toBe(MUX_URL);
    const done = (f.callsTo('composedSkillState') as Array<Record<string, unknown>>).at(-1)!;
    expect(done.final_output).toMatchObject({ video_url: MUX_URL, music_bed: null });
  });
});
