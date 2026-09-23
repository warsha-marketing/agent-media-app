// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Starting frames (#18) are charged by their KIND, from the same table api-v2
// quotes from (STARTING_FRAME_CREDITS). A second frame kind with its own price
// must be charged that price, never product_in_hands' — and a frame with no
// kind, or one the table does not know, has no price at all.

import { describe, it, expect } from 'vitest';
import { STARTING_FRAMES, STARTING_FRAME_CREDITS, type StartingFrame } from '@agentmedia/schema';
import { quotePrimitiveCredits } from '../client/credits.js';

describe('starting-frame charges', () => {
  it('charges every frame kind exactly its quoted price', () => {
    for (const frame of STARTING_FRAMES) {
      expect(quotePrimitiveCredits('preset_frame', undefined, frame)).toBe(STARTING_FRAME_CREDITS[frame]);
    }
  });

  it('has no price for a frame without a kind, or a kind the price table does not know', () => {
    expect(() => quotePrimitiveCredits('preset_frame')).toThrow(expect.objectContaining({ type: 'INVALID_INPUT' }));
    expect(() => quotePrimitiveCredits('preset_frame', undefined, 'pack_shot' as StartingFrame)).toThrow(
      expect.objectContaining({ type: 'INVALID_INPUT' }),
    );
  });
});
