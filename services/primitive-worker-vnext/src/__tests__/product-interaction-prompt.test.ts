// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The Product Interaction's prompt words (#25): hands and person shots only,
// one tidy sentence, and it says it keeps the modesty and no-speaking rules.

import { describe, it, expect } from 'vitest';
import { PRODUCT_INTERACTION_MAX_CHARS } from '@agentmedia/schema';
import { productInteractionPrompt } from '../presets/index.js';

describe('productInteractionPrompt', () => {
  it('is empty for a product shot, or a draft with none', () => {
    expect(productInteractionPrompt('product', 'sprays once on the wrist')).toBe('');
    expect(productInteractionPrompt('person', null)).toBe('');
    expect(productInteractionPrompt('hands', '   ')).toBe('');
  });

  it('words the action for hands and person shots, keeping the rules above it', () => {
    for (const subject of ['hands', 'person'] as const) {
      const words = productInteractionPrompt(subject, '  removes the cap,\n sprays once on the inner wrist.  ');
      expect(words).toContain('removes the cap, sprays once on the inner wrist.');
      expect(words).toMatch(/nobody speaks or mouths words/);
      expect(words).toMatch(/as modest as described/);
    }
  });

  it('never carries more than the cap', () => {
    const long = 'a'.repeat(PRODUCT_INTERACTION_MAX_CHARS + 200);
    expect(productInteractionPrompt('person', long)).toContain('a'.repeat(PRODUCT_INTERACTION_MAX_CHARS));
    expect(productInteractionPrompt('person', long)).not.toContain('a'.repeat(PRODUCT_INTERACTION_MAX_CHARS + 1));
  });
});
