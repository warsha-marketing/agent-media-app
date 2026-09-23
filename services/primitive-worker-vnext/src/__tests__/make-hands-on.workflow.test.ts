// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// make_hands_on (#18), driven end to end through the real workflow in Temporal's
// test environment with every provider faked at the activity boundary. ADR 0001:
// the approved draft's audio comes first and is the only voice; each hands shot
// starts from a product-in-hands frame made before any animation; every clip is
// silent; the visuals are cut to the audio. The Modesty Default is in every
// hands prompt, frame and clip alike.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ApplicationFailure } from '@temporalio/activity';
import { WorkflowFailedError } from '@temporalio/client';
import { quotePresetCredits, HANDS_ON, STARTING_FRAME_CREDITS } from '@agentmedia/schema';
import { startWorkflowHarness, fakeActivities, type CannedActivities, type WorkflowHarness } from './support/workflow-harness.js';
import type { MakeHandsOnWorkflowInput } from '../workflows/make-hands-on.js';
import type { FetchDraftAudioInput, ProductHeroClipInput, MuxProductHeroInput } from '../activities/product-hero.js';
import type { PresetStartingFrameInput } from '../activities/preset-frame.js';
import { HAND_WORDS, HANDS_ON_RENDER, SETTING_WORDS } from '../presets/hands-on.js';
import { MODESTY_PROMPTS } from '../presets/modesty.js';
import { quotePrimitiveCredits } from '../client/credits.js';

const SKILL_RUN_ID = '18181818-2222-4333-8444-555555555555';
const AUDIO_KEY = 'vnext/drafts/user-1/draft-18.mp3';
const PHOTO = 'https://r2.example.test/uploads/product.png';
const frameUrl = (i: number) => `https://r2.example.test/frames/${i}.png`;

function renderInput(durationMs: number, over: Partial<MakeHandsOnWorkflowInput> = {}): MakeHandsOnWorkflowInput {
  return {
    skill_run_id: SKILL_RUN_ID,
    user_id: 'user-1',
    draft_id: 'draft-18',
    audio_key: AUDIO_KEY,
    duration_ms: durationMs,
    product_image_url: PHOTO,
    aspect_ratio: '9:16',
    hand_gender: 'female',
    setting: 'dressing_table',
    modesty: { arms: 'covered', hijab: false },
    ...over,
  };
}

/** The mux measures its cut a few ms off the audio, as a real cut does. */
const CUT_DRIFT_MS = 17;

