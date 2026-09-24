// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Modesty Default (#17): the shared Preset pipeline adds the Preset's Modesty
// Default to EVERY shot that shows a person or hands, and to no other. No
// Preset with people exists yet (Hands-on #18 and Reaction #19 come next), so a
// test-only people Preset is rendered through the same pipeline Product Hero
// uses; Product Hero (product shots only) renders its prompts unchanged.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkflowFailedError } from '@temporalio/client';
import { STANDARD_MODESTY, type Modesty } from '@agentmedia/schema';
import { startWorkflowHarness, fakeActivities, type WorkflowHarness } from './support/workflow-harness.js';
import type { TestPresetRenderInput } from './support/test-preset-workflow.js';
import { PRODUCT_HERO_RENDER, type PresetRenderDefinition } from '../presets/index.js';
import { MODESTY_PROMPTS } from '../presets/modesty.js';
import { FORMAT, HANDS_ONLY, NO_PEOPLE, NO_SPEAKING_PERSON, PRODUCT_REFERENCE } from '@agentmedia/shot-prompts';
import type { FetchDraftAudioInput, PresetClipInput, PresetMuxInput } from '../activities/preset-render.js';

const SKILL_RUN_ID = '99999999-3333-4333-8444-555555555555';

/** Test-only: a person reacting, hands using the product, ending on the product. */
const PEOPLE: PresetRenderDefinition<'person' | 'hands' | 'product'> = {
  id: 'test_people',
  name: 'Test People',
  aspectRatio: '9:16',
  minSpeechMs: 5_000,
  maxSpeechMs: 30_000,
  shotKinds: { person: { shows: 'person' }, hands: { shows: 'hands' }, product: { shows: 'product' } },
  shotPlan: { order: ['person', 'hands'], last: 'product' },
  requiredInputs: ['product_image'],
  musicBed: [],
  modesty: STANDARD_MODESTY,
  budget: { maxCredits: 840, maxProviderUsd: 3.6 },
  scenes: {
    person: 'TEST a woman smiles silently at the product, mouth closed.',
    hands: 'TEST first-person hands open the product.',
    product: 'TEST product close-up.',
  },
};

/** A shot's Shot Prompt (#26): the product reference, its scene, then its rule Guardrails. */
const prompt = (scene: string, ...rules: string[]) => [PRODUCT_REFERENCE, scene, ...rules, FORMAT].join(' ');

function renderInput(
  durationMs: number,
  modesty: Modesty | null | undefined,
  preset: PresetRenderDefinition = PEOPLE,
): TestPresetRenderInput {
  return {
    preset,
    skill_run_id: SKILL_RUN_ID,
    user_id: 'user-1',
    draft_id: 'draft-17',
    audio_key: 'vnext/drafts/user-1/draft-17.mp3',
    duration_ms: durationMs,
    product_image_url: 'https://r2.example.test/uploads/product.png',
    aspect_ratio: '9:16',
    modesty,
  };
}

function happyFakes() {
  return fakeActivities({
    composedSkillState: undefined,
    refundCredits: undefined,
    markPrimitiveRunFailed: undefined,
    releaseDraftRender: undefined,
    fetchDraftAudio: (i: FetchDraftAudioInput) => ({ primitive_run_id: i.primitive_run_id, audio_key: i.audio_key, duration_ms: i.duration_ms }),
    presetClip: (i: PresetClipInput) => ({
      primitive_run_id: i.primitive_run_id,
      video_url: `https://r2.example.test/clips/${i.shot_index}.mp4`,
      duration_seconds: i.duration,
      credits_actual_usd: i.duration === 10 ? 1.2 : 0.6,
    }),
    presetMux: (i: PresetMuxInput) => ({
      primitive_run_id: i.primitive_run_id,
      video_url: 'https://r2.example.test/shorts/final.mp4',
      duration_ms: i.audio_duration_ms,
      artifact_id: 'artifact-short',
    }),
  });
}

let harness: WorkflowHarness;

beforeAll(async () => {
  harness = await startWorkflowHarness();
}, 120_000);

afterAll(async () => {
  await harness?.teardown();
});

