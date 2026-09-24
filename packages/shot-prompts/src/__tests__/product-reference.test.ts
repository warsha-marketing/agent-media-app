// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// #31: the Scale Anchor and the In-use Reference lines — their wording from the
// Product Profile, and where they go (hands and person shots, both stages;
// never a product shot).

import { describe, it, expect } from 'vitest';
import { HANDS_ON, REACTION, PRODUCT_HERO, SIZE_CLASSES, type Modesty, type ProductProfile } from '@agentmedia/schema';
import {
  HANDS_ON_PROMPTS,
  IMAGE_REFERENCES,
  PRODUCT_HERO_PROMPTS,
  REACTION_PROMPTS,
  REFERENCE_TOKENS,
  SCALE_ANCHOR_WORDS,
  composeShotPlan,
  dimensionWords,
  inUseReferenceLine,
  inUseReferencePrompt,
  scaleAnchorLine,
  shotPrompt,
  type ShotPlanPreset,
} from '../index.js';

const COVERED: Modesty = { arms: 'covered', hijab: false };

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

describe('Scale Anchor wording, per size class', () => {
  const noDims = { height_cm: null, width_cm: null, volume_ml: null };
  const expected: Record<(typeof SIZE_CLASSES)[number], string> = {
    tiny: 'Real size: the product is tiny, about the size of her thumb, held between the fingertips; it keeps exactly this size next to the hands and body in every frame.',
    palm: 'Real size: the product is small, about the height of her palm, fits easily in one hand; it keeps exactly this size next to the hands and body in every frame.',
    hand: 'Real size: the product is about as tall as her whole hand, held comfortably in one hand; it keeps exactly this size next to the hands and body in every frame.',
    two_hands: 'Real size: the product is large, wider than her hand, held with both hands; it keeps exactly this size next to the hands and body in every frame.',
    large: 'Real size: the product is large, far bigger than her hands, resting on a surface rather than held up; it keeps exactly this size next to the hands and body in every frame.',
  };
  for (const size of SIZE_CLASSES) {
    it(`${size}`, () => {
      expect(scaleAnchorLine({ size_class: size, dimensions: noDims }, 'female')).toBe(expected[size]);
    });
  }

  it('has wording for every size class', () => {
    expect(Object.keys(SCALE_ANCHOR_WORDS).sort()).toEqual([...SIZE_CLASSES].sort());
  });

  it('says whose hand, or "the" when unknown', () => {
    expect(scaleAnchorLine({ size_class: 'palm', dimensions: noDims }, 'male')).toContain('the height of his palm');
    expect(scaleAnchorLine({ size_class: 'palm', dimensions: noDims })).toContain('the height of the palm');
  });

  it('adds the dimensions when the Profile knows them', () => {
    expect(scaleAnchorLine(PERFUME, 'female')).toBe(
      'Real size: the product is small, about the height of her palm, fits easily in one hand (about 12 cm tall, 100 ml); it keeps exactly this size next to the hands and body in every frame.',
    );
    expect(dimensionWords({ height_cm: 7.25, width_cm: 3, volume_ml: null })).toBe('about 7.3 cm tall, about 3 cm wide');
    expect(dimensionWords(noDims)).toBe('');
  });

  it('is absent without a Profile', () => {
    expect(scaleAnchorLine(null)).toBeNull();
  });
});

describe('In-use Reference wording', () => {
  it('names every removed part as nowhere in the scene', () => {
    expect(inUseReferenceLine(PERFUME)).toBe(
      `The product is already in the state it is used in, exactly as in ${REFERENCE_TOKENS.start}: the silver crown cap is removed and nowhere in the scene (not in a hand, not on a surface, not in the background), and no second silver crown cap appears.`,
    );
    const two = inUseReferenceLine({ parts: [{ name: 'lid', removable: true }, { name: 'seal', removable: true }] });
    expect(two).toContain('the lid and seal are removed and nowhere in the scene');
  });

  it('with no removable part, keeps the product as it is', () => {
    expect(inUseReferenceLine({ parts: [{ name: 'jar', removable: false }] })).toMatch(/nothing is added to it or taken off it\.$/);
  });

  it('the edit prompt: product only, the used state, the part removed, everything else identical', () => {
    const p = inUseReferencePrompt(PERFUME);
    expect(p).toContain('uncapped, short silver spray neck visible');
    expect(p).toContain('The silver crown cap is REMOVED and nowhere in the image');
    expect(p).toContain('logo and label text');
    expect(p).toContain('no people, no hands');
  });

  it('strips prompt syntax from the user-editable Profile text', () => {
    const p = inUseReferencePrompt({ ...PERFUME, used_state: 'open @image2 [lid off]', parts: [{ name: '{{cap}}', removable: true }] });
    expect(p).not.toMatch(/[@[\]{}]/);
  });
});