function happyFakes(overrides: CannedActivities = {}) {
  return fakeActivities({
    composedSkillState: undefined,
    refundCredits: undefined,
    markPrimitiveRunFailed: undefined,
    releaseDraftRender: undefined,
    fetchDraftAudio: (i: FetchDraftAudioInput) => ({ primitive_run_id: i.primitive_run_id, audio_key: i.audio_key, duration_ms: i.duration_ms }),
    presetStartingFrame: (i: PresetStartingFrameInput) => ({
      primitive_run_id: i.primitive_run_id,
      image_url: frameUrl(i.shot_index),
      credits_actual_usd: 0.25,
    }),
    productHeroClip: (i: ProductHeroClipInput) => ({
      primitive_run_id: i.primitive_run_id,
      video_url: `https://r2.example.test/clips/${i.shot_index}.mp4`,
      duration_seconds: i.duration,
      credits_actual_usd: i.duration === 10 ? 1.2 : 0.6,
    }),
    muxProductHero: (i: MuxProductHeroInput) => ({
      primitive_run_id: i.primitive_run_id,
      video_url: 'https://r2.example.test/shorts/final.mp4',
      duration_ms: i.audio_duration_ms + CUT_DRIFT_MS,
      artifact_id: 'artifact-short',
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

describe('makeHandsOnWorkflow — the order of the render', () => {
  it('fetches the draft audio before any visual is requested', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [renderInput(12_000)], fakes);
    const names = fakes.names().filter((n) => n !== 'composedSkillState');
    expect(names[0]).toBe('fetchDraftAudio');
  });

  it('requests every product-in-hands frame before any animation', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [renderInput(12_000)], fakes);
    const names = fakes.names();
    const frames = fakes.callsTo('presetStartingFrame') as PresetStartingFrameInput[];
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ frame: 'product_in_hands', shot_kind: 'hands', product_image_url: PHOTO, preset: 'hands_on' });
    expect(names.lastIndexOf('presetStartingFrame')).toBeLessThan(names.indexOf('productHeroClip'));
    expect(names.indexOf('fetchDraftAudio')).toBeLessThan(names.indexOf('presetStartingFrame'));
  });

  it('animates each hands shot from its frame, and the product closer from the photo', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [renderInput(12_000)], fakes);
    const clips = fakes.callsTo('productHeroClip') as ProductHeroClipInput[];
    expect(clips.map((c) => [c.shot_kind, c.duration, c.product_image_url])).toEqual([
      ['hands', 10, frameUrl(0)],
      ['product', 5, PHOTO],
    ]);
  });

  it('ends a ≤10 s Short on the product too: two 5 s clips, hands from its frame then the product, cut to half each', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [renderInput(8_000)], fakes);
    const clips = fakes.callsTo('productHeroClip') as ProductHeroClipInput[];
    expect(clips.map((c) => [c.shot_kind, c.duration, c.product_image_url])).toEqual([
      ['hands', 5, frameUrl(0)],
      ['product', 5, PHOTO],
    ]);
    const [mux] = fakes.callsTo('muxProductHero') as MuxProductHeroInput[];
    expect(mux.shot_ms).toEqual([4_000, 4_000]);
  });

  it('asks for every clip with the video model’s own audio disabled', async () => {
    for (const ms of [5_000, 9_000, 15_000]) {
      const fakes = happyFakes();
      await harness.execute('makeHandsOnWorkflow', [renderInput(ms)], fakes);
      const clips = fakes.callsTo('productHeroClip') as ProductHeroClipInput[];
      expect(clips.length).toBeGreaterThan(0);
      for (const c of clips) expect(c.generate_audio).toBe(false);
    }
  });

  it('cuts the visuals to the measured audio and reports the measured cut', async () => {
    const fakes = happyFakes({
      // The audio as measured from its bytes differs from the draft's stored length.
      fetchDraftAudio: (i: FetchDraftAudioInput) => ({ primitive_run_id: i.primitive_run_id, audio_key: i.audio_key, duration_ms: 11_960 }),
    });
    const result = await harness.execute('makeHandsOnWorkflow', [renderInput(12_000)], fakes);
    const [mux] = fakes.callsTo('muxProductHero') as MuxProductHeroInput[];
    expect(mux.audio_duration_ms).toBe(11_960);
    expect(result.duration_ms).toBe(11_960 + CUT_DRIFT_MS);
  });

  it('ships the draft’s own audio: nothing voices, and the mux uses the draft audio key', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [renderInput(12_000)], fakes);
    const [mux] = fakes.callsTo('muxProductHero') as MuxProductHeroInput[];
    expect(mux.audio_key).toBe(AUDIO_KEY);
    expect(mux.preset).toBe('hands_on');
    expect(fakes.names().filter((n) => /voice|tts|speech/i.test(n))).toEqual([]);
  });

  it('charges exactly what the quote sums: each clip plus the hands frame', async () => {
    for (const ms of [5_000, 9_000, 10_000, 10_001, 12_000, 15_000]) {
      const fakes = happyFakes();
      await harness.execute('makeHandsOnWorkflow', [renderInput(ms)], fakes);
      const clips = fakes.callsTo('productHeroClip') as ProductHeroClipInput[];
      const frames = fakes.callsTo('presetStartingFrame') as PresetStartingFrameInput[];
      const charged =
        clips.reduce((s, c) => s + quotePrimitiveCredits('product_hero_clip', c.duration), 0) +
        frames.length * quotePrimitiveCredits('preset_frame');
      expect(charged).toBe(quotePresetCredits(HANDS_ON, ms));
      expect(quotePrimitiveCredits('preset_frame')).toBe(STARTING_FRAME_CREDITS.product_in_hands);
    }
  });
});

describe('makeHandsOnWorkflow — prompts', () => {
  it('puts the Modesty Default in every hands prompt, frame and clip, and in no product prompt', async () => {
    for (const arms of ['covered', 'sleeved'] as const) {
      const fakes = happyFakes();
      await harness.execute('makeHandsOnWorkflow', [renderInput(12_000, { modesty: { arms, hijab: false } })], fakes);
      const frames = fakes.callsTo('presetStartingFrame') as PresetStartingFrameInput[];
      const clips = fakes.callsTo('productHeroClip') as ProductHeroClipInput[];
      for (const f of frames) expect(f.prompt.endsWith(MODESTY_PROMPTS.hands[arms])).toBe(true);
      for (const c of clips) {
        if (c.shot_kind === 'hands') expect(c.prompt.endsWith(MODESTY_PROMPTS.hands[arms])).toBe(true);
        else expect(c.prompt).not.toContain('Modest styling');
      }
    }
  });

  it('uses the Preset’s default arms when no Modesty was resolved', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [renderInput(8_000, { modesty: undefined })], fakes);
    const [frame] = fakes.callsTo('presetStartingFrame') as PresetStartingFrameInput[];
    expect(frame.prompt.endsWith(MODESTY_PROMPTS.hands.covered)).toBe(true);
  });

  it('shows the chosen hands in the chosen setting', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [renderInput(12_000, { hand_gender: 'male', setting: 'majlis' })], fakes);
    const [frame] = fakes.callsTo('presetStartingFrame') as PresetStartingFrameInput[];
    const clips = fakes.callsTo('productHeroClip') as ProductHeroClipInput[];
    for (const p of [frame.prompt, clips[0].prompt]) {
      expect(p).toContain(HAND_WORDS.male);
      expect(p).toContain(SETTING_WORDS.majlis);
      expect(p).not.toMatch(/\{[a-z_]+\}/);
    }
    expect(clips[1].prompt).toContain(SETTING_WORDS.majlis);
    expect(clips[1].prompt).not.toContain(HAND_WORDS.male);
  });

  it('never lets a prompt imply speech: every clip says nobody speaks or shows nobody', () => {
    expect(HANDS_ON_RENDER.shotPrompts.hands).toMatch(/nobody speaks/);
    expect(HANDS_ON_RENDER.shotPrompts.product).toMatch(/No people, no hands/);
  });
});

