// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// make_product_hero × Arabic Captions (#10), through the real workflow with
// faked activities. api-v2 hands the workflow the draft's stored TTS alignment
// when the user turned Captions on (null/absent otherwise). The workflow derives
// the cues from that alignment — Delivery Tags stripped, words timed by their
// characters — and burns them onto the finished Short as the LAST step, after
// the cut and the Music Bed. No speech-to-text: the transcription path
// (subtitles / extractAudio) is never called.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ApplicationFailure } from '@temporalio/activity';
import { WorkflowFailedError } from '@temporalio/client';
import { captionCuesFromAlignment, stripArabicDiacritics, stripDeliveryTags, type CharacterAlignment } from '@agentmedia/schema';
import { startWorkflowHarness, fakeActivities, type CannedActivities, type WorkflowHarness } from './support/workflow-harness.js';
import type { MakeProductHeroWorkflowInput } from '../workflows/make-product-hero.js';
import type { FetchDraftAudioInput, ProductHeroClipInput, MuxProductHeroInput } from '../activities/product-hero.js';
import type { MixMusicBedInput } from '../activities/music-bed.js';
import type { BurnCaptionsInput } from '../activities/captions.js';

const SKILL_RUN_ID = '31111111-2222-4333-8444-555555555555';
const AUDIO_KEY = 'vnext/drafts/user-1/draft-1.mp3';
const TRACK = { track_id: 'ph-luxurious-01', storage_key: 'music-bed/product_hero/ph-luxurious-01.mp3' };
const MUX_URL = 'https://r2.example.test/shorts/voice-only.mp4';
const MIX_URL = 'https://r2.example.test/shorts/with-bed.mp4';
const CAPTIONED_URL = 'https://r2.example.test/shorts/captioned.mp4';

const SCRIPT = '[confidently] رومي رويال، فريش وراقية. [softly] جِلد ومِسك. [excited] جرّبها.';

/** The draft's stored alignment: one entry per character of the voiced Script, tags included. */
function alignmentOf(text: string, step = 0.08): CharacterAlignment {
  const chars = [...text];
  return {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => +(i * step).toFixed(3)),
    character_end_times_seconds: chars.map((_, i) => +((i + 1) * step).toFixed(3)),
  };
}
const ALIGNMENT = alignmentOf(SCRIPT);
const DURATION_MS = Math.round(ALIGNMENT.character_end_times_seconds.at(-1)! * 1000) + 300;

function renderInput(opts: {
  captions?: MakeProductHeroWorkflowInput['captions'];
  musicBed?: MakeProductHeroWorkflowInput['music_bed'];
} = {}): MakeProductHeroWorkflowInput {
  const input: MakeProductHeroWorkflowInput = {
    skill_run_id: SKILL_RUN_ID,
    user_id: 'user-1',
    draft_id: 'draft-1',
    audio_key: AUDIO_KEY,
    duration_ms: DURATION_MS,
    product_image_url: 'https://r2.example.test/uploads/product.png',
    aspect_ratio: '9:16',
  };
  if (opts.musicBed !== undefined) input.music_bed = opts.musicBed;
  if (opts.captions !== undefined) input.captions = opts.captions;
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
    muxProductHero: (i: MuxProductHeroInput) => ({ primitive_run_id: i.primitive_run_id, video_url: MUX_URL, duration_ms: i.audio_duration_ms + 20, artifact_id: 'a-mux' }),
    mixMusicBed: (i: MixMusicBedInput) => ({ primitive_run_id: i.primitive_run_id, video_url: MIX_URL, duration_ms: i.audio_duration_ms + 20, artifact_id: 'a-bed' }),
    burnCaptions: (i: BurnCaptionsInput) => ({ primitive_run_id: i.primitive_run_id, video_url: CAPTIONED_URL, duration_ms: i.audio_duration_ms + 20, artifact_id: 'a-cap' }),
    ...overrides,
  });
}

const lastState = (f: ReturnType<typeof fakes>) => (f.callsTo('composedSkillState') as Array<Record<string, unknown>>).at(-1)!;

let harness: WorkflowHarness;
beforeAll(async () => {
  harness = await startWorkflowHarness();
}, 120_000);
afterAll(async () => {
  await harness?.teardown();
});

describe('makeProductHeroWorkflow — Captions off', () => {
  it.each([
    ['off (null)', null],
    ['not given (runs started before Captions)', undefined],
  ] as const)('%s: no caption step, and the Short is the cut (or mix) as is', async (_label, captions) => {
    const f = fakes();
    const result = await harness.execute('makeProductHeroWorkflow', [renderInput({ captions, musicBed: TRACK })], f);
    expect(f.names()).not.toContain('burnCaptions');
    expect(result.video_url).toBe(MIX_URL);
    expect(lastState(f).final_output).toMatchObject({ video_url: MIX_URL, captions: false });
  });
});

