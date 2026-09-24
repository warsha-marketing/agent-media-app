// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Guardrails (CONTEXT.md, #26) — the locked lines of a Shot Prompt.
 *
 * A Shot Prompt is the shot's scene text (editable, ./scenes.ts) plus these
 * lines, which the user sees but can never edit or remove: the fixed product
 * and character references, the no-speaking instruction (ADR 0001: the draft's
 * voice is the only speech), the Modesty Default (#17), no people on a product
 * shot, no text or captions, and the video model's own audio off. The worker
 * builds every final prompt from ITS OWN copy of these lines, whatever a client
 * sent (primitive-worker-vnext workflows/render-preset.ts); api-v2 shows the
 * same lines in the Shot Plan.
 *
 * Where a line goes:
 *   before_scene — the references, so "the product" and "the person" in the
 *                  scene are pinned to the images before the scene is read;
 *   after_scene  — the rules, last, so they are the prompt's final word;
 *   request      — enforced by the request itself (generate_audio: false),
 *                  shown to the user but not prompt text.
 *
 * Pure data + pure functions: the workflow sandbox imports this.
 */

import type { Modesty, ShotSubject } from '@agentmedia/schema';
import { MODESTY_PROMPTS } from './modesty.js';
import { REFERENCE_TOKENS } from './references.js';

export type GuardrailId =
  | 'person_reference'
  | 'product_reference'
  | 'start_frame'
  | 'no_speaking'
  | 'hands_only'
  | 'modesty'
  | 'hijab'
  | 'no_people'
  | 'format'
  | 'audio_off';

export interface Guardrail {
  id: GuardrailId;
  /** A short name for the locked chip. */
  label: string;
  /** The line, with reference tokens (./references.ts) where it names an image. */
  text: string;
  at: 'before_scene' | 'after_scene' | 'request';
}

/** The no-speaking instruction every shot showing a person carries, verbatim (Reaction #19). */
export const NO_SPEAKING_PERSON =
  'The person never speaks: the mouth stays closed the whole shot, lips gently together, no talking, no mouthing words, no lip movement, no singing, no whispering. They react only with their eyes, eyebrows, a closed-mouth smile and small head movements.';

/** Every hands shot: nothing but hands, and nobody speaks. */
export const HANDS_ONLY = 'Only the hands and forearms are visible: no face, nobody speaks.';

/** Every product shot: the product alone. */
export const NO_PEOPLE = 'No people, no hands.';

/** Every shot: Captions are added after the render, never by the video model (#22). */
export const FORMAT = 'No text overlays, no captions. Vertical 9:16.';

/** Every shot: enforced by the request (generate_audio: false), shown as a Guardrail. */
export const AUDIO_OFF = 'The video model’s own audio is off: the draft’s voice is the only sound.';

export const PRODUCT_REFERENCE = `The product is exactly the product in ${REFERENCE_TOKENS.start}: it keeps its exact shape, colours, logo and label text.`;
export const START_FRAME_REFERENCE = `The video starts exactly from the frame in ${REFERENCE_TOKENS.start}, and the product keeps its exact shape, colours, logo and label text.`;
export const PERSON_REFERENCE = `The person is exactly the person in ${REFERENCE_TOKENS.person}: identical face, hair, skin and features.`;

export interface ShotGuardrailContext {
  /** What the shot shows besides the product (PresetDefinition.shotKinds[kind].shows). */
  shows: ShotSubject;
  /** The shot is animated from a generated starting frame (#18), not the product photo. */
  startingFrame: boolean;
  /** The person's reference image goes with the shot (a person shot with a character, #19). */
  personReference: boolean;
  /** The resolved Modesty Default (#17). */
  modesty: Modesty;
}

/** The Guardrails of one shot, in prompt order. */
export function shotGuardrails(ctx: ShotGuardrailContext): Guardrail[] {
  const out: Guardrail[] = [];
  const person = ctx.shows === 'person';
  const hands = ctx.shows === 'hands';
  if (person && ctx.personReference) {
    out.push({ id: 'person_reference', label: 'Same character', text: PERSON_REFERENCE, at: 'before_scene' });
  }
  out.push(
    ctx.startingFrame
      ? { id: 'start_frame', label: 'Starts from the frame, exact product', text: START_FRAME_REFERENCE, at: 'before_scene' }
      : { id: 'product_reference', label: 'Exact product', text: PRODUCT_REFERENCE, at: 'before_scene' },
  );
  if (person) out.push({ id: 'no_speaking', label: 'Nobody speaks', text: NO_SPEAKING_PERSON, at: 'after_scene' });
  if (hands) out.push({ id: 'hands_only', label: 'Hands only, nobody speaks', text: HANDS_ONLY, at: 'after_scene' });
  if (person || hands) {
    out.push({
      id: 'modesty',
      label: 'Modest styling',
      text: hands ? MODESTY_PROMPTS.hands[ctx.modesty.arms] : MODESTY_PROMPTS.person[ctx.modesty.arms],
      at: 'after_scene',
    });
  }
  if (person && ctx.modesty.hijab) out.push({ id: 'hijab', label: 'Hijab', text: MODESTY_PROMPTS.hijab, at: 'after_scene' });
  if (!person && !hands) out.push({ id: 'no_people', label: 'No people', text: NO_PEOPLE, at: 'after_scene' });
  out.push({ id: 'format', label: 'No text or captions, 9:16', text: FORMAT, at: 'after_scene' });
  out.push({ id: 'audio_off', label: 'Model audio off', text: AUDIO_OFF, at: 'request' });
  return out;
}
