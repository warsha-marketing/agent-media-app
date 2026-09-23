// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// make_reaction (#19), the Reaction Preset on the shared render pipeline, driven
// end to end through the registered workflow in Temporal's test environment
// with every provider faked at the activity boundary. A Voice-over Short, never
// a Talking-head Short: the saved character reacts silently in short shots
// intercut with the product, the last shot is the product, and the approved
// draft's audio is the only voice (ADR 0001).

import { describe, it, expect, expectTypeOf, beforeAll, afterAll } from 'vitest';
import { ApplicationFailure } from '@temporalio/activity';
import { WorkflowFailedError } from '@temporalio/client';
import { REACTION_MAX_SHOT_MS, type Modesty } from '@agentmedia/schema';
import { startWorkflowHarness, fakeActivities, type CannedActivities, type WorkflowHarness } from './support/workflow-harness.js';
import type { MakeReactionWorkflowInput } from '../workflows/make-reaction.js';
import type { FetchDraftAudioInput, ProductHeroClipInput, MuxProductHeroInput } from '../activities/product-hero.js';
import { MODESTY_PROMPTS } from '../presets/modesty.js';
import { REACTION_RENDER, SILENT_REACTION } from '../presets/reaction.js';
import { presetRender } from '../presets/index.js';
import * as workflows from '../workflows/index.js';

const SKILL_RUN_ID = '19191919-2222-4333-8444-555555555555';
const AUDIO_KEY = 'vnext/drafts/user-1/draft-19.mp3';
const PRODUCT = 'https://r2.example.test/uploads/product.png';
const CHARACTER = 'https://r2.example.test/uploads/character.png';
const CUT_DRIFT_MS = 17;

function renderInput(durationMs: number, over: Partial<MakeReactionWorkflowInput> = {}): MakeReactionWorkflowInput {
  return {
    skill_run_id: SKILL_RUN_ID,
    user_id: 'user-1',
    draft_id: 'draft-19',
    audio_key: AUDIO_KEY,
    duration_ms: durationMs,
    product_image_url: PRODUCT,
    character_image_url: CHARACTER,
    aspect_ratio: '9:16',
    modesty: { arms: 'covered', hijab: true },
    ...over,
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
      video_url: 'https://r2.example.test/shorts/reaction.mp4',
      duration_ms: i.audio_duration_ms + CUT_DRIFT_MS,
      artifact_id: 'artifact-short',
    }),
    ...overrides,
  });
}

const clipsOf = (f: ReturnType<typeof happyFakes>) => f.callsTo('productHeroClip') as ProductHeroClipInput[];

let harness: WorkflowHarness;

beforeAll(async () => {
  harness = await startWorkflowHarness();
}, 120_000);

afterAll(async () => {
  await harness?.teardown();
});

