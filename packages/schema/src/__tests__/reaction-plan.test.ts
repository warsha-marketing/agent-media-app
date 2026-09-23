// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The Reaction shot plan (#19), pure: reaction shots of the saved character are
 * intercut with product shots, the last shot is always the product, and no shot
 * — so no face — stays on screen longer than the Preset's maximum. The plan is
 * the one the quote prices and the worker renders (planPresetShots).
 */

import { describe, it, expect } from 'vitest';
import { planPresetShots, presetProviderUsd, quotePresetCredits, type PresetDefinition } from '../preset-definition.js';
import { PRESETS } from '../preset-registry.js';
import { REACTION, REACTION_MAX_SHOT_MS } from '../presets/reaction.js';
import { VIDEO_CLIP_CREDITS } from '../video-pricing.js';
import { STANDARD_MODESTY, presetShows } from '../modesty.js';

/** 5–15 s in 250 ms steps, plus the edges either side of each clip boundary. */
const DURATIONS = [
  ...Array.from({ length: 41 }, (_, i) => 5_000 + i * 250),
  5_001, 9_999, 10_001, 14_999, 12_345, 7_777,
];

describe('Reaction as a Preset definition', () => {
  it('is the registered reaction Preset: a person reacting, and the product', () => {
    expect(PRESETS.reaction).toBe(REACTION);
    expect(REACTION.shotKinds.reaction.shows).toBe('person');
    expect(REACTION.shotKinds.product.shows).toBe('product');
    expect(presetShows(REACTION, 'person')).toBe(true);
    expect(REACTION.modesty).toBe(STANDARD_MODESTY);
    expect(REACTION.requiredInputs).toEqual(['product_image', 'character']);
  });

  it('keeps a face on screen for at most 5 s: one shortest clip', () => {
    expect(REACTION_MAX_SHOT_MS).toBe(5_000);
    expect(REACTION.shotPlan.maxShotMs).toBe(REACTION_MAX_SHOT_MS);
  });
});

describe.each(DURATIONS)('the Reaction plan for %i ms of speech', (ms) => {
  const shots = planPresetShots(REACTION, ms);

  it('opens on a reaction and alternates reaction and product shots', () => {
    shots.forEach((s, i) => expect(s.kind).toBe(i % 2 === 0 ? 'reaction' : 'product'));
    expect(shots.filter((s) => s.kind === 'reaction').length).toBeGreaterThanOrEqual(1);
  });

  it('always ends on the product', () => {
    expect(shots.at(-1)!.kind).toBe('product');
  });

  it('never keeps a shot on screen longer than the maximum, and fills the speech exactly', () => {
    for (const s of shots) {
      expect(s.onScreenMs).toBeGreaterThan(0);
      expect(s.onScreenMs!).toBeLessThanOrEqual(REACTION_MAX_SHOT_MS);
      // The clip renders at least as long as it stays on screen.
      expect(s.seconds * 1000).toBeGreaterThanOrEqual(s.onScreenMs!);
    }
    expect(shots.reduce((sum, s) => sum + s.onScreenMs!, 0)).toBe(ms);
  });

  it('renders every shot as a 5 s clip, so no face is cut from a longer take', () => {
    for (const s of shots) expect(s.seconds).toBe(5);
  });

  it('shares the speech evenly between the shots (within a millisecond)', () => {
    const lens = shots.map((s) => s.onScreenMs!);
    expect(Math.max(...lens) - Math.min(...lens)).toBeLessThanOrEqual(1);
  });

  it('is priced as the sum of its clips, within the declared budget', () => {
    expect(quotePresetCredits(REACTION, ms)).toBe(shots.length * VIDEO_CLIP_CREDITS[5]);
    expect(quotePresetCredits(REACTION, ms)).toBeLessThanOrEqual(REACTION.budget.maxCredits);
    expect(presetProviderUsd(REACTION, ms)).toBeLessThanOrEqual(REACTION.budget.maxProviderUsd + 1e-9);
  });
});

describe('the Reaction plan at a glance', () => {
  it('uses the fewest reaction–product pairs that keep every shot within the maximum', () => {
    const kinds = (ms: number) => planPresetShots(REACTION, ms).map((s) => `${s.kind}:${s.onScreenMs}`);
    expect(kinds(5_000)).toEqual(['reaction:2500', 'product:2500']);
    expect(kinds(10_000)).toEqual(['reaction:5000', 'product:5000']);
    expect(kinds(10_001)).toEqual(['reaction:2501', 'product:2500', 'reaction:2500', 'product:2500']);
    expect(kinds(15_000)).toEqual(['reaction:3750', 'product:3750', 'reaction:3750', 'product:3750']);
  });

  it('refuses speech outside 5–15 s', () => {
    expect(() => planPresetShots(REACTION, 4_999)).toThrow(RangeError);
    expect(() => planPresetShots(REACTION, 15_001)).toThrow(RangeError);
  });
});

describe('the intercut rule (maxShotMs) for any Preset', () => {
  const base: PresetDefinition<'a' | 'b'> = {
    id: 'test_max',
    name: 'Test Max',
    aspectRatio: '9:16',
    minSpeechMs: 1_000,
    maxSpeechMs: 30_000,
    shotKinds: { a: { shows: 'person' }, b: { shows: 'product' } },
    shotPlan: { order: ['a', 'b'], last: 'b', maxShotMs: 4_000 },
    requiredInputs: [],
    musicBed: [],
    modesty: STANDARD_MODESTY,
    budget: { maxCredits: 10_000, maxProviderUsd: 100 },
  };

  it('plans whole cycles of the order, each shot within the maximum', () => {
    expect(planPresetShots(base, 8_000).map((s) => s.onScreenMs)).toEqual([4_000, 4_000]);
    expect(planPresetShots(base, 8_001)).toHaveLength(4);
    expect(planPresetShots(base, 30_000)).toHaveLength(8);
  });

  it('refuses a maximum longer than the 5 s clip it is cut from', () => {
    const tooLong = { ...base, shotPlan: { ...base.shotPlan, maxShotMs: 5_001 } };
    expect(() => planPresetShots(tooLong, 8_000)).toThrow(/maxShotMs/);
  });

  it('leaves Presets without a maximum on the shared 5/10 s clip rule', () => {
    const { maxShotMs: _m, ...plain } = base.shotPlan;
    const shots = planPresetShots({ ...base, shotPlan: plain }, 8_000);
    expect(shots).toEqual([{ kind: 'b', seconds: 10 }]);
  });
});
