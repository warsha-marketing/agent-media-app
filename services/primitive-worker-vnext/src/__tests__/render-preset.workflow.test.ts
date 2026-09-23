// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Presets as data (#16): a Preset is a definition on ONE shared render pipeline,
// not its own workflow. A second, test-only Preset — different shot kinds, a
// different order rule, different prompts — renders through the same workflow
// Product Hero does, with the same guarantees: the draft audio first, the video
// model's audio disabled on every clip, the visuals cut to the audio, and on
// failure every charged clip refunded and the draft released.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ApplicationFailure } from '@temporalio/activity';
import { WorkflowFailedError } from '@temporalio/client';
import { planPresetShots, STANDARD_MODESTY } from '@agentmedia/schema';
import { startWorkflowHarness, fakeActivities, type CannedActivities, type WorkflowHarness } from './support/workflow-harness.js';
import type { TestPresetRenderInput } from './support/test-preset-workflow.js';
import type { PresetRenderDefinition } from '../presets/index.js';
import { PRODUCT_HERO_RENDER } from '../presets/index.js';
import { MODESTY_PROMPTS } from '../presets/modesty.js';
import type { FetchDraftAudioInput, ProductHeroClipInput, MuxProductHeroInput } from '../activities/product-hero.js';

const SKILL_RUN_ID = '99999999-2222-4333-8444-555555555555';
const AUDIO_KEY = 'vnext/drafts/user-1/draft-9.mp3';
const PHOTO = 'https://r2.example.test/uploads/product.png';

/** Test-only: people intercut with the product, always ending on the product. */
const INTERCUT: PresetRenderDefinition<'person' | 'product'> = {
  id: 'test_intercut',
  name: 'Test Intercut',
  aspectRatio: '9:16',
  minSpeechMs: 5_000,
  maxSpeechMs: 15_000,
  shotKinds: { person: { shows: 'person' }, product: { shows: 'product' } },
  shotPlan: { order: ['person', 'product'], last: 'product' },
  requiredInputs: ['product_image'],
  musicBed: [],
  modesty: STANDARD_MODESTY,
  budget: { maxCredits: 420, maxProviderUsd: 1.8 },
  shotPrompts: {
    person: 'TEST person reacting silently to the product in @image1, mouth closed.',
    product: 'TEST product close-up of @image1.',
  },
};

function renderInput(durationMs: number, preset: PresetRenderDefinition = INTERCUT): TestPresetRenderInput {
  return {
    preset,
    skill_run_id: SKILL_RUN_ID,
    user_id: 'user-1',
    draft_id: 'draft-9',
    audio_key: AUDIO_KEY,
    duration_ms: durationMs,
    product_image_url: PHOTO,
    aspect_ratio: '9:16',
    modesty: { arms: 'covered', hijab: false },
  };
}