describe('makeReactionWorkflow — silent faces intercut with the product', () => {
  it('fetches the draft audio before any visual, then the clips, then the cut', async () => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(12_000)], fakes);
    expect(fakes.names().filter((n) => n !== 'composedSkillState')).toEqual([
      'fetchDraftAudio', 'productHeroClip', 'productHeroClip', 'productHeroClip', 'productHeroClip', 'muxProductHero',
    ]);
  });

  it.each([5_000, 8_400, 10_000, 10_001, 15_000])('intercuts reaction and product shots and ends on the product (%i ms)', async (ms) => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(ms)], fakes);
    const kinds = clipsOf(fakes).map((c) => c.shot_kind);
    kinds.forEach((k, i) => expect(k).toBe(i % 2 === 0 ? 'reaction' : 'product'));
    expect(kinds.at(-1)).toBe('product');
    for (const c of clipsOf(fakes)) expect(c.preset).toBe('reaction');
  });

  it('puts the no-speaking instruction and the Modesty Default in every reaction prompt, and neither in a product prompt', async () => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(15_000)], fakes);
    const clips = clipsOf(fakes);
    expect(clips.filter((c) => c.shot_kind === 'reaction')).toHaveLength(2);
    for (const c of clips) {
      if (c.shot_kind === 'reaction') {
        expect(c.prompt).toContain(SILENT_REACTION);
        expect(c.prompt).toContain(MODESTY_PROMPTS.person.covered);
        expect(c.prompt).toContain(MODESTY_PROMPTS.hijab);
      } else {
        expect(c.prompt).toBe(REACTION_RENDER.shotPrompts.product);
        expect(c.prompt).not.toContain(SILENT_REACTION);
        expect(c.prompt).not.toContain('Modest styling');
      }
    }
  });

  it.each<[string, Modesty]>([
    ['sleeved arms, no hijab', { arms: 'sleeved', hijab: false }],
    ['covered arms, no hijab (a man, or a woman who chose none)', { arms: 'covered', hijab: false }],
  ])('carries the resolved Modesty as given: %s', async (_label, modesty) => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(9_000, { modesty })], fakes);
    const [reaction] = clipsOf(fakes).filter((c) => c.shot_kind === 'reaction');
    expect(reaction.prompt).toContain(MODESTY_PROMPTS.person[modesty.arms]);
    expect(reaction.prompt).not.toContain(MODESTY_PROMPTS.hijab);
    expect(reaction.prompt).toContain(SILENT_REACTION);
  });

  it('asks for every clip with the video model’s own audio disabled', async () => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(14_000)], fakes);
    expect(clipsOf(fakes).length).toBeGreaterThan(0);
    for (const c of clipsOf(fakes)) expect(c.generate_audio).toBe(false);
  });

  it('uses the character reference on reaction shots only; every shot has the product photo', async () => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(13_000)], fakes);
    for (const c of clipsOf(fakes)) {
      expect(c.product_image_url).toBe(PRODUCT);
      if (c.shot_kind === 'reaction') expect(c.character_image_url).toBe(CHARACTER);
      else expect(c.character_image_url).toBeUndefined();
    }
  });

  it.each([5_000, 7_300, 10_000, 12_480, 15_000])(
    'cuts the Short to %i ms of audio, no shot on screen over the maximum, and reports the measured length',
    async (ms) => {
      const fakes = happyFakes();
      const result = await harness.execute('makeReactionWorkflow', [renderInput(ms)], fakes);
      const clips = clipsOf(fakes);
      const [mux] = fakes.callsTo('muxProductHero') as MuxProductHeroInput[];
      expect(mux.audio_duration_ms).toBe(ms);
      expect(mux.clip_urls).toHaveLength(clips.length);
      expect(mux.shot_ms).toHaveLength(clips.length);
      expect(mux.shot_ms!.reduce((s, x) => s + x, 0)).toBe(ms);
      mux.shot_ms!.forEach((onScreen, i) => {
        expect(onScreen).toBeLessThanOrEqual(REACTION_MAX_SHOT_MS);
        expect(onScreen).toBeLessThanOrEqual(clips[i].duration * 1000);
      });
      expect(result.duration_ms).toBe(ms + CUT_DRIFT_MS);
    },
  );

  it('reuses the draft audio: no voicing step, and the cut muxes the draft’s own audio key', async () => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(9_000)], fakes);
    const allowed = new Set(['composedSkillState', 'fetchDraftAudio', 'productHeroClip', 'muxProductHero']);
    for (const name of fakes.names()) expect(allowed.has(name)).toBe(true);
    expect((fakes.callsTo('fetchDraftAudio') as FetchDraftAudioInput[])[0].audio_key).toBe(AUDIO_KEY);
    expect((fakes.callsTo('muxProductHero') as MuxProductHeroInput[])[0].audio_key).toBe(AUDIO_KEY);
  });
});

