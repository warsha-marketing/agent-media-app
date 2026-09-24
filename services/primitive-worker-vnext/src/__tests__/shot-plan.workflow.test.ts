// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Shot Plan review (#26) through the real Preset workflows: a render with and
// without scene edits. The worker builds every clip prompt as scene +
// Guardrails from its OWN copy of the Guardrails, so an edit can change what
// happens in a shot but never drop or contradict a Guardrail: one that tries
// is refused before anything is requested. What ran — each shot's final prompt
// as sent — is stored on the Short (final_output.shots).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkflowFailedError } from '@temporalio/client';
import {
  FORMAT,
  HANDS_ONLY,
  MODESTY_PROMPTS,
  NO_PEOPLE,
  NO_SPEAKING_PERSON,
  REFERENCE_TOKENS,
} from '@agentmedia/shot-prompts';
import { startWorkflowHarness, fakeActivities, type WorkflowHarness } from './support/workflow-harness.js';
import type { MakeReactionWorkflowInput } from '../workflows/make-reaction.js';
import type { FetchDraftAudioInput, PresetClipInput, PresetMuxInput } from '../activities/preset-render.js';
import type { PresetStartingFrameInput } from '../activities/preset-frame.js';
import type { RenderedShot } from '../workflows/render-preset.js';
import { HANDS_ON_RENDER, PRODUCT_HERO_RENDER, REACTION_RENDER } from '../presets/index.js';

const SKILL_RUN_ID = '26262626-2222-4333-8444-555555555555';

function reactionInput(over: Partial<MakeReactionWorkflowInput> = {}): MakeReactionWorkflowInput {
  return {
    skill_run_id: SKILL_RUN_ID,
    user_id: 'user-1',
    draft_id: 'draft-26',
    audio_key: 'vnext/drafts/user-1/draft-26.mp3',
    duration_ms: 9_000, // reaction, product
    product_image_url: 'https://r2.example.test/uploads/product.png',
    character_image_url: 'https://r2.example.test/uploads/character.png',
    aspect_ratio: '9:16',
    modesty: { arms: 'covered', hijab: true },
    product_interaction: 'removes the cap, sprays once on the inner wrist, brings the wrist to the nose, smiles',
    ...over,
  };
}

/** presetClip reports the prompt it "sent": the Shot Prompt in a fake provider's syntax. */
const sent = (prompt: string) => prompt.split(REFERENCE_TOKENS.start).join('<PRODUCT>').split(REFERENCE_TOKENS.person).join('<PERSON>');

function happyFakes() {
  return fakeActivities({
    composedSkillState: undefined,
    refundCredits: undefined,
    markPrimitiveRunFailed: undefined,
    releaseDraftRender: undefined,
    fetchDraftAudio: (i: FetchDraftAudioInput) => ({ primitive_run_id: i.primitive_run_id, audio_key: i.audio_key, duration_ms: i.duration_ms }),
    presetStartingFrame: (i: PresetStartingFrameInput) => ({
      primitive_run_id: i.primitive_run_id,
      image_url: `https://r2.example.test/frames/${i.shot_index}.png`,
      credits_actual_usd: 0.2,
    }),
    presetClip: (i: PresetClipInput) => ({
      primitive_run_id: i.primitive_run_id,
      video_url: `https://r2.example.test/clips/${i.shot_index}.mp4`,
      duration_seconds: i.duration,
      credits_actual_usd: 0.6,
      model: i.model ?? 'seedance-2.0',
      prompt: sent(i.prompt),
    }),
    presetMux: (i: PresetMuxInput) => ({
      primitive_run_id: i.primitive_run_id,
      video_url: 'https://r2.example.test/shorts/final.mp4',
      duration_ms: i.audio_duration_ms,
      artifact_id: 'artifact-short',
    }),
  });
}

type Fakes = ReturnType<typeof happyFakes>;
const clipsOf = (f: Fakes) => f.callsTo('presetClip') as PresetClipInput[];
const lastState = (f: Fakes) => (f.callsTo('composedSkillState') as Array<Record<string, unknown>>).at(-1)!;
const shotsOf = (f: Fakes) => (lastState(f).final_output as { shots: RenderedShot[] }).shots;

