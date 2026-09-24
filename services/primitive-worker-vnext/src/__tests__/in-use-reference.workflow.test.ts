// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// #31 In-use Reference + Scale Anchors, through the real Preset workflows in
// Temporal's test environment with every provider faked (the image edit too):
//   - the In-use Reference is made only when the Product Profile's used state
//     differs from the photo (and the user kept it), before any frame or clip;
//   - hands and person shots use it as their product reference; product-only
//     shots keep the packshot;
//   - "use original instead" skips it;
//   - a failure refunds it with every other charged step and releases the draft;
//   - the charge is exactly the quote, the image step included;
//   - the Scale Anchor and the In-use Reference lines are in the hands and
//     person prompts only.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ApplicationFailure } from '@temporalio/activity';
import { WorkflowFailedError } from '@temporalio/client';
import { HANDS_ON, PRODUCT_HERO, REACTION, quotePresetCredits, type PresetDefinition, type ProductProfile } from '@agentmedia/schema';
import { inUseReferencePrompt } from '@agentmedia/shot-prompts';
import { startWorkflowHarness, fakeActivities, type CannedActivities, type WorkflowHarness } from './support/workflow-harness.js';
import type { PresetRenderInput } from '../workflows/render-preset.js';
import type { FetchDraftAudioInput, PresetClipInput, PresetMuxInput } from '../activities/preset-render.js';
import type { PresetStartingFrameInput } from '../activities/preset-frame.js';
import type { PresetInUseReferenceInput } from '../activities/in-use-reference.js';
import { quotePrimitiveCredits } from '../client/credits.js';

const SKILL_RUN_ID = '31313131-2222-4333-8444-555555555555';
const PHOTO = 'https://r2.example.test/uploads/product.png';
const IN_USE = 'https://r2.example.test/in-use/uncapped.png';
const CHARACTER = 'https://r2.example.test/uploads/character.png';
const frameUrl = (i: number) => `https://r2.example.test/frames/${i}.png`;

const PERFUME: ProductProfile = {
  category: 'fragrance_oud',
  dimensions: { height_cm: 12, width_cm: null, volume_ml: 100 },
  size_class: 'palm',
  parts: [
    { name: 'silver crown cap', removable: true },
    { name: 'bottle', removable: false },
  ],
  used_state: 'uncapped, short silver spray neck visible',
  differs_from_photo: true,
  interaction_verbs: ['spray'],
  grip: 'held upright in one hand',
  physics_risks: ['separate_cap'],
  confidence: 0.9,
};
const SAME_AS_PHOTO: ProductProfile = { ...PERFUME, differs_from_photo: false };

type Wf = 'makeHandsOnWorkflow' | 'makeReactionWorkflow' | 'makeProductHeroWorkflow';

function input(wf: Wf, over: Partial<PresetRenderInput> = {}): PresetRenderInput {
  const base: PresetRenderInput = {
    skill_run_id: SKILL_RUN_ID,
    user_id: 'user-1',
    draft_id: 'draft-31',
    audio_key: 'vnext/drafts/user-1/draft-31.mp3',
    duration_ms: 12_000,
    product_image_url: PHOTO,
    aspect_ratio: '9:16',
    product_profile: PERFUME,
  };
  if (wf === 'makeHandsOnWorkflow') Object.assign(base, { hand_gender: 'female', setting: 'dressing_table', modesty: { arms: 'covered', hijab: false } });
  if (wf === 'makeReactionWorkflow') {
    Object.assign(base, { character_image_url: CHARACTER, character_gender: 'female', modesty: { arms: 'covered', hijab: true } });
  }
  return { ...base, ...over };
}

