// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Product Hero Preset — the render plan and its cost budget (ADR 0001).
 *
 * A Product Hero Short is audio-first: the approved draft's speech is measured
 * (5–15 s), then silent 5/10 s product clips are generated to cover it and cut
 * down to the audio. This module is the one place that turns a measured speech
 * length into clips, and clips into credits.
 *
 * ⚠ INVARIANT: api-v2 quotes from planProductHeroShots and the worker renders
 * from it, so the quote the user confirms is exactly the charge. Do not plan
 * shots anywhere else.
 */

import { VIDEO_CLIP_CREDITS, VIDEO_CLIP_USD } from './video-pricing.js';

/** Clip lengths Product Hero renders from. 15 s clips are never needed: two
 *  clips (10 + 5) already cover the longest allowed speech. */
export type ProductHeroClipSeconds = 5 | 10;

/**
 * The Preset's declaration: its fixed format and its own cost budget. The
 * budget replaces the per-primitive cap for this Preset's clips — a 10 s clip
 * costs more than that cap, but the render as a whole stays within this.
 *
 * Clips are priced from the shared clip table (./video-pricing.ts), never a
 * Preset-local copy. The budget is a declaration the plan is held to by tests
 * (every duration in the band plans within it), not a runtime check: with this
 * plan and these prices no render can exceed it, so a change that would is
 * caught in CI instead of refusing users at run time.
 */
export const PRODUCT_HERO = {
  preset: 'product_hero',
  aspectRatio: '9:16',
  /** The duration contract: a Product Hero Short speaks for 5–15 s. */
  minSpeechMs: 5_000,
  maxSpeechMs: 15_000,
  budget: {
    /** The most one render may charge: two clips (10 + 5) for 15 s of speech. */
    maxCredits: 420,
    /** The most one render may cost us at the provider (same two clips). */
    maxProviderUsd: 1.8,
  },
} as const;

/**
 * Plan the clips for `durationMs` of speech: the fewest 5/10 s clips whose total
 * covers it, the long one first (the hero shot), then a short closer. Waste is
 * always under 5 s, and the final cut trims the visuals — never the audio.
 *
 *   5.000 s → [5]     5.001–10 s → [10]     10.001–15 s → [10, 5]
 *
 * Throws RangeError outside the 5–15 s contract: such a draft is refused before
 * anything is priced or rendered.
 */
export function planProductHeroShots(durationMs: number): ProductHeroClipSeconds[] {
  if (!Number.isFinite(durationMs) || durationMs < PRODUCT_HERO.minSpeechMs || durationMs > PRODUCT_HERO.maxSpeechMs) {
    throw new RangeError(
      `Product Hero speech must be ${PRODUCT_HERO.minSpeechMs}–${PRODUCT_HERO.maxSpeechMs} ms; got ${durationMs}`,
    );
  }
  const shots: ProductHeroClipSeconds[] = [];
  let remaining = durationMs;
  while (remaining > 0) {
    const clip: ProductHeroClipSeconds = remaining > 5_000 ? 10 : 5;
    shots.push(clip);
    remaining -= clip * 1000;
  }
  return shots;
}

/** Credits for rendering `durationMs` of speech: the sum of its planned clips. */
export function quoteProductHeroCredits(durationMs: number): number {
  return planProductHeroShots(durationMs).reduce((sum, s) => sum + VIDEO_CLIP_CREDITS[s], 0);
}

/** Provider USD for rendering `durationMs` of speech: the sum of its planned clips. */
export function productHeroProviderUsd(durationMs: number): number {
  return planProductHeroShots(durationMs).reduce((sum, s) => sum + VIDEO_CLIP_USD[s], 0);
}
