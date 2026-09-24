// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// #31 In-use Reference + Scale Anchors, through the real Preset workflows in
// Temporal's test environment with every provider faked:
//   - the In-use Reference is the DRAFT's (made free at drafting, api-v2): the
//     render reuses the image api-v2 hands it (in_use_reference_url) — no
//     step of its own, nothing made, nothing charged;
//   - hands and person shots use it as their product reference; product-only
//     shots keep the packshot; without one (not needed, "use original
//     instead", or its edit failed) every shot uses the photo;
//   - the charge is exactly the quote, with or without it;
//   - the Scale Anchor and the In-use Reference lines are in the hands and
//     person prompts only.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HANDS_ON, PRODUCT_HERO, REACTION, quotePresetCredits, type PresetDefinition, type ProductProfile } from '@agentmedia/schema';
import { startWorkflowHarness, fakeActivities, type CannedActivities, type WorkflowHarness } from './support/workflow-harness.js';
import type { PresetRenderInput } from '../workflows/render-preset.js';
import type { FetchDraftAudioInput, PresetClipInput, PresetMuxInput } from '../activities/preset-render.js';
import type { PresetStartingFrameInput } from '../activities/preset-frame.js';
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
    in_use_reference_url: IN_USE,
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

const clips = (f: ReturnType<typeof happyFakes>) => f.callsTo('presetClip') as PresetClipInput[];
const frames = (f: ReturnType<typeof happyFakes>) => f.callsTo('presetStartingFrame') as PresetStartingFrameInput[];
const finalOutput = (f: ReturnType<typeof happyFakes>) =>
  ((f.callsTo('composedSkillState') as Array<Record<string, unknown>>).find((s) => s.status === 'succeeded')?.final_output ?? {}) as Record<string, unknown>;

describe('the render reuses the draft’s In-use Reference: no step of its own', () => {
  it('Hands-on: nothing is made or charged for it; the Short records the image it used', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [input('makeHandsOnWorkflow')], fakes);
    expect(fakes.names().filter((n) => /in.?use/i.test(n))).toEqual([]);
    expect(finalOutput(fakes).in_use_reference).toEqual({ image_url: IN_USE, source_product_image_url: PHOTO });
  });

  it.each([
    ['the used state is the photo’s', { product_profile: SAME_AS_PHOTO, in_use_reference_url: undefined }],
    ['the draft has no Product Profile', { product_profile: null, in_use_reference_url: undefined }],
    ['the user chose “use original instead”, or its edit failed (api-v2 sends none)', { in_use_reference_url: null }],
  ])('none when %s: every shot from the photo', async (_why, over) => {
    for (const wf of ['makeHandsOnWorkflow', 'makeReactionWorkflow'] as const) {
      const fakes = happyFakes();
      await harness.execute(wf, [input(wf, over)], fakes);
      for (const c of clips(fakes)) expect(c.start_image_url).toBe(c.shot_kind === 'hands' ? frameUrl(c.shot_index) : PHOTO);
      for (const f of frames(fakes)) expect(f.product_image_url).toBe(PHOTO);
      expect(finalOutput(fakes).in_use_reference).toBeNull();
      const shots = finalOutput(fakes).shots as Array<{ product_reference: string }>;
      expect(shots.every((s) => s.product_reference === 'product_photo')).toBe(true);
    }
  });

  it('a Preset with no hands or person shot (Product Hero) never uses one', async () => {
    const fakes = happyFakes();
    await harness.execute('makeProductHeroWorkflow', [input('makeProductHeroWorkflow')], fakes);
    for (const c of clips(fakes)) expect(c.start_image_url).toBe(PHOTO);
    expect(finalOutput(fakes).in_use_reference).toBeNull();
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

  it('without one (the original photo): the Scale Anchor stays, the In-use line goes', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [input('makeHandsOnWorkflow', { in_use_reference_url: null })], fakes);
    const hands = clips(fakes).find((c) => c.shot_kind === 'hands')!;
    expect(hands.prompt).toContain('Real size');
    expect(hands.prompt).not.toContain('nowhere in the scene');
  });
});

describe('quote == charge, with or without the In-use Reference', () => {
  const presets: Array<[Wf, PresetDefinition]> = [
    ['makeHandsOnWorkflow', HANDS_ON],
    ['makeReactionWorkflow', REACTION],
    ['makeProductHeroWorkflow', PRODUCT_HERO],
  ];
  it.each(presets)('%s', async (wf, preset) => {
    for (const inUse of [IN_USE, null]) {
      for (const ms of [6_000, 12_000, 15_000]) {
        const fakes = happyFakes();
        await harness.execute(wf, [input(wf, { duration_ms: ms, in_use_reference_url: inUse })], fakes);
        const charged =
          frames(fakes).reduce((s, f) => s + quotePrimitiveCredits('preset_frame', undefined, f.frame), 0) +
          // Every clip of these runs rendered on its first model: charged its chain's price.
          clips(fakes).reduce((s, c) => {
            const kind = (preset.shotKinds as Record<string, { video?: Parameters<typeof quotePrimitiveCredits>[3] }>)[c.shot_kind];
            return s + quotePrimitiveCredits('product_hero_clip', c.duration as 5 | 10, undefined, kind?.video);
          }, 0);
        expect(charged).toBe(quotePresetCredits(preset, ms));
      }
    }
  });
});
