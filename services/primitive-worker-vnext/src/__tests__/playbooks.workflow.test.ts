// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Playbooks (#32) through the real Preset workflows: the worker renders the
// Playbook choice api-v2 priced ({ id, version, pattern } on the input) from
// its own copy of the Playbook data — the fragrance pattern's two person shots
// (spray, then smell, cut on action) before the product, each clip carrying the
// Playbook's negatives; an edit asking for a banned motion, or a choice that is
// unknown or stale, refuses the render before anything is requested; and the
// Short records the Playbook it followed (final_output.playbook).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkflowFailedError } from '@temporalio/client';
import { REACTION, quotePresetCredits, shotClipCredits, shotVideo } from '@agentmedia/schema';
import { FRAGRANCE_OUD, playbookPreset, resolvePlaybookChoice } from '@agentmedia/shot-prompts';
import { startWorkflowHarness, fakeActivities, type WorkflowHarness } from './support/workflow-harness.js';
import type { MakeReactionWorkflowInput } from '../workflows/make-reaction.js';
import type { FetchDraftAudioInput, PresetClipInput, PresetMuxInput } from '../activities/preset-render.js';
import type { RenderedShot } from '../workflows/render-preset.js';

const SKILL_RUN_ID = '32323232-2222-4333-8444-555555555555';
const FRAGRANCE = { id: 'fragrance_oud', version: FRAGRANCE_OUD.version, pattern: 'spray-then-smell' };

function reactionInput(over: Partial<MakeReactionWorkflowInput> = {}): MakeReactionWorkflowInput {
  return {
    skill_run_id: SKILL_RUN_ID,
    user_id: 'user-1',
    draft_id: 'draft-32',
    audio_key: 'vnext/drafts/user-1/draft-32.mp3',
    duration_ms: 9_000,
    product_image_url: 'https://r2.example.test/uploads/product.png',
    character_image_url: 'https://r2.example.test/uploads/character.png',
    aspect_ratio: '9:16',
    modesty: { arms: 'covered', hijab: true },
    character_gender: 'female',
    character_description: 'Gulf woman in her late twenties, warm brown eyes',
    product_interaction: 'holds the uncapped bottle, sprays once on the inner wrist, sets the bottle down, then raises the wrist to the nose and smiles',
    playbook: FRAGRANCE,
    ...over,
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
      credits_actual_usd: 0.6,
      model: i.model ?? 'seedance-2.0',
      prompt: i.prompt,
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
const outputOf = (f: Fakes) => lastState(f).final_output as { shots: RenderedShot[]; playbook: unknown };

let harness: WorkflowHarness;

beforeAll(async () => {
  harness = await startWorkflowHarness();
}, 120_000);

afterAll(async () => {
  await harness?.teardown();
});

describe('a Reaction render under the fragrance & oud Playbook', () => {
  it('sprays, then smells (two person shots, cut on action), then the product; records the Playbook', async () => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [reactionInput()], fakes);
    const clips = clipsOf(fakes);
    expect(clips.map((c) => c.shot_kind)).toEqual(['reaction', 'reaction', 'product']);
    const out = outputOf(fakes);
    expect(out.shots.map((s) => s.shot_id)).toEqual(['reaction-spray', 'reaction-smell', 'product-closer']);
    expect(out.playbook).toEqual(FRAGRANCE);
    expect(clips[0].prompt).toContain('sprays once onto the inner wrist, then sets the bottle down');
    expect(clips[0].prompt).not.toContain('raises the inner wrist to the nose');
    expect(clips[1].prompt).toContain('With empty hands, the person raises the inner wrist to the nose');
    for (const c of clips.slice(0, 2)) expect(c.prompt).toContain('never brings the bottle itself to their face or nose');
    expect(clips[2].prompt).toContain('No spray or mist leaves the bottle');
    expect(out.shots[0].guardrails.video).toContain('playbook');
  });

  it('charges what the quote priced: the pattern’s clips', async () => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [reactionInput()], fakes);
    const charged = clipsOf(fakes).reduce((sum, c) => sum + shotClipCredits(shotVideo(REACTION, c.shot_kind), c.duration as 5 | 10), 0);
    expect(charged).toBe(quotePresetCredits(playbookPreset(REACTION, resolvePlaybookChoice(FRAGRANCE)), 9_000));
  });

  it('refuses an edit asking for a banned motion (English or Arabic) before anything is requested', async () => {
    for (const text of ['She brings the bottle to her nose.', 'تقرب الزجاجة من أنفها']) {
      const fakes = happyFakes();
      await expect(
        harness.execute('makeReactionWorkflow', [reactionInput({ shot_edits: { 'reaction-smell': { action: text } } })], fakes),
      ).rejects.toBeInstanceOf(WorkflowFailedError);
      expect(fakes.names()).not.toContain('fetchDraftAudio');
      expect(lastState(fakes)).toMatchObject({ status: 'failed', error_code: 'SHOT_EDIT_BANNED_MOTION' });
      expect(fakes.callsTo('releaseDraftRender')).toEqual([{ skill_run_id: SKILL_RUN_ID, draft_id: 'draft-32' }]);
    }
  });

  it.each([
    ['an unknown Playbook', { id: 'nope', version: 1, pattern: null }],
    ['a stale version', { ...FRAGRANCE, version: 999 }],
    ['a pattern it does not have', { ...FRAGRANCE, pattern: 'nope' }],
  ])('refuses %s before anything is requested', async (_label, playbook) => {
    const fakes = happyFakes();
    await expect(harness.execute('makeReactionWorkflow', [reactionInput({ playbook })], fakes)).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(fakes.names()).not.toContain('presetClip');
    expect(lastState(fakes)).toMatchObject({ status: 'failed', error_code: 'INVALID_INPUT' });
  });

  it('without a Playbook: the Preset’s shots, none recorded', async () => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [reactionInput({ playbook: null })], fakes);
    expect(outputOf(fakes).shots.map((s) => s.shot_id)).toEqual(['reaction', 'product-closer']);
    expect(outputOf(fakes).playbook).toBeNull();
    for (const c of clipsOf(fakes)) expect(c.prompt).not.toContain('never brings the bottle itself');
  });
});
