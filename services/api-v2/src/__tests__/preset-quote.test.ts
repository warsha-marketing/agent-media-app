// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Presets as data (#16): the quote reads a Preset render skill's DEFINITION
// (SkillEntry.preset) — the same definition the worker renders from — and never
// branches on the Preset's name. A second, test-only Preset is priced by the
// same path as Product Hero.

import { describe, it, expect, afterEach } from 'vitest';
import { PRODUCT_HERO, quotePresetCredits, type PresetDefinition } from '@agentmedia/schema';
import { SKILLS } from '../skills/registry.js';
import { quoteSkillCredits } from '../skills/credit-quotes.js';

/** Test-only: a narrower band than Product Hero, so pricing must read the definition. */
const NARROW: PresetDefinition<'person' | 'product'> = {
  id: 'test_narrow',
  name: 'Test Narrow',
  aspectRatio: '9:16',
  minSpeechMs: 5_000,
  maxSpeechMs: 10_000,
  shotPlan: { order: ['person', 'product'], last: 'product' },
  requiredInputs: ['product_image'],
  musicBed: [],
  budget: { maxCredits: 280, maxProviderUsd: 1.2 },
};

afterEach(() => {
  delete SKILLS.make_test_narrow;
});

describe('quoting a Preset render skill', () => {
  it('Product Hero is registered with its definition', () => {
    expect(SKILLS.make_product_hero.preset).toBe(PRODUCT_HERO);
  });

  it('prices a second Preset from its own definition', () => {
    SKILLS.make_test_narrow = { ...SKILLS.make_product_hero, slug: 'make_test_narrow', preset: NARROW };
    for (const ms of [5_000, 7_500, 10_000]) {
      expect(quoteSkillCredits('make_test_narrow', { duration_ms: ms })).toBe(quotePresetCredits(NARROW, ms));
    }
    // Outside this Preset's band (though inside Product Hero's): no plan, no price.
    expect(() => quoteSkillCredits('make_test_narrow', { duration_ms: 12_000 })).toThrow(RangeError);
  });

  it('fails closed without a duration to plan from', () => {
    SKILLS.make_test_narrow = { ...SKILLS.make_product_hero, slug: 'make_test_narrow', preset: NARROW };
    expect(() => quoteSkillCredits('make_test_narrow', {})).toThrow(RangeError);
  });
});