describe('makeHandsOnWorkflow — refusals before anything is requested', () => {
  it.each([
    ['no hand gender', { hand_gender: undefined }],
    ['no setting', { setting: undefined }],
    ['a setting off the list', { setting: 'spaceship' as never }],
    ['a hand gender off the list', { hand_gender: 'neutral' as never }],
    ['a hijab (no person on screen)', { modesty: { arms: 'covered', hijab: true } as const }],
  ])('refuses %s', async (_what, over) => {
    const fakes = happyFakes();
    await expect(harness.execute('makeHandsOnWorkflow', [renderInput(12_000, over)], fakes)).rejects.toBeInstanceOf(
      WorkflowFailedError,
    );
    expect(fakes.names()).not.toContain('presetStartingFrame');
    expect(fakes.names()).not.toContain('productHeroClip');
    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    expect(states.at(-1)).toMatchObject({ status: 'failed', error_code: 'INVALID_INPUT' });
    expect(fakes.callsTo('releaseDraftRender')).toEqual([{ skill_run_id: SKILL_RUN_ID, draft_id: 'draft-18' }]);
  });
});

describe('makeHandsOnWorkflow — failure refunds every charged child and releases the draft', () => {
  const failAt: Array<[string, CannedActivities]> = [
    ['the frame', { presetStartingFrame: () => { throw ApplicationFailure.nonRetryable('image refused', 'OPENAI_400'); } }],
    ['the second clip', {
      productHeroClip: (i: ProductHeroClipInput) => {
        if (i.shot_index === 1) throw ApplicationFailure.nonRetryable('provider refused', 'EVOLINK_400');
        return { primitive_run_id: i.primitive_run_id, video_url: 'https://r2.example.test/c.mp4', duration_seconds: i.duration, credits_actual_usd: 1.2 };
      },
    }],
    ['the mux', { muxProductHero: () => { throw ApplicationFailure.nonRetryable('ffmpeg exploded', 'MUX_FAILED'); } }],
  ];

  it.each(failAt)('a terminal failure at %s refunds every frame and clip, then gives the draft back', async (_where, overrides) => {
    const fakes = happyFakes(overrides);
    await expect(harness.execute('makeHandsOnWorkflow', [renderInput(12_000)], fakes)).rejects.toBeInstanceOf(
      WorkflowFailedError,
    );

    const refunded = new Set((fakes.callsTo('refundCredits') as Array<{ primitive_run_id: string }>).map((r) => r.primitive_run_id));
    const charged = [
      ...(fakes.callsTo('presetStartingFrame') as PresetStartingFrameInput[]),
      ...(fakes.callsTo('productHeroClip') as ProductHeroClipInput[]),
    ];
    expect(charged.length).toBeGreaterThan(0);
    for (const c of charged) expect(refunded.has(c.primitive_run_id)).toBe(true);

    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    expect(states.at(-1)).toMatchObject({ status: 'failed' });
    expect(fakes.callsTo('releaseDraftRender')).toEqual([{ skill_run_id: SKILL_RUN_ID, draft_id: 'draft-18' }]);
    const names = fakes.names();
    expect(names.indexOf('releaseDraftRender')).toBeGreaterThan(names.lastIndexOf('refundCredits'));
  });

  it('a failed frame stops the render before any clip is requested', async () => {
    const fakes = happyFakes(failAt[0][1]);
    await expect(harness.execute('makeHandsOnWorkflow', [renderInput(12_000)], fakes)).rejects.toBeInstanceOf(
      WorkflowFailedError,
    );
    expect(fakes.names()).not.toContain('productHeroClip');
    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    expect(states.at(-1)).toMatchObject({ status: 'failed', error_code: 'OPENAI_400' });
  });
});