describe('the Modesty Default in every people and hands prompt', () => {
  it('adds it to every person and hands shot, and to no product shot', async () => {
    const fakes = happyFakes();
    // 30 s → [10, 10, 10]: person, hands, product.
    await harness.execute('renderTestPresetWorkflow', [renderInput(30_000, { arms: 'covered', hijab: false })], fakes);

    const clips = fakes.callsTo('presetClip') as PresetClipInput[];
    expect(clips.map((c) => c.shot_kind)).toEqual(['person', 'hands', 'product']);
    const byKind = Object.fromEntries(clips.map((c) => [c.shot_kind, c.prompt]));
    expect(byKind.person).toBe(prompt(PEOPLE.scenes.person, NO_SPEAKING_PERSON, MODESTY_PROMPTS.person.covered));
    expect(byKind.hands).toBe(prompt(PEOPLE.scenes.hands, HANDS_ONLY, MODESTY_PROMPTS.hands.covered));
    expect(byKind.product).toBe(prompt(PEOPLE.scenes.product, NO_PEOPLE));
  });

  it('adds the hijab to the person shots only when she wears one', async () => {
    const fakes = happyFakes();
    await harness.execute('renderTestPresetWorkflow', [renderInput(30_000, { arms: 'sleeved', hijab: true })], fakes);

    const byKind = Object.fromEntries((fakes.callsTo('presetClip') as PresetClipInput[]).map((c) => [c.shot_kind, c.prompt]));
    expect(byKind.person).toBe(prompt(PEOPLE.scenes.person, NO_SPEAKING_PERSON, MODESTY_PROMPTS.person.sleeved, MODESTY_PROMPTS.hijab));
    expect(byKind.hands).toBe(prompt(PEOPLE.scenes.hands, HANDS_ONLY, MODESTY_PROMPTS.hands.sleeved));
    expect(byKind.product).toBe(prompt(PEOPLE.scenes.product, NO_PEOPLE));
  });

  it('uses the Preset’s default arms for hands when no Modesty was resolved', async () => {
    const handsOnly: PresetRenderDefinition<'hands' | 'product'> = {
      ...PEOPLE,
      id: 'test_hands',
      shotKinds: { hands: { shows: 'hands' }, product: { shows: 'product' } },
      shotPlan: { order: ['hands'], last: 'product' },
      scenes: { hands: PEOPLE.scenes.hands, product: PEOPLE.scenes.product },
    };
    const fakes = happyFakes();
    await harness.execute('renderTestPresetWorkflow', [renderInput(12_000, undefined, handsOnly)], fakes);
    const clips = fakes.callsTo('presetClip') as PresetClipInput[];
    expect(clips.map((c) => c.prompt)).toEqual([
      prompt(PEOPLE.scenes.hands, HANDS_ONLY, MODESTY_PROMPTS.hands.covered),
      prompt(PEOPLE.scenes.product, NO_PEOPLE),
    ]);
  });

  it('refuses arms less modest than the Preset allows, before anything is requested', async () => {
    const strict = { ...PEOPLE, modesty: { ...STANDARD_MODESTY, arms: { default: 'covered', least: 'covered' } } } as const;
    const fakes = happyFakes();
    await expect(
      harness.execute('renderTestPresetWorkflow', [renderInput(12_000, { arms: 'sleeved', hijab: false }, strict)], fakes),
    ).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(fakes.names()).not.toContain('fetchDraftAudio');
    expect(fakes.names()).not.toContain('presetClip');
    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    expect(states.at(-1)).toMatchObject({ status: 'failed', error_code: 'INVALID_INPUT' });
    expect(fakes.callsTo('releaseDraftRender')).toEqual([{ skill_run_id: SKILL_RUN_ID, draft_id: 'draft-17' }]);
  });

  it('refuses a Preset that shows a person without a resolved Modesty (the hijab depends on it)', async () => {
    const fakes = happyFakes();
    await expect(harness.execute('renderTestPresetWorkflow', [renderInput(12_000, null)], fakes)).rejects.toBeInstanceOf(
      WorkflowFailedError,
    );
    expect(fakes.names()).not.toContain('presetClip');
    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    expect(states.at(-1)).toMatchObject({ status: 'failed', error_code: 'INVALID_INPUT' });
  });

  it('refuses a hijab on a Preset that shows no person', async () => {
    const fakes = happyFakes();
    const { preset: _p, ...heroInput } = renderInput(12_000, { arms: 'covered', hijab: true }, PRODUCT_HERO_RENDER);
    await expect(harness.execute('makeProductHeroWorkflow', [heroInput], fakes)).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(fakes.names()).not.toContain('presetClip');
  });
});

describe('Product Hero (no people, no hands): the Modesty Default is a no-op', () => {
  it('renders its prompts unchanged, with or without a Modesty on the input', async () => {
    for (const modesty of [undefined, { arms: 'covered', hijab: false } as const]) {
      const fakes = happyFakes();
      const { preset: _p, ...heroInput } = renderInput(12_000, modesty, PRODUCT_HERO_RENDER);
      await harness.execute('makeProductHeroWorkflow', [heroInput], fakes);
      const clips = fakes.callsTo('presetClip') as PresetClipInput[];
      expect(clips.map((c) => c.prompt)).toEqual([
        prompt(PRODUCT_HERO_RENDER.scenes.hero, NO_PEOPLE),
        prompt(PRODUCT_HERO_RENDER.scenes.detail, NO_PEOPLE),
      ]);
      for (const c of clips) expect(c.prompt).not.toMatch(/Modest styling/);
    }
  });
});
