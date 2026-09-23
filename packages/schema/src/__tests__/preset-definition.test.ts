// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Presets as data — a Preset is a definition on the shared render pipeline, not
 * its own pipeline. The shot plan (which kinds of shots, in what order), the
 * speech band and the cost budget are read from the definition; the clip-length
 * rule (fewest 5/10 s clips covering the audio) is shared by every Preset.
 */

import { describe, it, expect } from 'vitest';
import {
  planPresetShots,
  presetProviderUsd,
  quotePresetCredits,
  type PresetDefinition,
} from '../preset-definition.js';
import { PRESETS } from '../preset-registry.js';
import { PRODUCT_HERO, planProductHeroShots, productHeroProviderUsd, quoteProductHeroCredits } from '../product-hero.js';

/** A test-only Preset: intercut people and product, always ending on the product. */
const INTERCUT: PresetDefinition<'product' | 'person'> = {
  id: 'test_intercut',
  name: 'Test Intercut',
  aspectRatio: '9:16',
  minSpeechMs: 5_000,
  maxSpeechMs: 15_000,
  shotPlan: { order: ['person', 'product'], last: 'product' },
  requiredInputs: ['product_image'],
  budget: { maxCredits: 420, maxProviderUsd: 1.8 },
};

describe('planPresetShots', () => {
  it('gives each clip a kind from the definition’s order, ending on the declared last kind', () => {
    expect(planPresetShots(INTERCUT, 5_000)).toEqual([{ kind: 'product', seconds: 5 }]);
    expect(planPresetShots(INTERCUT, 8_000)).toEqual([{ kind: 'product', seconds: 10 }]);
    expect(planPresetShots(INTERCUT, 12_000)).toEqual([
      { kind: 'person', seconds: 10 },
      { kind: 'product', seconds: 5 },
    ]);
  });

  it('cycles the order when a plan has more clips than the order names', () => {
    const cycling: PresetDefinition<'a' | 'b'> = { ...INTERCUT, maxSpeechMs: 30_000, shotPlan: { order: ['a', 'b'] }, budget: { maxCredits: 840, maxProviderUsd: 3.6 } };
    expect(planPresetShots(cycling, 30_000).map((s) => s.kind)).toEqual(['a', 'b', 'a']);
  });

  it('uses the shared 5/10 s clip rule for every Preset', () => {
    for (const ms of [5_000, 5_001, 10_000, 10_001, 15_000]) {
      expect(planPresetShots(INTERCUT, ms).map((s) => s.seconds)).toEqual(planProductHeroShots(ms));
    }
  });

  it('refuses a duration outside the definition’s own speech band', () => {
    const narrow = { ...INTERCUT, name: 'Narrow', minSpeechMs: 6_000, maxSpeechMs: 9_000 };
    expect(() => planPresetShots(narrow, 5_500)).toThrow(RangeError);
    expect(() => planPresetShots(narrow, 9_001)).toThrow(/Narrow speech must be 6000–9000 ms/);
    expect(planPresetShots(narrow, 9_000)).toHaveLength(1);
  });
});

describe('Product Hero as one definition', () => {
  it('is the registered product_hero Preset', () => {
    expect(PRESETS.product_hero).toBe(PRODUCT_HERO);
    expect(PRODUCT_HERO.id).toBe('product_hero');
  });

  it('plans a hero shot, then a detail closer', () => {
    expect(planPresetShots(PRODUCT_HERO, 5_000).map((s) => s.kind)).toEqual(['hero']);
    expect(planPresetShots(PRODUCT_HERO, 10_000).map((s) => s.kind)).toEqual(['hero']);
    expect(planPresetShots(PRODUCT_HERO, 15_000).map((s) => s.kind)).toEqual(['hero', 'detail']);
  });

  it('quotes exactly what the Product Hero helpers quote', () => {
    for (let ms = PRODUCT_HERO.minSpeechMs; ms <= PRODUCT_HERO.maxSpeechMs; ms += 499) {
      expect(quotePresetCredits(PRODUCT_HERO, ms)).toBe(quoteProductHeroCredits(ms));
      expect(presetProviderUsd(PRODUCT_HERO, ms)).toBe(productHeroProviderUsd(ms));
    }
  });
});

// Each Preset declares its own budget; it is held here, not at run time.
describe.each(Object.values(PRESETS).map((p) => [p.id, p] as const))('the %s budget', (_id, preset) => {
  it('is never exceeded anywhere in its speech band', () => {
    for (let ms = preset.minSpeechMs; ms <= preset.maxSpeechMs; ms += 101) {
      expect(quotePresetCredits(preset, ms)).toBeLessThanOrEqual(preset.budget.maxCredits);
      expect(presetProviderUsd(preset, ms)).toBeLessThanOrEqual(preset.budget.maxProviderUsd + 1e-9);
    }
  });
});