describe('makeReactionWorkflow — refusals before anything is requested', () => {
  it.each<[string, Partial<MakeReactionWorkflowInput>]>([
    ['no character reference', { character_image_url: undefined }],
    ['a blank character reference', { character_image_url: '  ' }],
    ['no resolved Modesty (the hijab depends on it)', { modesty: null }],
    ['arms less modest than the Preset allows', { modesty: { arms: 'bare', hijab: false } as unknown as Modesty }],
  ])('refuses %s', async (_label, over) => {
    const fakes = happyFakes();
    await expect(harness.execute('makeReactionWorkflow', [renderInput(9_000, over)], fakes)).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(fakes.names()).not.toContain('fetchDraftAudio');
    expect(fakes.names()).not.toContain('productHeroClip');
    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    expect(states.at(-1)).toMatchObject({ status: 'failed', error_code: 'INVALID_INPUT' });
    expect(fakes.callsTo('releaseDraftRender')).toEqual([{ skill_run_id: SKILL_RUN_ID, draft_id: 'draft-19' }]);
  });
});

describe('makeReactionWorkflow — a failure refunds every charged child and releases the draft', () => {
  const failAt: Array<[string, CannedActivities]> = [
    ['the audio fetch', { fetchDraftAudio: () => { throw ApplicationFailure.nonRetryable('no such object', 'DRAFT_AUDIO_MISSING'); } }],
    ['the third clip', {
      productHeroClip: (i: ProductHeroClipInput) => {
        if (i.shot_index === 2) throw ApplicationFailure.nonRetryable('provider 400', 'EVOLINK_400');
        return { primitive_run_id: i.primitive_run_id, video_url: 'https://r2.example.test/c.mp4', duration_seconds: i.duration, credits_actual_usd: 0.6 };
      },
    }],
    ['a moderation verdict on a reaction shot', {
      productHeroClip: () => {
        throw ApplicationFailure.create({ message: 'blocked by content moderation', type: 'EVOLINK_CONTENT_POLICY_VIOLATION', nonRetryable: false });
      },
    }],
    ['the mux', { muxProductHero: () => { throw ApplicationFailure.nonRetryable('ffmpeg exploded', 'MUX_FAILED'); } }],
  ];

  it.each(failAt)('at %s', async (_where, overrides) => {
    const fakes = happyFakes(overrides);
    await expect(harness.execute('makeReactionWorkflow', [renderInput(12_000)], fakes)).rejects.toBeInstanceOf(WorkflowFailedError);

    const refunded = new Set((fakes.callsTo('refundCredits') as Array<{ primitive_run_id: string }>).map((r) => r.primitive_run_id));
    for (const clip of clipsOf(fakes)) expect(refunded.has(clip.primitive_run_id)).toBe(true);
    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    expect(states.at(-1)).toMatchObject({ status: 'failed' });
    expect(states.some((s) => s.status === 'succeeded')).toBe(false);

    expect(fakes.callsTo('releaseDraftRender')).toEqual([{ skill_run_id: SKILL_RUN_ID, draft_id: 'draft-19' }]);
    const names = fakes.names();
    expect(names.indexOf('releaseDraftRender')).toBeGreaterThan(names.lastIndexOf('refundCredits'));
  });

  it('keeps the draft claimed when the render succeeds', async () => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(9_000)], fakes);
    expect(fakes.names()).not.toContain('releaseDraftRender');
    expect(fakes.names()).not.toContain('refundCredits');
  });
});

describe('make_reaction registration', () => {
  it('is a registered workflow type that takes no prompts and no Preset definition', () => {
    expect(Object.keys(workflows)).toContain('makeReactionWorkflow');
    expectTypeOf<MakeReactionWorkflowInput>().not.toHaveProperty('preset');
    expectTypeOf<MakeReactionWorkflowInput>().not.toHaveProperty('shotPrompts');
    expectTypeOf<MakeReactionWorkflowInput>().not.toHaveProperty('prompt');
  });

  it('resolves the Reaction render definition server-side by id', () => {
    expect(presetRender('reaction')).toBe(REACTION_RENDER);
  });

  it('asks for a closed mouth on every reaction shot and shows nobody on a product shot', () => {
    expect(REACTION_RENDER.shotPrompts.reaction).toContain(SILENT_REACTION);
    expect(REACTION_RENDER.shotPrompts.reaction).toContain('@image2');
    expect(REACTION_RENDER.shotPrompts.product).not.toContain('@image2');
    expect(REACTION_RENDER.shotPrompts.product).toMatch(/No people/);
  });
});