let harness: WorkflowHarness;

beforeAll(async () => {
  harness = await startWorkflowHarness();
}, 120_000);

afterAll(async () => {
  await harness?.teardown();
});

describe('a render without scene edits', () => {
  it('renders every shot on the Preset’s own scene, and stores what ran', async () => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [reactionInput()], fakes);
    const clips = clipsOf(fakes);
    expect(clips[0].prompt).toContain(REACTION_RENDER.scenes.reaction);
    expect(clips[1].prompt).toContain(REACTION_RENDER.scenes.product);
    const shots = shotsOf(fakes);
    expect(shots.map((s) => [s.shot_id, s.kind, s.model, s.edited])).toEqual([
      ['shot-1-reaction', 'reaction', 'kling-o3-pro', false],
      ['shot-2-product', 'product', 'seedance-2.0', false],
    ]);
    // The prompt as the model got it: scene + Guardrails, in its reference syntax.
    expect(shots.map((s) => s.prompt)).toEqual(clips.map((c) => sent(c.prompt)));
    expect(shots[0].guardrails).toEqual(['person_reference', 'product_reference', 'no_speaking', 'modesty', 'hijab', 'format', 'audio_off']);
  });

  it('is the same render whether shot_edits is absent, null or empty', async () => {
    const prompts: string[][] = [];
    for (const shot_edits of [undefined, null, {}]) {
      const fakes = happyFakes();
      await harness.execute('makeReactionWorkflow', [reactionInput({ shot_edits })], fakes);
      prompts.push(clipsOf(fakes).map((c) => c.prompt));
    }
    expect(prompts[1]).toEqual(prompts[0]);
    expect(prompts[2]).toEqual(prompts[0]);
  });
});