describe('makeProductHeroWorkflow — Captions on', () => {
  it('burns cues derived from the draft alignment as the last step, after the cut and the Music Bed', async () => {
    const f = fakes();
    const result = await harness.execute('makeProductHeroWorkflow', [renderInput({ captions: { alignment: ALIGNMENT }, musicBed: TRACK })], f);

    const steps = f.names().filter((n) => n !== 'composedSkillState');
    expect(steps).toEqual(['fetchDraftAudio', 'productHeroClip', 'muxProductHero', 'mixMusicBed', 'burnCaptions']);
    // Never speech-to-text.
    expect(f.names()).not.toContain('subtitles');
    expect(f.names()).not.toContain('extractAudio');

    const [burn] = f.callsTo('burnCaptions') as BurnCaptionsInput[];
    expect(burn).toMatchObject({
      skill_run_id: SKILL_RUN_ID,
      short_url: MIX_URL, // burned onto the mixed Short
      audio_duration_ms: DURATION_MS,
      preset: 'product_hero',
      aspect_ratio: '9:16',
    });
    // The cues are the alignment's: the Script's words, no Delivery Tag, timed by the voice.
    expect(burn.cues).toEqual(captionCuesFromAlignment(ALIGNMENT, { durationSeconds: DURATION_MS / 1000 }));
    const shown = burn.cues.map((c) => c.text).join(' ');
    expect(shown).toBe(stripArabicDiacritics(stripDeliveryTags(SCRIPT)));
    expect(shown).not.toMatch(/\[|\]|confidently|softly|excited/);
    expect(burn.cues[0].start).toBeCloseTo('[confidently] '.length * 0.08);

    expect(result.video_url).toBe(CAPTIONED_URL);
    expect(result.duration_ms).toBe(DURATION_MS + 20);
    expect(lastState(f).final_output).toMatchObject({ video_url: CAPTIONED_URL, captions: true });
  });

  it('with the Music Bed off, burns onto the cut', async () => {
    const f = fakes();
    await harness.execute('makeProductHeroWorkflow', [renderInput({ captions: { alignment: ALIGNMENT }, musicBed: null })], f);
    expect(f.names().filter((n) => n !== 'composedSkillState')).toEqual(['fetchDraftAudio', 'productHeroClip', 'muxProductHero', 'burnCaptions']);
    const [burn] = f.callsTo('burnCaptions') as BurnCaptionsInput[];
    expect(burn.short_url).toBe(MUX_URL);
  });

  it('refuses a burn that changes the Short length (captions never lengthen or cut it)', async () => {
    const f = fakes({
      burnCaptions: (i: BurnCaptionsInput) => ({ primitive_run_id: i.primitive_run_id, video_url: CAPTIONED_URL, duration_ms: i.audio_duration_ms - 900, artifact_id: 'a' }),
    });
    await expect(harness.execute('makeProductHeroWorkflow', [renderInput({ captions: { alignment: ALIGNMENT } })], f)).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(lastState(f)).toMatchObject({ status: 'failed', error_code: 'CUT_DURATION_MISMATCH' });
  });

  it('a failed burn refunds every clip, marks the caption step failed and gives the draft back', async () => {
    const f = fakes({ burnCaptions: () => { throw ApplicationFailure.nonRetryable('libass exploded', 'CAPTIONS_BURN_FAILED'); } });
    await expect(harness.execute('makeProductHeroWorkflow', [renderInput({ captions: { alignment: ALIGNMENT }, musicBed: TRACK })], f)).rejects.toBeInstanceOf(WorkflowFailedError);

    const refunded = new Set((f.callsTo('refundCredits') as Array<{ primitive_run_id: string }>).map((r) => r.primitive_run_id));
    for (const clip of f.callsTo('productHeroClip') as ProductHeroClipInput[]) expect(refunded.has(clip.primitive_run_id)).toBe(true);
    const [burn] = f.callsTo('burnCaptions') as BurnCaptionsInput[];
    expect(f.callsTo('markPrimitiveRunFailed')).toEqual([
      expect.objectContaining({ primitive_run_id: burn.primitive_run_id, error_code: 'CAPTIONS_BURN_FAILED' }),
    ]);
    expect(lastState(f)).toMatchObject({ status: 'failed', error_code: 'CAPTIONS_BURN_FAILED' });
    expect(f.callsTo('releaseDraftRender')).toHaveLength(1);
  });

  it('an alignment with no words to show fails (and refunds) before any clip, instead of shipping a Short without the Captions asked for', async () => {
    const f = fakes();
    const empty = alignmentOf('[softly] ');
    await expect(harness.execute('makeProductHeroWorkflow', [renderInput({ captions: { alignment: empty } })], f)).rejects.toBeInstanceOf(WorkflowFailedError);
    // Found before anything is spent: no clip is rendered.
    expect(f.names()).not.toContain('productHeroClip');
    expect(f.names()).not.toContain('burnCaptions');
    expect(lastState(f)).toMatchObject({ status: 'failed', error_code: 'CAPTIONS_UNAVAILABLE' });
    expect(f.callsTo('refundCredits').length).toBeGreaterThan(0);
    expect(f.callsTo('releaseDraftRender')).toHaveLength(1);
  });
});
