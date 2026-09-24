// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Reaction Preset (#19, spec #15) — one Preset definition on the shared
 * pipeline (ADR 0001; see ../preset-definition.ts).
 *
 * A Voice-over Short, never a Talking-head Short: the user's saved character
 * reacts SILENTLY to the product (a smile, a nod, surprise, enjoying the scent)
 * while the approved draft's voice carries every word. Reaction shots are
 * intercut with product shots so no face stays on screen long, and the last
 * shot is always the product. The prompts (closed mouth, no speaking, a
 * reaction only) are server-side, in the worker's render definition.
 */

import type { PresetDefinition } from '../preset-definition.js';
import { musicBedSet } from '../music-bed/index.js';
import { STANDARD_MODESTY } from '../modesty.js';

/** Reaction's shots: the character reacting to the product, and the product alone. */
export type ReactionShotKind = 'reaction' | 'product';

/**
 * The longest a reaction shot (any shot) stays on screen: 5 s.
 *
 * Why 5 s: it is the shortest clip the video model renders at our price tiers,
 * so a face is never cut from a longer take — the longer a take runs, the more
 * room the model has to drift into moving the lips, which reads as a bad dub
 * under an Arabic voice-over. Sharing the speech evenly over reaction–product
 * pairs, a face then holds 2.5–5 s (5–10 s of speech: one pair) or 2.5–3.75 s
 * (10–15 s: two pairs) — the pace of a UGC reaction cut.
 */
export const REACTION_MAX_SHOT_MS = 5_000;

export const REACTION = {
  id: 'reaction',
  name: 'Reaction',
  aspectRatio: '9:16',
  /** Same speech band as Product Hero: a draft of either renders as either. */
  minSpeechMs: 5_000,
  maxSpeechMs: 15_000,
  /**
   * Person shots render on Kling O3 Pro, falling back to Veo 3.1 when Kling
   * refuses or fails (#25: Seedance on EvoLink blocks hijab-wearing women);
   * product shots stay on Seedance. Priced per ../video-models.ts.
   */
  shotKinds: {
    reaction: { shows: 'person', video: { model: 'kling-o3-pro', fallback: 'veo-3.1' } },
    product: { shows: 'product' },
  },
  /** Reaction, product, … always ending on the product; no shot over 5 s. */
  shotPlan: { order: ['reaction', 'product'], last: 'product', maxShotMs: REACTION_MAX_SHOT_MS },
  /** The product photo, and the saved character who reacts to it. */
  requiredInputs: ['product_image', 'character'],
  /** Licensed Music Bed tracks (#9) for Reaction; empty until one is licensed. */
  musicBed: musicBedSet('reaction'),
  /** Arms covered by default (sleeved at the least); a woman's hijab on by default for Gulf. */
  modesty: STANDARD_MODESTY,
  budget: {
    /** The most one render may charge: four 5 s clips (two pairs) for 10–15 s of speech. */
    maxCredits: 560,
    /**
     * The most one render may cost us at the provider (the same four clips),
     * worst case: each of the two person shots fails on Kling O3 Pro after
     * costing us ($0.56) and then renders on the Veo 3.1 fallback ($1.60), plus
     * two product clips ($0.60).
     */
    maxProviderUsd: 5.52,
  },
} as const satisfies PresetDefinition<ReactionShotKind>;
