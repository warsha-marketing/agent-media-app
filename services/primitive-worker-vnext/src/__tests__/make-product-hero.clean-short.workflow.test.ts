// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// A Preset render never burns Captions (#22). Captions are added after the
// render, in the Caption editor, and burned by their own export job
// (caption-export.workflow.test.ts): every render stores the clean Short as its
// result, whatever the request carried.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startWorkflowHarness, fakeActivities, type WorkflowHarness } from './support/workflow-harness.js';
import type { MakeProductHeroWorkflowInput } from '../workflows/make-product-hero.js';
import type { FetchDraftAudioInput, ProductHeroClipInput, MuxProductHeroInput } from '../activities/product-hero.js';
import type { MixMusicBedInput } from '../activities/music-bed.js';

const MUX_URL = 'https://r2.example.test/shorts/voice-only.mp4';
const MIX_URL = 'https://r2.example.test/shorts/with-bed.mp4';
const TRACK = { track_id: 'ph-luxurious-01', storage_key: 'music-bed/product_hero/ph-luxurious-01.mp3' };

function renderInput(musicBed: MakeProductHeroWorkflowInput['music_bed']): MakeProductHeroWorkflowInput {
  return {
    skill_run_id: '31111111-2222-4333-8444-555555555555',
    user_id: 'user-1',
    draft_id: 'draft-1',
    audio_key: 'vnext/drafts/user-1/draft-1.mp3',
    duration_ms: 9_000,
    product_image_url: 'https://r2.example.test/uploads/product.png',
    aspect_ratio: '9:16',
    music_bed: musicBed,
  };
}

function fakes() {
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
    muxProductHero: (i: MuxProductHeroInput) => ({ primitive_run_id: i.primitive_run_id, video_url: MUX_URL, duration_ms: i.audio_duration_ms + 20, artifact_id: 'a-mux' }),
    mixMusicBed: (i: MixMusicBedInput) => ({ primitive_run_id: i.primitive_run_id, video_url: MIX_URL, duration_ms: i.audio_duration_ms + 20, artifact_id: 'a-bed' }),
  });
}

let harness: WorkflowHarness;
beforeAll(async () => {
  harness = await startWorkflowHarness();
}, 120_000);
afterAll(async () => {
  await harness?.teardown();
});

describe('makeProductHeroWorkflow stores the clean Short', () => {
  it.each([
    ['with a Music Bed', TRACK, MIX_URL],
    ['voice only', null, MUX_URL],
  ] as const)('%s: no Captions step; the result is the cut (or mix) as is', async (_label, bed, url) => {
    const f = fakes();
    // A caller that still sends the old `captions` field changes nothing.
    const input = { ...renderInput(bed), captions: { alignment: { characters: ['أ'], character_start_times_seconds: [0], character_end_times_seconds: [1] } } };
    const result = await harness.execute('makeProductHeroWorkflow', [input as MakeProductHeroWorkflowInput], f);
    expect(f.names()).not.toContain('burnCaptions');
    expect(result.video_url).toBe(url);
    const final = (f.callsTo('composedSkillState') as Array<Record<string, unknown>>).at(-1)!.final_output as Record<string, unknown>;
    expect(final.video_url).toBe(url);
    expect(final).not.toHaveProperty('captions');
  });
});
