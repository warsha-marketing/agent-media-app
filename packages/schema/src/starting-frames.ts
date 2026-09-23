// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Starting frames (#18) — a shot whose first frame is generated before it is
 * animated, instead of animating the product photo itself. A Preset declares it
 * per shot kind (PresetDefinition.shotKinds[kind].frame); the shared pipeline
 * makes one frame per planned shot of that kind, after the draft audio and
 * before any clip, and the quote prices it from this table (the same one the
 * worker charges from), so the quote is the charge.
 *
 *   product_in_hands — the user's product photo, held or used by first-person
 *                      hands in the Preset's setting (gpt-image edit)
 */

export const STARTING_FRAMES = ['product_in_hands'] as const;
export type StartingFrame = (typeof STARTING_FRAMES)[number];

/** Credits charged per starting frame (like a standalone character sheet: 35). */
export const STARTING_FRAME_CREDITS: Readonly<Record<StartingFrame, number>> = {
  product_in_hands: 35,
};

/** Our provider-cost ESTIMATE per starting frame (USD): one gpt-image edit, 1024×1536. */
export const STARTING_FRAME_USD: Readonly<Record<StartingFrame, number>> = {
  product_in_hands: 0.25,
};
