// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Video clip prices — the ONE table api-v2 quotes from and the worker charges
 * and caps from. Credits are duration-based and model-independent (the 5/10/15 s
 * tiers of ARCHITECTURE.md "Credits & spend safety"), so every clip of a given
 * length costs the same whichever skill or Preset renders it.
 */

/** The clip lengths a video model renders. */
export type VideoClipSeconds = 5 | 10 | 15;

/**
 * Credits charged per clip. Set for >=50% margin vs the upstream Seedance 720p
 * provider: 10 s costs us $1.99; at 68 credits/$ revenue, 280 cr = $4.12.
 */
export const VIDEO_CLIP_CREDITS: Readonly<Record<VideoClipSeconds, number>> = {
  5: 140,
  10: 280,
  15: 420,
};

/**
 * Our provider-cost ESTIMATE per clip (USD), used for the worker's spend caps
 * and recorded as each clip's estimated/actual cost.
 */
export const VIDEO_CLIP_USD: Readonly<Record<VideoClipSeconds, number>> = {
  5: 0.6,
  10: 1.2,
  15: 1.8,
};