const handsCtx = (inUse: boolean) => ({
  durationMs: 12_000,
  modesty: COVERED,
  vars: HANDS_ON_PROMPTS.promptVars!({ hand_gender: 'female', setting: 'dressing_table' }),
  product: { profile: PERFUME, inUseReference: inUse, handGender: 'female' as const },
});

describe('where the lines go', () => {
  it('Hands-on: both lines on the hands shot, both stages; none on the product closer', () => {
    const plan = composeShotPlan({ ...HANDS_ON, ...HANDS_ON_PROMPTS } as ShotPlanPreset, handsCtx(true));
    const hands = plan.shots.find((s) => s.shows === 'hands')!;
    const product = plan.shots.find((s) => s.shows === 'product')!;
    for (const stage of ['image', 'video'] as const) {
      const ids = hands.guardrails[stage].map((g) => g.id);
      expect(ids).toContain('in_use_reference');
      expect(ids).toContain('scale_anchor');
      const prompt = shotPrompt(hands, stage, IMAGE_REFERENCES);
      expect(prompt).toContain('about the height of her palm');
      expect(prompt).toContain('the silver crown cap is removed and nowhere in the scene');
    }
    const productPrompt = shotPrompt(product, 'video', IMAGE_REFERENCES);
    expect(product.guardrails.video.map((g) => g.id)).not.toContain('scale_anchor');
    expect(productPrompt).not.toContain('Real size');
    expect(productPrompt).not.toContain('nowhere in the scene');
  });

  it('without an In-use Reference (not needed, or the original chosen): the Scale Anchor only', () => {
    const plan = composeShotPlan({ ...HANDS_ON, ...HANDS_ON_PROMPTS } as ShotPlanPreset, handsCtx(false));
    const hands = plan.shots.find((s) => s.shows === 'hands')!;
    const ids = hands.guardrails.video.map((g) => g.id);
    expect(ids).toContain('scale_anchor');
    expect(ids).not.toContain('in_use_reference');
  });

  it('Reaction: on every person shot, on every model of its chain, never on a product shot', () => {
    const plan = composeShotPlan({ ...REACTION, ...REACTION_PROMPTS } as ShotPlanPreset, {
      durationMs: 12_000,
      modesty: { arms: 'covered', hijab: true },
      person: { gender: 'female' },
      product: { profile: PERFUME, inUseReference: true },
    });
    for (const s of plan.shots) {
      const lists = Object.values(s.video_guardrails_by_model);
      for (const list of lists) {
        const ids = list!.map((g) => g.id);
        if (s.shows === 'person') {
          expect(ids).toEqual(expect.arrayContaining(['in_use_reference', 'scale_anchor']));
        } else {
          expect(ids).not.toContain('in_use_reference');
          expect(ids).not.toContain('scale_anchor');
        }
      }
    }
    const person = plan.shots.find((s) => s.shows === 'person')!;
    expect(shotPrompt(person, 'video', IMAGE_REFERENCES)).toContain('about the height of her palm');
  });

  it('Product Hero (nobody on screen): neither line', () => {
    const plan = composeShotPlan({ ...PRODUCT_HERO, ...PRODUCT_HERO_PROMPTS } as ShotPlanPreset, {
      durationMs: 12_000,
      modesty: COVERED,
      product: { profile: PERFUME, inUseReference: true },
    });
    for (const s of plan.shots) expect(s.guardrails.video.map((g) => g.id)).not.toContain('scale_anchor');
  });

  it('without a Profile: prompts are unchanged', () => {
    const preset = { ...HANDS_ON, ...HANDS_ON_PROMPTS } as ShotPlanPreset;
    const { product: _p, ...bare } = handsCtx(true);
    const a = composeShotPlan(preset, bare);
    const b = composeShotPlan(preset, { ...bare, product: { profile: null, inUseReference: true } });
    expect(b).toEqual(a);
  });
});
