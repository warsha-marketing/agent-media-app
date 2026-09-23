// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Product Hero shot planning — how a measured speech length becomes clips.
 *
 * api-v2 prices from this plan and the worker renders from it, so the quote the
 * user confirms is the charge. The rule under test: fill the audio with the
 * fewest 5/10 s clips whose total covers it (never less, so the visuals are only
 * ever trimmed, and the audio never is), wasting under one short clip.
 */

import { describe, it, expect } from 'vitest';
import {
  PRODUCT_HERO,
  planProductHeroShots,
  productHeroProviderUsd,
  quoteProductHeroCredits,
} from '../product-hero.js';
import { VIDEO_CLIP_CREDITS, VIDEO_CLIP_USD } from '../video-pricing.js';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('planProductHeroShots', () => {
  it('plans the documented shots at the band edges and in between', () => {
    expect(planProductHeroShots(5_000)).toEqual([5]);
    expect(planProductHeroShots(5_001)).toEqual([10]);
    expect(planProductHeroShots(7_500)).toEqual([10]);
    expect(planProductHeroShots(10_000)).toEqual([10]);
    expect(planProductHeroShots(10_001)).toEqual([10, 5]);
    expect(planProductHeroShots(12_345)).toEqual([10, 5]);
    expect(planProductHeroShots(15_000)).toEqual([10, 5]);
  });

  it('always covers the audio, wasting less than one short clip', () => {
    for (let ms = PRODUCT_HERO.minSpeechMs; ms <= PRODUCT_HERO.maxSpeechMs; ms += 37) {
      const shots = planProductHeroShots(ms);
      const covered = sum(shots) * 1000;
      expect(covered).toBeGreaterThanOrEqual(ms);
      expect(covered - ms).toBeLessThan(5_000);
      for (const s of shots) expect([5, 10]).toContain(s);
    }
  });

  it('refuses a duration outside the 5–15 s contract', () => {
    expect(() => planProductHeroShots(4_999)).toThrow(RangeError);
    expect(() => planProductHeroShots(15_001)).toThrow(RangeError);
    expect(() => planProductHeroShots(Number.NaN)).toThrow(RangeError);
  });
});

describe('quoteProductHeroCredits', () => {
  it('prices exactly the planned clips', () => {
    expect(quoteProductHeroCredits(5_000)).toBe(140);
    expect(quoteProductHeroCredits(8_000)).toBe(280);
    expect(quoteProductHeroCredits(12_000)).toBe(420);
    expect(quoteProductHeroCredits(15_000)).toBe(420);
  });

  it('prices clips from the shared clip table, like every other video', () => {
    for (const ms of [5_000, 8_000, 12_000]) {
      const shots = planProductHeroShots(ms);
      expect(quoteProductHeroCredits(ms)).toBe(sum(shots.map((s) => VIDEO_CLIP_CREDITS[s])));
      expect(productHeroProviderUsd(ms)).toBeCloseTo(sum(shots.map((s) => VIDEO_CLIP_USD[s])), 9);
    }
  });

  // The Preset's declared budget is enforced here, not at run time: no duration
  // in the band may plan a render over it (credits charged or provider USD).
  it('never exceeds the Preset budget anywhere in the band', () => {
    for (let ms = PRODUCT_HERO.minSpeechMs; ms <= PRODUCT_HERO.maxSpeechMs; ms += 101) {
      expect(quoteProductHeroCredits(ms)).toBeLessThanOrEqual(PRODUCT_HERO.budget.maxCredits);
      expect(productHeroProviderUsd(ms)).toBeLessThanOrEqual(PRODUCT_HERO.budget.maxProviderUsd + 1e-9);
    }
  });
});