function happyFakes(overrides: CannedActivities = {}) {
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
      credits_actual_usd: i.duration === 10 ? 1.2 : 0.6,
    }),
    muxProductHero: (i: MuxProductHeroInput) => ({
      primitive_run_id: i.primitive_run_id,
      video_url: 'https://r2.example.test/shorts/final.mp4',
      duration_ms: i.audio_duration_ms + 11,
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

describe('renderPreset — a second Preset on the same pipeline (test-only driver)', () => {
  it('renders the test Preset’s own shot kinds, in its order, with its own prompts', async () => {
    const fakes = happyFakes();
    await harness.execute('renderTestPresetWorkflow', [renderInput(12_000)], fakes);

    const clips = fakes.callsTo('productHeroClip') as ProductHeroClipInput[];
    expect(clips.map((c) => [c.shot_kind, c.duration])).toEqual([
      ['person', 10],
      ['product', 5],
    ]);
    // The person shot also carries the Modesty Default (#17; see modesty.workflow.test.ts).
    expect(clips.map((c) => c.prompt)).toEqual([
      `${INTERCUT.shotPrompts.person} ${MODESTY_PROMPTS.person.covered}`,
      INTERCUT.shotPrompts.product,
    ]);
    for (const c of clips) expect(c.preset).toBe('test_intercut');
  });

  it('never collapses to one clip: ≤10 s is two 5 s clips ending on the declared last kind, cut to half each', async () => {
    const fakes = happyFakes();
    await harness.execute('renderTestPresetWorkflow', [renderInput(8_000)], fakes);
    const clips = fakes.callsTo('productHeroClip') as ProductHeroClipInput[];
    expect(clips.map((c) => [c.shot_kind, c.duration])).toEqual([['person', 5], ['product', 5]]);
    const [mux] = fakes.callsTo('muxProductHero') as MuxProductHeroInput[];
    expect(mux.shot_ms).toEqual([4_000, 4_000]);
  });

  it('fetches the draft audio first, disables audio on every clip, and cuts to the audio', async () => {
    const fakes = happyFakes();
    const result = await harness.execute('renderTestPresetWorkflow', [renderInput(12_480)], fakes);

    expect(fakes.names().filter((n) => n !== 'composedSkillState')).toEqual([
      'fetchDraftAudio',
      'productHeroClip',
      'productHeroClip',
      'muxProductHero',
    ]);
    const clips = fakes.callsTo('productHeroClip') as ProductHeroClipInput[];
    for (const c of clips) {
      expect(c.generate_audio).toBe(false);
      expect(c.product_image_url).toBe(PHOTO);
    }
    const [mux] = fakes.callsTo('muxProductHero') as MuxProductHeroInput[];
    expect(mux.audio_key).toBe(AUDIO_KEY);
    expect(mux.audio_duration_ms).toBe(12_480);
    expect(mux.preset).toBe('test_intercut');
    expect(result.duration_ms).toBe(12_480 + 11);
  });

  it('plans exactly what the shared planner quotes for the Preset', async () => {
    const fakes = happyFakes();
    await harness.execute('renderTestPresetWorkflow', [renderInput(14_000)], fakes);
    const clips = fakes.callsTo('productHeroClip') as ProductHeroClipInput[];
    expect(clips.map((c) => ({ kind: c.shot_kind, seconds: c.duration }))).toEqual(planPresetShots(INTERCUT, 14_000));
  });

  it('refuses a draft outside the Preset’s own speech band before anything is requested', async () => {
    const narrow = { ...INTERCUT, minSpeechMs: 6_000, maxSpeechMs: 9_000 };
    const fakes = happyFakes();
    await expect(harness.execute('renderTestPresetWorkflow', [renderInput(12_000, narrow)], fakes)).rejects.toBeInstanceOf(
      WorkflowFailedError,
    );
    expect(fakes.names()).not.toContain('productHeroClip');
    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    expect(states.at(-1)).toMatchObject({ status: 'failed', error_code: 'INVALID_INPUT' });
  });

  it('refuses to start without an input the Preset requires, and gives the draft back', async () => {
    const fakes = happyFakes();
    const input = { ...renderInput(9_000), product_image_url: '' };
    await expect(harness.execute('renderTestPresetWorkflow', [input], fakes)).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(fakes.names()).not.toContain('fetchDraftAudio');
    expect(fakes.names()).not.toContain('productHeroClip');
    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    expect(states.at(-1)).toMatchObject({ status: 'failed', error_code: 'INVALID_INPUT' });
    expect(fakes.callsTo('releaseDraftRender')).toEqual([{ skill_run_id: SKILL_RUN_ID, draft_id: 'draft-9' }]);
  });

  it('refunds every charged clip and releases the draft when a clip fails', async () => {
    const fakes = happyFakes({
      productHeroClip: (i: ProductHeroClipInput) => {
        if (i.shot_index === 1) throw ApplicationFailure.nonRetryable('provider refused', 'EVOLINK_400');
        return { primitive_run_id: i.primitive_run_id, video_url: 'https://r2.example.test/c.mp4', duration_seconds: i.duration, credits_actual_usd: 1.2 };
      },
    });
    await expect(harness.execute('renderTestPresetWorkflow', [renderInput(12_000)], fakes)).rejects.toBeInstanceOf(
      WorkflowFailedError,
    );

    const refunded = new Set((fakes.callsTo('refundCredits') as Array<{ primitive_run_id: string }>).map((r) => r.primitive_run_id));
    const clips = fakes.callsTo('productHeroClip') as ProductHeroClipInput[];
    expect(clips).toHaveLength(2);
    for (const c of clips) expect(refunded.has(c.primitive_run_id)).toBe(true);
    const names = fakes.names();
    expect(names.indexOf('releaseDraftRender')).toBeGreaterThan(names.lastIndexOf('refundCredits'));
    expect(fakes.callsTo('releaseDraftRender')).toEqual([{ skill_run_id: SKILL_RUN_ID, draft_id: 'draft-9' }]);
  });
});

describe('makeProductHeroWorkflow — Product Hero is one definition on that pipeline', () => {
  it('renders the Product Hero definition’s kinds and prompts', async () => {
    const fakes = happyFakes();
    const { preset: _preset, ...heroInput } = renderInput(12_000);
    await harness.execute('makeProductHeroWorkflow', [heroInput], fakes);

    const clips = fakes.callsTo('productHeroClip') as ProductHeroClipInput[];
    expect(clips.map((c) => c.shot_kind)).toEqual(['hero', 'detail']);
    expect(clips.map((c) => c.prompt)).toEqual([PRODUCT_HERO_RENDER.shotPrompts.hero, PRODUCT_HERO_RENDER.shotPrompts.detail]);
    const [mux] = fakes.callsTo('muxProductHero') as MuxProductHeroInput[];
    expect(mux.preset).toBe('product_hero');
  });

  it('ignores a Preset definition smuggled into its input: prompts come from the server-side registry', async () => {
    const fakes = happyFakes();
    const smuggled = { ...renderInput(12_000), preset: { ...INTERCUT, id: 'product_hero' } };
    await harness.execute('makeProductHeroWorkflow', [smuggled as never], fakes);
    const clips = fakes.callsTo('productHeroClip') as ProductHeroClipInput[];
    expect(clips.map((c) => c.shot_kind)).toEqual(['hero', 'detail']);
    expect(clips.map((c) => c.prompt)).toEqual([PRODUCT_HERO_RENDER.shotPrompts.hero, PRODUCT_HERO_RENDER.shotPrompts.detail]);
  });
});