function happyFakes(overrides: CannedActivities = {}) {
  return fakeActivities({
    composedSkillState: undefined,
    refundCredits: undefined,
    markPrimitiveRunFailed: undefined,
    releaseDraftRender: undefined,
    fetchDraftAudio: (i: FetchDraftAudioInput) => ({ primitive_run_id: i.primitive_run_id, audio_key: i.audio_key, duration_ms: i.duration_ms }),
    presetInUseReference: (i: PresetInUseReferenceInput) => ({ primitive_run_id: i.primitive_run_id, image_url: IN_USE, credits_actual_usd: 0.25 }),
    presetStartingFrame: (i: PresetStartingFrameInput) => ({ primitive_run_id: i.primitive_run_id, image_url: frameUrl(i.shot_index), credits_actual_usd: 0.25 }),
    presetClip: (i: PresetClipInput) => ({
      primitive_run_id: i.primitive_run_id,
      video_url: `https://r2.example.test/clips/${i.shot_index}.mp4`,
      duration_seconds: i.duration,
      credits_actual_usd: i.duration === 10 ? 1.2 : 0.6,
    }),
    presetMux: (i: PresetMuxInput) => ({
      primitive_run_id: i.primitive_run_id,
      video_url: 'https://r2.example.test/shorts/final.mp4',
      duration_ms: i.audio_duration_ms + 10,
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

const inUseCalls = (f: ReturnType<typeof happyFakes>) => f.callsTo('presetInUseReference') as PresetInUseReferenceInput[];
const clips = (f: ReturnType<typeof happyFakes>) => f.callsTo('presetClip') as PresetClipInput[];
const frames = (f: ReturnType<typeof happyFakes>) => f.callsTo('presetStartingFrame') as PresetStartingFrameInput[];
const finalOutput = (f: ReturnType<typeof happyFakes>) =>
  ((f.callsTo('composedSkillState') as Array<Record<string, unknown>>).find((s) => s.status === 'succeeded')?.final_output ?? {}) as Record<string, unknown>;

describe('the In-use Reference is made only when the used state differs', () => {
  it('Hands-on: made once, from the product photo with the Profile’s edit prompt, after the audio and before any frame or clip', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [input('makeHandsOnWorkflow')], fakes);
    const [made, ...more] = inUseCalls(fakes);
    expect(more).toEqual([]);
    expect(made).toMatchObject({ product_image_url: PHOTO, preset: 'hands_on', prompt: inUseReferencePrompt(PERFUME) });
    const names = fakes.names();
    expect(names.indexOf('fetchDraftAudio')).toBeLessThan(names.indexOf('presetInUseReference'));
    expect(names.indexOf('presetInUseReference')).toBeLessThan(names.indexOf('presetStartingFrame'));
    expect(finalOutput(fakes).in_use_reference).toEqual({ image_url: IN_USE, source_product_image_url: PHOTO });
  });

  it.each([
    ['the used state is the photo’s', { product_profile: SAME_AS_PHOTO }],
    ['the draft has no Product Profile', { product_profile: null }],
    ['the user chose “use original instead”', { use_original_product_photo: true }],
  ])('not made when %s', async (_why, over) => {
    for (const wf of ['makeHandsOnWorkflow', 'makeReactionWorkflow'] as const) {
      const fakes = happyFakes();
      await harness.execute(wf, [input(wf, over)], fakes);
      expect(inUseCalls(fakes)).toEqual([]);
      for (const c of clips(fakes)) expect(c.start_image_url).toBe(c.shot_kind === 'hands' ? frameUrl(c.shot_index) : PHOTO);
      for (const f of frames(fakes)) expect(f.product_image_url).toBe(PHOTO);
      expect(finalOutput(fakes).in_use_reference).toBeNull();
    }
  });

  it('not made for a Preset with no hands or person shot (Product Hero)', async () => {
    const fakes = happyFakes();
    await harness.execute('makeProductHeroWorkflow', [input('makeProductHeroWorkflow')], fakes);
    expect(inUseCalls(fakes)).toEqual([]);
    for (const c of clips(fakes)) expect(c.start_image_url).toBe(PHOTO);
  });
});

describe('hands and person shots use it; product-only shots keep the packshot', () => {
  it('Hands-on: the hands frame is edited from the In-use Reference; the product closer animates the photo', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [input('makeHandsOnWorkflow')], fakes);
    expect(frames(fakes).map((f) => [f.shot_kind, f.product_image_url])).toEqual([['hands', IN_USE]]);
    expect(clips(fakes).map((c) => [c.shot_kind, c.start_image_url])).toEqual([
      ['hands', frameUrl(0)],
      ['product', PHOTO],
    ]);
    const shots = finalOutput(fakes).shots as Array<{ kind: string; product_reference: string }>;
    expect(shots.map((s) => [s.kind, s.product_reference])).toEqual([
      ['hands', 'in_use_reference'],
      ['product', 'product_photo'],
    ]);
  });

  it('Reaction: every person clip animates the In-use Reference; every product clip the photo', async () => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [input('makeReactionWorkflow')], fakes);
    const cs = clips(fakes);
    expect(cs.some((c) => c.shot_kind === 'reaction')).toBe(true);
    for (const c of cs) expect(c.start_image_url).toBe(c.shot_kind === 'reaction' ? IN_USE : PHOTO);
  });
});

describe('prompts: the Scale Anchor and the In-use Reference line, hands and person shots only', () => {
  it.each(['makeHandsOnWorkflow', 'makeReactionWorkflow'] as const)('%s', async (wf) => {
    const fakes = happyFakes();
    await harness.execute(wf, [input(wf)], fakes);
    const prompts = [
      ...frames(fakes).map((f) => ({ kind: f.shot_kind, prompt: f.prompt })),
      ...clips(fakes).map((c) => ({ kind: c.shot_kind, prompt: c.prompt })),
    ];
    for (const { kind, prompt } of prompts) {
      if (kind === 'product') {
        expect(prompt).not.toContain('Real size');
        expect(prompt).not.toContain('nowhere in the scene');
      } else {
        expect(prompt).toContain('about the height of her palm, fits easily in one hand (about 12 cm tall, 100 ml)');
        expect(prompt).toContain('the silver crown cap is removed and nowhere in the scene');
      }
    }
  });

  it('with the original photo chosen: the Scale Anchor stays, the In-use line goes', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [input('makeHandsOnWorkflow', { use_original_product_photo: true })], fakes);
    const hands = clips(fakes).find((c) => c.shot_kind === 'hands')!;
    expect(hands.prompt).toContain('Real size');
    expect(hands.prompt).not.toContain('nowhere in the scene');
  });
});

