// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The Product Hero Preset declares its own cost budget, which its clips are held
// to in place of the per-primitive cap. What must hold: every render in the
// 5–15 s band fits the budget; each clip is charged exactly the credits the API
// quote sums (so quote == charge); and a duration outside the band is refused as
// invalid input, not waved through.

import { describe, it, expect } from 'vitest';
import { PRODUCT_HERO, planProductHeroShots, quoteProductHeroCredits } from '@agentmedia/schema';
import { assertWithinProductHeroBudget, plannedProductHeroUsd, PRODUCT_HERO_BUDGET } from '../lib/preset-budget.js';
import { quotePrimitiveCredits } from '../client/credits.js';

describe('Product Hero Preset budget', () => {
  it('fits every render in the 5–15 s band', () => {
    for (let ms = PRODUCT_HERO.minSpeechMs; ms <= PRODUCT_HERO.maxSpeechMs; ms += 250) {
      expect(() => assertWithinProductHeroBudget(ms)).not.toThrow();
      expect(plannedProductHeroUsd(ms)).toBeLessThanOrEqual(PRODUCT_HERO_BUDGET.maxRunUsd);
    }
  });

  it('refuses a render whose plan exceeds a tighter budget', () => {
    expect(() => assertWithinProductHeroBudget(15_000, { ...PRODUCT_HERO_BUDGET, maxRunUsd: 1 })).toThrow(
      expect.objectContaining({ type: 'BUDGET_CAP_PRESET', nonRetryable: true }),
    );
  });

  it('refuses a duration outside the contract as invalid input', () => {
    expect(() => assertWithinProductHeroBudget(16_000)).toThrow(expect.objectContaining({ type: 'INVALID_INPUT' }));
  });

  it('charges each clip the credits the quote sums', () => {
    for (const ms of [5_000, 8_000, 10_000, 12_500, 15_000]) {
      const charged = planProductHeroShots(ms).reduce((s, d) => s + quotePrimitiveCredits('product_hero_clip', d), 0);
      expect(charged).toBe(quoteProductHeroCredits(ms));
    }
  });
});
