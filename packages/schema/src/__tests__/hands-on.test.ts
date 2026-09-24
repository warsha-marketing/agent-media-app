// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Hands-on (#18) as one Preset definition on the shared pipeline: first-person
 * hands shots whose starting frame is a product-in-hands image, then a product
 * closer. Its quote is its charge, including the image step.
 */

import { describe, it, expect } from 'vitest';
import {
  planPresetShots,
  presetProviderUsd,
  quotePresetCredits,
} from '../preset-definition.js';
import { PRESETS } from '../preset-registry.js';
import { STARTING_FRAME_CREDITS, STARTING_FRAME_USD } from '../starting-frames.js';
import { VIDEO_CLIP_CREDITS, VIDEO_CLIP_USD } from '../video-pricing.js';
import { PERSON_GENDERS, resolveModesty, ModestyError } from '../modesty.js';
import { HAND_GENDERS, HANDS_ON, HANDS_ON_SETTINGS } from '../presets/hands-on.js';

describe('the Hands-on definition', () => {
  it('is the registered hands_on Preset', () => {
    expect(PRESETS.hands_on).toBe(HANDS_ON);
    expect(HANDS_ON.id).toBe('hands_on');
    expect(HANDS_ON.name).toBe('Hands-on');
  });

  it('shows hands in its hands shots and only the product in its closer', () => {
    expect(HANDS_ON.shotKinds.hands.shows).toBe('hands');
    expect(HANDS_ON.shotKinds.product.shows).toBe('product');
  });

  it('makes every hands shot from a product-in-hands starting frame, and the closer from the photo', () => {
    expect(HANDS_ON.shotKinds.hands.frame).toBe('product_in_hands');
    expect('frame' in HANDS_ON.shotKinds.product).toBe(false);
  });

  it('needs the photo, the hand gender and the setting', () => {
    expect([...HANDS_ON.requiredInputs].sort()).toEqual(['hand_gender', 'product_image', 'setting']);
  });

  it('offers male or female hands only, and the short list of settings', () => {
    expect([...HAND_GENDERS]).toEqual(['female', 'male']);
    expect(HAND_GENDERS).toBe(PERSON_GENDERS); // one gender list for every Preset input
    expect([...HANDS_ON_SETTINGS]).toEqual(['dressing_table', 'car', 'majlis', 'kitchen', 'desk', 'outdoors']);
  });
});

describe('the Hands-on shot plan: hands first, always ending on the product', () => {
  it('splits speech one clip would cover (≤10 s) into two 5 s clips, hands then product, each on screen for half', () => {
    expect(planPresetShots(HANDS_ON, 5_000)).toEqual([
      { role: 'hands-use', kind: 'hands', seconds: 5, onScreenMs: 2_500 },
      { role: 'product-closer', kind: 'product', seconds: 5, onScreenMs: 2_500 },
    ]);
    expect(planPresetShots(HANDS_ON, 9_001)).toEqual([
      { role: 'hands-use', kind: 'hands', seconds: 5, onScreenMs: 4_501 },
      { role: 'product-closer', kind: 'product', seconds: 5, onScreenMs: 4_500 },
    ]);
    expect(planPresetShots(HANDS_ON, 10_000)).toEqual([
      { role: 'hands-use', kind: 'hands', seconds: 5, onScreenMs: 5_000 },
      { role: 'product-closer', kind: 'product', seconds: 5, onScreenMs: 5_000 },
    ]);
  });

  it('over 10 s keeps a 10 s hands clip and a 5 s product closer, played whole', () => {
    expect(planPresetShots(HANDS_ON, 10_001)).toEqual([
      { role: 'hands-use', kind: 'hands', seconds: 10 },
      { role: 'product-closer', kind: 'product', seconds: 5 },
    ]);
    expect(planPresetShots(HANDS_ON, 15_000)).toEqual([
      { role: 'hands-use', kind: 'hands', seconds: 10 },
      { role: 'product-closer', kind: 'product', seconds: 5 },
    ]);
  });

  it('for every speech length of 5–15 s: two shots, hands first, the product last, covering the speech', () => {
    for (let ms = HANDS_ON.minSpeechMs; ms <= HANDS_ON.maxSpeechMs; ms += 250) {
      const plan = planPresetShots(HANDS_ON, ms);
      expect(plan.map((s) => s.kind), `${ms} ms`).toEqual(['hands', 'product']);
      if (ms <= 10_000) {
        expect(plan.every((s) => s.seconds === 5 && s.onScreenMs! <= 5_000), `${ms} ms`).toBe(true);
        expect(plan.reduce((sum, s) => sum + s.onScreenMs!, 0), `${ms} ms`).toBe(ms);
      } else {
        expect(plan.reduce((sum, s) => sum + s.seconds * 1000, 0), `${ms} ms`).toBeGreaterThanOrEqual(ms);
      }
    }
  });
});

describe('the Hands-on price includes the image step', () => {
  it('charges each clip plus one starting frame per hands shot', () => {
    const frame = STARTING_FRAME_CREDITS.product_in_hands;
    // ≤10 s: two 5 s clips cost exactly the one 10 s clip they replace.
    expect(VIDEO_CLIP_CREDITS[5] * 2).toBe(VIDEO_CLIP_CREDITS[10]);
    expect(quotePresetCredits(HANDS_ON, 5_000)).toBe(2 * VIDEO_CLIP_CREDITS[5] + frame);
    expect(quotePresetCredits(HANDS_ON, 9_000)).toBe(315);
    expect(quotePresetCredits(HANDS_ON, 10_000)).toBe(315);
    expect(quotePresetCredits(HANDS_ON, 10_001)).toBe(455);
    expect(presetProviderUsd(HANDS_ON, 9_000)).toBeCloseTo(2 * VIDEO_CLIP_USD[5] + STARTING_FRAME_USD.product_in_hands, 9);
    expect(quotePresetCredits(HANDS_ON, 15_000)).toBe(VIDEO_CLIP_CREDITS[10] + VIDEO_CLIP_CREDITS[5] + frame);
    expect(presetProviderUsd(HANDS_ON, 15_000)).toBeCloseTo(
      VIDEO_CLIP_USD[10] + VIDEO_CLIP_USD[5] + STARTING_FRAME_USD.product_in_hands,
      9,
    );
  });

  it('declares a budget that covers the image step at the longest speech', () => {
    expect(HANDS_ON.budget.maxCredits).toBe(quotePresetCredits(HANDS_ON, HANDS_ON.maxSpeechMs));
    expect(HANDS_ON.budget.maxProviderUsd).toBeCloseTo(presetProviderUsd(HANDS_ON, HANDS_ON.maxSpeechMs), 9);
  });
});

describe('the Hands-on Modesty Default', () => {
  it('covers the arms by default and never offers a hijab (no person on screen)', () => {
    expect(resolveModesty(HANDS_ON, { dialect: 'gulf', gender: 'female' })).toEqual({ arms: 'covered', hijab: false });
    expect(() => resolveModesty(HANDS_ON, { dialect: 'gulf', gender: 'male', choice: { hijab: true } })).toThrow(ModestyError);
  });
});
