// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Product Hero Preset — one Preset definition on the shared pipeline (ADR 0001,
 * #16; see ./preset-definition.ts).
 *
 * A Product Hero Short is audio-first: the approved draft's speech is measured
 * (5–15 s), then silent 5/10 s product clips are generated to cover it and cut
 * down to the audio. Its shot prompts live with the worker's render definition
 * (server-side), keyed by the shot kinds declared here.
 */

import { planPresetShots, presetProviderUsd, quotePresetCredits, type PresetDefinition } from './preset-definition.js';
import { musicBedSet } from './music-bed/index.js';
import { STANDARD_MODESTY } from './modesty.js';

/** Clip lengths Product Hero renders from (the shared Preset clip rule). */
export type ProductHeroClipSeconds = 5 | 10;

/** Product Hero's shots: a hero shot, then a detail closer. */
export type ProductHeroShotKind = 'hero' | 'detail';

/**
 * The Preset's definition: its fixed format, its shot plan and its own cost
 * budget. The budget replaces the per-primitive cap for this Preset's clips — a
 * 10 s clip costs more than that cap, but the render as a whole stays within this.
 *
 * Clips are priced from the shared clip table (./video-pricing.ts), never a
 * Preset-local copy. The budget is a declaration the plan is held to by tests
 * (every duration in the band plans within it), not a runtime check: with this
 * plan and these prices no render can exceed it, so a change that would is
 * caught in CI instead of refusing users at run time.
 */
export const PRODUCT_HERO = {
  id: 'product_hero',
  name: 'Product Hero',
  aspectRatio: '9:16',
  /** The duration contract: a Product Hero Short speaks for 5–15 s. */
  minSpeechMs: 5_000,
  maxSpeechMs: 15_000,
  /** Product only: nobody on screen, so the Modesty Default never reaches a prompt. */
  shotKinds: { hero: { shows: 'product' }, detail: { shows: 'product' } },
  /** Shot 1 is the hero; a second shot is a detail closer, so the cut reads as an edit. */
  shotPlan: { order: ['hero', 'detail'] },
  requiredInputs: ['product_image'],
  /** Licensed Music Bed tracks (#9) — data in ./music-bed/; empty until one is licensed. */
  musicBed: musicBedSet('product_hero'),
  /** Declared like every Preset's; a no-op here (no people or hands shots). */
  modesty: STANDARD_MODESTY,
  budget: {
    /** The most one render may charge: two clips (10 + 5) for 15 s of speech. */
    maxCredits: 420,
    /** The most one render may cost us at the provider (same two clips). */
    maxProviderUsd: 1.8,
  },
} as const satisfies PresetDefinition<ProductHeroShotKind>;

/**
 * Plan the clips for `durationMs` of speech: the fewest 5/10 s clips whose total
 * covers it, the long one first (the hero shot), then a short closer.
 *
 *   5.000 s → [5]     5.001–10 s → [10]     10.001–15 s → [10, 5]
 *
 * Throws RangeError outside the 5–15 s contract. (Product Hero's plan through
 * the shared planPresetShots, as clip lengths.)
 */
export function planProductHeroShots(durationMs: number): ProductHeroClipSeconds[] {
  return planPresetShots(PRODUCT_HERO, durationMs).map((s) => s.seconds);
}

/** Credits for rendering `durationMs` of speech: the sum of its planned clips. */
export function quoteProductHeroCredits(durationMs: number): number {
  return quotePresetCredits(PRODUCT_HERO, durationMs);
}

/** Provider USD for rendering `durationMs` of speech: the sum of its planned clips. */
export function productHeroProviderUsd(durationMs: number): number {
  return presetProviderUsd(PRODUCT_HERO, durationMs);
}
