// Copyright 2026 agent-media contributors. Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  inUseReferenceNeeded,
  parseDraftInUseReference,
  presetTakesInUseReference,
  removableParts,
  renderUsesInUseReference,
  type DraftInUseReference,
} from '../in-use-reference.js';
import { presetProviderUsd, quotePresetCredits } from '../preset-definition.js';
import { HANDS_ON } from '../presets/hands-on.js';
import { REACTION } from '../presets/reaction.js';
import { PRODUCT_HERO } from '../product-hero.js';

const MADE: DraftInUseReference = {
  status: 'made',
  key: 'vnext/in-use/user-1/draft-1.png',
  url: 'https://media.example/vnext/in-use/user-1/draft-1.png',
  source_photo_key: 'vnext/uploads/user-1/photo.png',
  used_state: 'uncapped, spray neck visible',
  removed_parts: ['cap'],
  model: 'gpt-image-2',
  made_at: '2026-09-24T10:00:00.000Z',
};
const FAILED: DraftInUseReference = {
  status: 'failed',
  source_photo_key: 'vnext/uploads/user-1/photo.png',
  reason: 'openai 400: image refused',
  failed_at: '2026-09-24T10:00:00.000Z',
};

describe('inUseReferenceNeeded (#31): made at drafting time', () => {
  it('only when the Product Profile says the used state differs from the photo', () => {
    expect(inUseReferenceNeeded({ differs_from_photo: true })).toBe(true);
    expect(inUseReferenceNeeded({ differs_from_photo: false })).toBe(false);
    expect(inUseReferenceNeeded(null)).toBe(false);
    expect(inUseReferenceNeeded(undefined)).toBe(false);
  });
});

describe('renderUsesInUseReference: the render reuses the draft’s', () => {
  it('on a Preset with hands or a person, when the draft has one made, unless the user chose the original photo', () => {
    expect(renderUsesInUseReference(HANDS_ON, MADE, false)).toBe(true);
    expect(renderUsesInUseReference(REACTION, MADE, undefined)).toBe(true);
    expect(renderUsesInUseReference(HANDS_ON, MADE, true)).toBe(false);
    // Product Hero shows nobody: no shot would use it.
    expect(renderUsesInUseReference(PRODUCT_HERO, MADE, false)).toBe(false);
    // The edit failed at drafting, or there never was one: the original photo.
    expect(renderUsesInUseReference(HANDS_ON, FAILED, false)).toBe(false);
    expect(renderUsesInUseReference(HANDS_ON, null, false)).toBe(false);
  });

  it('knows which Presets can take one', () => {
    expect(presetTakesInUseReference(HANDS_ON)).toBe(true);
    expect(presetTakesInUseReference(REACTION)).toBe(true);
    expect(presetTakesInUseReference(PRODUCT_HERO)).toBe(false);
  });
});

describe('the stored In-use Reference (short_drafts.in_use_reference)', () => {
  it('reads a made or failed one, and nothing else', () => {
    expect(parseDraftInUseReference(MADE)).toEqual(MADE);
    expect(parseDraftInUseReference(FAILED)).toEqual(FAILED);
    expect(parseDraftInUseReference(null)).toBeNull();
    expect(parseDraftInUseReference({ status: 'made' })).toBeNull();
    expect(parseDraftInUseReference({ ...MADE, url: 'javascript:alert(1)' })).toBeNull();
    expect(parseDraftInUseReference('made')).toBeNull();
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

describe('the render never charges for it (drafting made it, free)', () => {
  it('the quote is the planned shots alone, with or without an In-use Reference', () => {
    // quotePresetCredits takes no In-use option: there is no step to price.
    expect(quotePresetCredits.length).toBe(2);
    expect(presetProviderUsd.length).toBe(2);
  });

  it('every budget is exactly its longest plan again (no In-use headroom)', () => {
    expect(HANDS_ON.budget).toEqual({ maxCredits: 455, maxProviderUsd: 2.05 });
    expect(REACTION.budget).toEqual({ maxCredits: 560, maxProviderUsd: 6.72 });
    expect(HANDS_ON.budget.maxCredits).toBe(quotePresetCredits(HANDS_ON, HANDS_ON.maxSpeechMs));
    expect(REACTION.budget.maxCredits).toBe(quotePresetCredits(REACTION, REACTION.maxSpeechMs));
  });
});
