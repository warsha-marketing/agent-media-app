// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * A shot's structured fields (#28, the Shot Plan): what the director layer
 * (#27) reads and writes per shot, instead of one block of scene text.
 *
 *   framing                 — shot size and point of view ("medium close-up", "first-person POV")
 *   scene                   — what the shot is, in a line (never empty)
 *   blocking                — where the product and the person are, where the shot ends
 *   environment_interaction — how the product or the hands meet the place (a surface, a counter)
 *   performance             — the person's body and face (turns to camera, a small laugh, raised eyebrows);
 *                             hands and person shots only
 *   action                  — how the product is used: the Product Interaction (#25); hands and person shots only
 *   energy                  — calm | natural | lively: how alive the shot feels
 *   camera_move             — handheld follow, quick push-in, whip to the product, orbit, … (CAMERA_MOVES)
 *   lens_feel               — depth of field, lens character
 *   lighting                — the light
 *
 * Plus the shot's duration and model, which are the priced plan's and never
 * edited. A shot's Set is the Short's (ShotPlan.set, the Set Library of #33):
 * shots name it by id and never carry location text of their own for it.
 *
 * The fields compose into the Shot Prompt's middle in exactly this order
 * (SHOT_FIELDS), each as a sentence, empty ones left out; the Guardrails go
 * around them (./guardrails.ts). Provider-neutral like the scene before them:
 * "the product", "the person", never an image reference.
 *
 * Pure data + pure functions: the workflow sandbox imports this.
 */

import { guardrailIssue, type InteractionGuardrail } from './guardrail-check.js';

/** How alive a shot feels. Camera and body may move a lot; hand–object physics stays simple (the simple_physics Guardrail). */
export const SHOT_ENERGIES = ['calm', 'natural', 'lively'] as const;
export type ShotEnergy = (typeof SHOT_ENERGIES)[number];

/** Each energy as the prompt says it. */
export const ENERGY_WORDS: Readonly<Record<ShotEnergy, string>> = {
  calm: 'Calm, unhurried pace.',
  natural: 'Natural, everyday pace, like a real moment caught on a phone.',
  lively: 'Lively, energetic pace: the camera and the person move with real energy, while the hands keep one simple action.',
};

/**
 * The camera moves a shot can name, in the words the prompts use. The
 * vocabulary the director (#27) picks from; camera_move stays free text, so a
 * shot may combine or reword them.
 */
export const CAMERA_MOVES = {
  static: 'Locked-off camera, no movement.',
  slow_push_in: 'Slow push-in.',
  quick_push_in: 'A quick push-in toward the product.',
  handheld_follow: 'Handheld camera following the action with natural sway.',
  whip_to_product: 'A quick whip pan that lands on the product.',
  orbit: 'The camera orbits a few degrees around the product.',
  macro_slide: 'A slow macro slide along the product.',
} as const;
export type CameraMoveId = keyof typeof CAMERA_MOVES;

/** The free-text fields, in composition order. */
export const SHOT_TEXT_FIELDS = [
  'framing',
  'scene',
  'blocking',
  'environment_interaction',
  'performance',
  'action',
  'camera_move',
  'lens_feel',
  'lighting',
] as const;
export type ShotTextField = (typeof SHOT_TEXT_FIELDS)[number];

/** Every editable field, in the fixed order they compose in. */
export const SHOT_FIELDS = [
  'framing',
  'scene',
  'blocking',
  'environment_interaction',
  'performance',
  'action',
  'energy',
  'camera_move',
  'lens_feel',
  'lighting',
] as const;
export type ShotField = (typeof SHOT_FIELDS)[number];

export type ShotFields = Record<ShotTextField, string> & { energy: ShotEnergy };

/** The fields only a shot that shows hands or a person has (a product shot keeps them empty). */
export const PEOPLE_FIELDS: readonly ShotField[] = ['performance', 'action'];

/** Each field as the Review shots panel names it. */
export const SHOT_FIELD_LABELS: Readonly<Record<ShotField, string>> = {
  framing: 'Framing',
  scene: 'Scene',
  blocking: 'Blocking',
  environment_interaction: 'Environment interaction',
  performance: 'Performance',
  action: 'Product action',
  energy: 'Energy',
  camera_move: 'Camera move',
  lens_feel: 'Lens feel',
  lighting: 'Lighting',
};

/** The longest each text field may be (every default, with the longest Product Interaction, is well under it). */
export const SHOT_FIELD_MAX_CHARS: Readonly<Record<ShotTextField, number>> = {
  framing: 300,
  scene: 1000,
  blocking: 300,
  environment_interaction: 300,
  performance: 300,
  action: 500,
  camera_move: 300,
  lens_feel: 300,
  lighting: 300,
};

export const isShotField = (v: string): v is ShotField => (SHOT_FIELDS as readonly string[]).includes(v);
export const isShotEnergy = (v: unknown): v is ShotEnergy => typeof v === 'string' && (SHOT_ENERGIES as readonly string[]).includes(v);

/** Field text as it is checked, stored and composed: whitespace collapsed, trimmed. */
export function tidyFieldText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** `text` as one sentence of the prompt: capitalised, ending in a stop; '' for none. */
export function asSentence(text: string): string {
  const t = tidyFieldText(text);
  if (!t) return '';
  const s = t[0].toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(s) ? s : `${s}.`;
}

/** The fields as the middle of a Shot Prompt: SHOT_FIELDS order, one sentence each, empty ones left out. */
export function composeFields(fields: ShotFields): string {
  return SHOT_FIELDS.map((f) => (f === 'energy' ? ENERGY_WORDS[fields.energy] : asSentence(fields[f])))
    .filter(Boolean)
    .join(' ');
}

// ── Checking an edited field ─────────────────────────────────────────────────

export type ShotEditCode = 'SHOT_EDIT_INVALID' | 'SHOT_EDIT_BREAKS_GUARDRAIL';
export type ShotEditReason =
  | 'unknown_shot'
  | 'not_object'
  | 'unknown_field'
  | 'field_not_on_shot'
  | 'not_text'
  | 'not_choice'
  | 'empty'
  | 'too_long'
  | 'brackets'
  | 'reference_syntax'
  | 'guardrail';

export interface ShotFieldProblem {
  code: ShotEditCode;
  reason: ShotEditReason;
  message: string;
  /** SHOT_EDIT_BREAKS_GUARDRAIL: which Guardrail, and the words that broke it. */
  guardrail?: InteractionGuardrail;
  matched?: string;
}

/** Bracketed tags ([softly], {hands}, <b>): a field is plain words. */
const BRACKETS = /[[\]{}<>]/;
/** Any provider's image reference syntax: the Guardrails name the images, never a field. */
const REFERENCE_SYNTAX = /@\s*image|\bimage\s*[12]\b|\breference\s+images?\b|\b(?:first|second)\s+(?:reference|image)\b/i;

/** Why `value` cannot be `field` of a shot, or null when it can. Only the scene may not be empty. */
export function shotFieldProblem(field: ShotField, value: unknown): ShotFieldProblem | null {
  const name = SHOT_FIELD_LABELS[field];
  if (field === 'energy') {
    return isShotEnergy(value)
      ? null
      : { code: 'SHOT_EDIT_INVALID', reason: 'not_choice', message: `Energy is one of ${SHOT_ENERGIES.join(', ')}.` };
  }
  if (typeof value !== 'string') return { code: 'SHOT_EDIT_INVALID', reason: 'not_text', message: `${name} must be text.` };
  const tidy = tidyFieldText(value);
  if (!tidy) {
    return field === 'scene'
      ? { code: 'SHOT_EDIT_INVALID', reason: 'empty', message: 'The scene is empty. Reset it to the Preset’s scene, or describe the shot.' }
      : null;
  }
  const max = SHOT_FIELD_MAX_CHARS[field];
  if (tidy.length > max) {
    return { code: 'SHOT_EDIT_INVALID', reason: 'too_long', message: `${name} is ${tidy.length} characters; the most is ${max}.` };
  }
  if (BRACKETS.test(tidy)) {
    return {
      code: 'SHOT_EDIT_INVALID',
      reason: 'brackets',
      message: `${name} cannot carry bracketed tags ([ ], { }, < >). Describe the shot in plain words.`,
    };
  }
  if (REFERENCE_SYNTAX.test(tidy)) {
    return {
      code: 'SHOT_EDIT_INVALID',
      reason: 'reference_syntax',
      message: `${name} cannot name reference images (@image1, "reference image", …). Say "the product" or "the person"; the render pins them to your photos itself.`,
    };
  }
  const issue = guardrailIssue(tidy);
  if (issue) {
    return {
      code: 'SHOT_EDIT_BREAKS_GUARDRAIL',
      reason: 'guardrail',
      guardrail: issue.guardrail,
      matched: issue.matched,
      message: `${name} breaks a Guardrail: "${issue.matched}" — ${issue.why}.`,
    };
  }
  return null;
}
