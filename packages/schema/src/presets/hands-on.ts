// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Hands-on Preset (#18) — one Preset definition on the shared pipeline (ADR
 * 0001, #16; see ../preset-definition.ts).
 *
 * A Voice-over Short of first-person hands unboxing, holding and using the
 * product in a setting that suits it, then a product closer. Each hands shot
 * starts from a generated product-in-hands frame (made from the user's product
 * photo; ../starting-frames.ts), animated silently. Nobody speaks on screen.
 *
 * The inputs beyond the draft are the hand gender and the setting; api-v2 picks
 * both from the draft's Product Details when the user does not. The shot and
 * frame prompts per kind (and the words for each setting and hand gender) stay
 * server-side, in the worker's render definition.
 */

import type { PresetDefinition } from '../preset-definition.js';
import { musicBedSet } from '../music-bed/index.js';
import { STANDARD_MODESTY } from '../modesty.js';

/** Whose hands are on screen. Male or female only (no gender-neutral option: CONTEXT.md, Voice). */
export const HAND_GENDERS = ['female', 'male'] as const;
export type HandGender = (typeof HAND_GENDERS)[number];

/** Where the hands use the product: a short list, each a place a MENA viewer knows. */
export const HANDS_ON_SETTINGS = ['dressing_table', 'car', 'majlis', 'kitchen', 'desk', 'outdoors'] as const;
export type HandsOnSetting = (typeof HANDS_ON_SETTINGS)[number];

/** The name each setting is shown by. */
export const HANDS_ON_SETTING_NAMES: Readonly<Record<HandsOnSetting, string>> = {
  dressing_table: 'Dressing table',
  car: 'Car',
  majlis: 'Majlis',
  kitchen: 'Kitchen',
  desk: 'Desk',
  outdoors: 'Outdoors',
};

/** Hands-on's shots: hands with the product, then the product alone. */
export type HandsOnShotKind = 'hands' | 'product';

/**
 * The Preset's definition. Every Short opens on hands and ends on a product
 * shot (`last: 'product'`, so the plan never collapses to one clip):
 *
 *   5–10 s     → hands 5 s + product 5 s, each on screen for half the speech
 *                (140 + 140 = 280 credits, the price of one 10 s clip) + 35 frame = 315
 *   10.001–15 s → hands 10 s + product 5 s, played whole, tail trimmed
 *                (280 + 140 = 420) + 35 frame = 455
 *
 * Budget: the longest plan (10 s hands + 5 s product) plus the one hands frame.
 */
export const HANDS_ON = {
  id: 'hands_on',
  name: 'Hands-on',
  aspectRatio: '9:16',
  minSpeechMs: 5_000,
  maxSpeechMs: 15_000,
  shotKinds: {
    hands: { shows: 'hands', frame: 'product_in_hands' },
    product: { shows: 'product' },
  },
  shotPlan: { order: ['hands', 'product'], last: 'product' },
  requiredInputs: ['product_image', 'hand_gender', 'setting'],
  musicBed: musicBedSet('hands_on'),
  /** Arms covered by default, sleeved at the least; no person on screen, so never a hijab. */
  modesty: STANDARD_MODESTY,
  budget: {
    /** 280 + 140 for the clips + 35 for the hands frame. */
    maxCredits: 455,
    /** 1.2 + 0.6 for the clips + 0.25 for the hands frame. */
    maxProviderUsd: 2.05,
  },
} as const satisfies PresetDefinition<HandsOnShotKind>;
