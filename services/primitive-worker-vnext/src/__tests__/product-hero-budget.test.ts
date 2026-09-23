// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Product Hero clips are charged from the shared clip table. What must hold:
// each clip is charged exactly the credits the API quote sums (so quote ==
// charge), and a clip length the plan never produces has no price. The Preset's
// declared budget is held by the plan tests in @agentmedia/schema.

import { describe, it, expect } from 'vitest';
import { planProductHeroShots, quoteProductHeroCredits, VIDEO_CLIP_CREDITS } from '@agentmedia/schema';
import { quotePrimitiveCredits } from '../client/credits.js';

describe('Product Hero clip charges', () => {
  it('charges each clip the credits the quote sums', () => {
    for (const ms of [5_000, 8_000, 10_000, 12_500, 15_000]) {
      const charged = planProductHeroShots(ms).reduce((s, d) => s + quotePrimitiveCredits('product_hero_clip', d), 0);
      expect(charged).toBe(quoteProductHeroCredits(ms));
    }
  });

  it('prices a silent clip like any other clip of its length', () => {
    expect(quotePrimitiveCredits('product_hero_clip', 5)).toBe(VIDEO_CLIP_CREDITS[5]);
    expect(quotePrimitiveCredits('product_hero_clip', 10)).toBe(quotePrimitiveCredits('simple_selfie', 10));
  });

  it('has no price for a clip length the plan never produces', () => {
    expect(() => quotePrimitiveCredits('product_hero_clip', 15)).toThrow(expect.objectContaining({ type: 'INVALID_INPUT' }));
  });
});
