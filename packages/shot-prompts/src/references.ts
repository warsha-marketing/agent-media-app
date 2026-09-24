// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Reference images in a Shot Prompt (#26), provider-neutral.
 *
 * A shot is animated from its start image (its starting frame if its kind has
 * one, else the product photo) and, on a shot that shows a person, that
 * person's reference. The Guardrail lines that pin the product and the person
 * to those images name them with a token; each video provider's adapter
 * (primitive-worker-vnext src/video-models) swaps the tokens for its own
 * syntax — EvoLink `@image1` / `@image2`, fal "the first / second reference
 * image" — and api-v2 for plain words when it shows the Shot Plan. Scene text
 * never carries a token or any reference syntax: it says "the product" and
 * "the person" (sceneTextProblem refuses anything else).
 */

/** The tokens a Guardrail line names the reference images with. */
export const REFERENCE_TOKENS = {
  /** The image the shot is animated from: its starting frame, else the product photo. */
  start: '{{start_image}}',
  /** The person's reference, on a shot that shows one. */
  person: '{{person_image}}',
} as const;

/** How one provider (or the Shot Plan view) names the reference images. */
export interface ReferenceWords {
  start: string;
  person: string;
}

/** `prompt` with every reference token replaced by `words`. */
export function withReferences(prompt: string, words: ReferenceWords): string {
  return prompt.split(REFERENCE_TOKENS.start).join(words.start).split(REFERENCE_TOKENS.person).join(words.person);
}

/** Whether `prompt` still carries a reference token (a provider adapter must leave none). */
export function hasReferenceTokens(prompt: string): boolean {
  return prompt.includes(REFERENCE_TOKENS.start) || prompt.includes(REFERENCE_TOKENS.person);
}

/**
 * The image stage's words (#28): a starting frame is an image edit of the
 * product photo, its one reference image.
 */
export const IMAGE_REFERENCES: ReferenceWords = { start: 'the reference image', person: 'the second reference image' };

/** The reference images in plain words, as the Shot Plan shows them to the user. */
export function displayReferences(startingFrame: boolean): ReferenceWords {
  return { start: startingFrame ? 'the starting image' : 'the product photo', person: 'the character’s photo' };
}
