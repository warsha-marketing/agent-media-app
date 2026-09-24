// Copyright 2026 agent-media contributors. Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  IN_USE_REFERENCE_CREDITS,
  IN_USE_REFERENCE_USD,
  inUseReferenceNeeded,
  presetTakesInUseReference,
  removableParts,
} from '../in-use-reference.js';
import { presetProviderUsd, quotePresetCredits } from '../preset-definition.js';
import { HANDS_ON } from '../presets/hands-on.js';
import { REACTION } from '../presets/reaction.js';
import { PRODUCT_HERO } from '../product-hero.js';
import { PRESETS } from '../preset-registry.js';

const differs = { differs_from_photo: true };
const same = { differs_from_photo: false };

describe('inUseReferenceNeeded (#31)', () => {
  it('is made only when the used state differs from the photo, on a Preset with hands or a person', () => {
    expect(inUseReferenceNeeded(HANDS_ON, differs, false)).toBe(true);
    expect(inUseReferenceNeeded(REACTION, differs, undefined)).toBe(true);
    expect(inUseReferenceNeeded(HANDS_ON, same, false)).toBe(false);
    // Product Hero shows nobody: no shot would use it.
    expect(inUseReferenceNeeded(PRODUCT_HERO, differs, false)).toBe(false);
  });

  it('is never made without a Profile (drafts from before #30)', () => {
    expect(inUseReferenceNeeded(HANDS_ON, null, false)).toBe(false);
    expect(inUseReferenceNeeded(HANDS_ON, undefined, false)).toBe(false);
  });

  it('respects "use original instead"', () => {
    expect(inUseReferenceNeeded(HANDS_ON, differs, true)).toBe(false);
    expect(inUseReferenceNeeded(REACTION, differs, true)).toBe(false);
  });

  it('knows which Presets can take one', () => {
    expect(presetTakesInUseReference(HANDS_ON)).toBe(true);
    expect(presetTakesInUseReference(REACTION)).toBe(true);
    expect(presetTakesInUseReference(PRODUCT_HERO)).toBe(false);
  });
});

describe('removableParts', () => {
  it('names only the removable parts, once each', () => {
    expect(
      removableParts({
        parts: [
          { name: 'cap', removable: true },
          { name: 'bottle', removable: false },
          { name: 'Cap', removable: true },
          { name: 'seal', removable: true },
        ],
      }),
    ).toEqual(['cap', 'seal']);
    expect(removableParts(null)).toEqual([]);
  });
});

describe('the quote prices the In-use Reference with the render (quote == charge)', () => {
  it('adds one image step when made, and nothing otherwise', () => {
    for (const preset of [HANDS_ON, REACTION]) {
      for (const ms of [5_000, 9_000, 12_000, 15_000]) {
        expect(quotePresetCredits(preset, ms, { inUseReference: true })).toBe(quotePresetCredits(preset, ms) + IN_USE_REFERENCE_CREDITS);
        expect(presetProviderUsd(preset, ms, { inUseReference: true })).toBeCloseTo(presetProviderUsd(preset, ms) + IN_USE_REFERENCE_USD, 9);
        expect(quotePresetCredits(preset, ms, { inUseReference: false })).toBe(quotePresetCredits(preset, ms));
      }
    }
  });

  it('never prices one on a Preset that shows nobody', () => {
    expect(quotePresetCredits(PRODUCT_HERO, 12_000, { inUseReference: true })).toBe(quotePresetCredits(PRODUCT_HERO, 12_000));
  });

  it('keeps every Preset within its budget with the In-use Reference', () => {
    for (const preset of Object.values(PRESETS)) {
      for (let ms = preset.minSpeechMs; ms <= preset.maxSpeechMs; ms += 250) {
        expect(quotePresetCredits(preset, ms, { inUseReference: true })).toBeLessThanOrEqual(preset.budget.maxCredits);
        expect(presetProviderUsd(preset, ms, { inUseReference: true })).toBeLessThanOrEqual(preset.budget.maxProviderUsd + 1e-9);
      }
    }
  });
});