describe('a render with scene edits', () => {
  const EDIT = 'The person sniffs the inner wrist, then glances at the bottle with a slow approving nod.';

  it('renders the edited shot on the user’s scene with every Guardrail still in it; other shots are untouched', async () => {
    const plain = happyFakes();
    await harness.execute('makeReactionWorkflow', [reactionInput()], plain);
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [reactionInput({ shot_edits: { 'shot-1-reaction': `  ${EDIT}  ` } })], fakes);

    const [reaction, product] = clipsOf(fakes);
    expect(reaction.prompt).toContain(EDIT);
    expect(reaction.prompt).not.toContain(REACTION_RENDER.scenes.reaction);
    // The edit left every rule out; the worker put its own back, after the scene.
    for (const line of [NO_SPEAKING_PERSON, MODESTY_PROMPTS.person.covered, MODESTY_PROMPTS.hijab, FORMAT]) {
      expect(reaction.prompt.indexOf(line), line).toBeGreaterThan(reaction.prompt.indexOf(EDIT));
    }
    expect(reaction.prompt).toContain(REFERENCE_TOKENS.person);
    expect(reaction.prompt).toContain(REFERENCE_TOKENS.start);
    expect(reaction.generate_audio).toBe(false);
    expect(product.prompt).toBe(clipsOf(plain)[1].prompt);

    const shots = shotsOf(fakes);
    expect(shots[0]).toMatchObject({ shot_id: 'shot-1-reaction', edited: true, scene: EDIT });
    expect(shots[0].prompt).toBe(sent(reaction.prompt));
    expect(shots[1].edited).toBe(false);
  });

  it('never takes Guardrails from the input: fields that try to are ignored', async () => {
    const fakes = happyFakes();
    const smuggled = { ...reactionInput({ shot_edits: { 'shot-1-reaction': EDIT } }), guardrails: [], shot_prompts: { 'shot-1-reaction': EDIT } };
    await harness.execute('makeReactionWorkflow', [smuggled as never], fakes);
    const [reaction] = clipsOf(fakes);
    expect(reaction.prompt).toContain(NO_SPEAKING_PERSON);
    expect(reaction.prompt).toContain(MODESTY_PROMPTS.hijab);
  });

  it.each([
    ['she talks to the camera', 'The person talks to the camera about the scent.'],
    ['no headscarf', 'The person, no headscarf, smiles at the bottle.'],
    ['she takes off her hijab', 'She takes off her hijab and smiles.'],
  ])('refuses an edit that contradicts a Guardrail (%s) before anything is requested', async (_label, text) => {
    const fakes = happyFakes();
    await expect(
      harness.execute('makeReactionWorkflow', [reactionInput({ shot_edits: { 'shot-1-reaction': text } })], fakes),
    ).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(fakes.names()).not.toContain('fetchDraftAudio');
    expect(fakes.names()).not.toContain('presetClip');
    expect(lastState(fakes)).toMatchObject({ status: 'failed', error_code: 'SHOT_EDIT_BREAKS_GUARDRAIL' });
    expect(fakes.callsTo('releaseDraftRender')).toEqual([{ skill_run_id: SKILL_RUN_ID, draft_id: 'draft-26' }]);
  });

  it.each([
    ['a shot the plan does not have', { 'shot-3-reaction': 'The person smiles.' }],
    ['reference syntax', { 'shot-1-reaction': 'The person in @image2 smiles.' }],
    ['a bracketed tag', { 'shot-1-reaction': '[excited] The person smiles.' }],
  ])('refuses %s with SHOT_EDIT_INVALID', async (_label, shot_edits) => {
    const fakes = happyFakes();
    await expect(harness.execute('makeReactionWorkflow', [reactionInput({ shot_edits })], fakes)).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(fakes.names()).not.toContain('presetClip');
    expect(lastState(fakes)).toMatchObject({ status: 'failed', error_code: 'SHOT_EDIT_INVALID' });
  });

  it('Product Hero: an edited closer keeps the product reference and nobody on screen', async () => {
    const fakes = happyFakes();
    const { character_image_url: _c, modesty: _m, product_interaction: _p, ...base } = reactionInput({ duration_ms: 12_500 });
    const scene = 'A slow top-down reveal of the product on dark marble, one soft light sweep.';
    await harness.execute('makeProductHeroWorkflow', [{ ...base, shot_edits: { 'shot-2-detail': scene } }], fakes);
    const [hero, detail] = clipsOf(fakes);
    expect(hero.prompt).toContain(PRODUCT_HERO_RENDER.scenes.hero);
    expect(detail.prompt).toContain(scene);
    expect(detail.prompt).toContain(REFERENCE_TOKENS.start);
    expect(detail.prompt).toContain(`${NO_PEOPLE} ${FORMAT}`);
  });

  it('Hands-on: an edited hands shot keeps hands only, nobody speaks and the modest sleeves; its frame is unchanged', async () => {
    const base = reactionInput();
    const input = {
      skill_run_id: base.skill_run_id,
      user_id: base.user_id,
      draft_id: base.draft_id,
      audio_key: base.audio_key,
      duration_ms: 9_000,
      product_image_url: base.product_image_url,
      aspect_ratio: '9:16' as const,
      modesty: { arms: 'covered' as const, hijab: false },
      hand_gender: 'female' as const,
      setting: 'kitchen' as const,
    };
    const plain = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [input], plain);
    const fakes = happyFakes();
    const scene = 'First-person hands pour the coffee into a small cup and lift it toward the camera.';
    await harness.execute('makeHandsOnWorkflow', [{ ...input, shot_edits: { 'shot-1-hands': scene } }], fakes);
    const [hands] = clipsOf(fakes);
    expect(hands.prompt).toContain(scene);
    expect(hands.prompt).not.toContain(HANDS_ON_RENDER.scenes.hands.slice(0, 40));
    expect(hands.prompt).toContain(`${HANDS_ONLY} ${MODESTY_PROMPTS.hands.covered} ${FORMAT}`);
    expect(fakes.callsTo('presetStartingFrame')).toEqual(plain.callsTo('presetStartingFrame'));
  });
});