describe('quote == charge, the image step included', () => {
  const presets: Array<[Wf, PresetDefinition]> = [
    ['makeHandsOnWorkflow', HANDS_ON],
    ['makeReactionWorkflow', REACTION],
    ['makeProductHeroWorkflow', PRODUCT_HERO],
  ];
  it.each(presets)('%s', async (wf, preset) => {
    for (const [profile, useOriginal] of [[PERFUME, false], [PERFUME, true], [SAME_AS_PHOTO, false]] as const) {
      for (const ms of [6_000, 12_000, 15_000]) {
        const fakes = happyFakes();
        await harness.execute(wf, [input(wf, { duration_ms: ms, product_profile: profile, use_original_product_photo: useOriginal })], fakes);
        const charged =
          inUseCalls(fakes).reduce((s) => s + quotePrimitiveCredits('in_use_reference'), 0) +
          frames(fakes).reduce((s, f) => s + quotePrimitiveCredits('preset_frame', undefined, f.frame), 0) +
          // Every clip of these runs rendered on its first model: charged its chain's price.
          clips(fakes).reduce((s, c) => {
            const kind = (preset.shotKinds as Record<string, { video?: Parameters<typeof quotePrimitiveCredits>[3] }>)[c.shot_kind];
            return s + quotePrimitiveCredits('product_hero_clip', c.duration as 5 | 10, undefined, kind?.video);
          }, 0);
        const made = profile.differs_from_photo && !useOriginal && preset !== PRODUCT_HERO;
        expect(inUseCalls(fakes)).toHaveLength(made ? 1 : 0);
        expect(charged).toBe(quotePresetCredits(preset, ms, { inUseReference: made }));
      }
    }
  });
});

describe('a failure refunds the In-use Reference and releases the draft', () => {
  it('the edit itself failing: refunded, nothing else requested, the draft given back', async () => {
    const fakes = happyFakes({
      presetInUseReference: () => {
        throw ApplicationFailure.nonRetryable('image refused', 'OPENAI_400');
      },
    });
    await expect(harness.execute('makeHandsOnWorkflow', [input('makeHandsOnWorkflow')], fakes)).rejects.toBeInstanceOf(WorkflowFailedError);
    const [attempt] = inUseCalls(fakes);
    const refunded = (fakes.callsTo('refundCredits') as Array<{ primitive_run_id: string }>).map((r) => r.primitive_run_id);
    expect(refunded).toContain(attempt.primitive_run_id);
    expect(fakes.names()).not.toContain('presetStartingFrame');
    expect(fakes.names()).not.toContain('presetClip');
    expect(fakes.callsTo('markPrimitiveRunFailed')).toContainEqual(expect.objectContaining({ primitive_run_id: attempt.primitive_run_id, error_code: 'OPENAI_400' }));
    expect(fakes.callsTo('releaseDraftRender')).toEqual([{ skill_run_id: SKILL_RUN_ID, draft_id: 'draft-31' }]);
  });

  it('a later clip failing: the In-use Reference is refunded with every frame and clip', async () => {
    const fakes = happyFakes({
      presetClip: (i: PresetClipInput) => {
        if (i.shot_kind === 'product') throw ApplicationFailure.nonRetryable('provider refused', 'EVOLINK_400');
        return { primitive_run_id: i.primitive_run_id, video_url: 'https://r2.example.test/c.mp4', duration_seconds: i.duration, credits_actual_usd: 1.2 };
      },
    });
    await expect(harness.execute('makeHandsOnWorkflow', [input('makeHandsOnWorkflow')], fakes)).rejects.toBeInstanceOf(WorkflowFailedError);
    const refunded = new Set((fakes.callsTo('refundCredits') as Array<{ primitive_run_id: string }>).map((r) => r.primitive_run_id));
    for (const c of [...inUseCalls(fakes), ...frames(fakes), ...clips(fakes)]) expect(refunded.has(c.primitive_run_id)).toBe(true);
    expect(fakes.callsTo('releaseDraftRender')).toEqual([{ skill_run_id: SKILL_RUN_ID, draft_id: 'draft-31' }]);
    const names = fakes.names();
    expect(names.indexOf('releaseDraftRender')).toBeGreaterThan(names.lastIndexOf('refundCredits'));
  });
});
