// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Preset definitions — a Preset is DATA on one shared render pipeline (#16).
 *
 * Every Preset renders the same way (ADR 0001): fetch the approved draft's
 * audio, plan shots to fill its measured length, make silent clips, cut them to
 * the audio, mix. What differs between Presets is declared here: the kinds of
 * shots and their order, the inputs it needs, its speech band and its cost
 * budget. The pipeline (api-v2 quote/run, the worker's render workflow) reads a
 * definition and never branches on a Preset's name.
 *
 * This is the PUBLIC half of a definition (this package is published): the
 * shot prompts per kind are the quality authority and stay server-side, in the
 * worker's render definition (services/primitive-worker-vnext/src/presets),
 * which extends this type with them.
 *
 * ⚠ INVARIANT: api-v2 quotes from planPresetShots and the worker renders from
 * it, so the quote the user confirms is exactly the charge. Do not plan shots
 * anywhere else.
 */

import { VIDEO_CLIP_CREDITS, VIDEO_CLIP_USD } from './video-pricing.js';

/** Clip lengths a Preset renders from. 15 s clips are never needed: two clips
 *  (10 + 5) already cover the longest allowed speech. */
export type PresetClipSeconds = 5 | 10;

/**
 * An input a Preset needs beyond the approved draft. The render refuses to
 * start without every input its Preset requires. (Later Presets add their own,
 * e.g. hand gender and setting for Hands-on, a character for Reaction.)
 */
export type PresetInput = 'product_image';

/**
 * The shot plan's order rule, as data: shot i takes `order[i]`, cycling when a
 * plan has more clips than `order` names; if `last` is set, the final shot is
 * always that kind (e.g. "end on the product").
 */
export interface PresetShotOrder<Kind extends string = string> {
  order: readonly [Kind, ...Kind[]];
  last?: Kind;
}

export interface PresetDefinition<Kind extends string = string> {
  /** Stable id, e.g. 'product_hero'. Recorded on the Short; never branched on. */
  id: string;
  /** Display name, e.g. 'Product Hero'. */
  name: string;
  aspectRatio: '9:16';
  /** The duration contract: the draft's speech must fall in this band. */
  minSpeechMs: number;
  maxSpeechMs: number;
  /** Which kinds of shots, in what order. Clip lengths follow the shared rule. */
  shotPlan: PresetShotOrder<Kind>;
  /** Inputs the render needs beyond the draft. */
  requiredInputs: readonly PresetInput[];
  /**
   * The Preset's own cost budget: the most one render may charge, and cost us at
   * the provider. It replaces the per-primitive cap for this Preset's clips; the
   * plan is held to it by tests (every duration in the band plans within it),
   * not by a runtime check.
   */
  budget: {
    maxCredits: number;
    maxProviderUsd: number;
  };
  // Extension points (later tickets, deliberately not declared yet): the Music
  // Bed (#9) — a licensed track set per Preset, applied at the mix step — and
  // any Preset-specific steps before the clips (e.g. product-in-hands frames)
  // join here as further fields, priced by quotePresetCredits.
}

/** One planned clip: what kind of shot it is, and how long it renders. */
export interface PlannedShot<Kind extends string = string> {
  kind: Kind;
  seconds: PresetClipSeconds;
}

/**
 * The shared clip rule: the fewest 5/10 s clips whose total covers `durationMs`,
 * the long one first, then a short closer. Waste is always under 5 s, and the
 * final cut trims the visuals — never the audio.
 *
 *   5.000 s → [5]     5.001–10 s → [10]     10.001–15 s → [10, 5]
 */
function clipLengths(durationMs: number): PresetClipSeconds[] {
  const clips: PresetClipSeconds[] = [];
  let remaining = durationMs;
  while (remaining > 0) {
    const clip: PresetClipSeconds = remaining > 5_000 ? 10 : 5;
    clips.push(clip);
    remaining -= clip * 1000;
  }
  return clips;
}

/**
 * Plan the shots for `durationMs` of speech under `preset`: the shared clip
 * lengths, each given a kind by the Preset's order rule.
 *
 * Throws RangeError outside the Preset's speech band: such a draft is refused
 * before anything is priced or rendered.
 */
export function planPresetShots<Kind extends string>(
  preset: PresetDefinition<Kind>,
  durationMs: number,
): PlannedShot<Kind>[] {
  if (!Number.isFinite(durationMs) || durationMs < preset.minSpeechMs || durationMs > preset.maxSpeechMs) {
    throw new RangeError(
      `${preset.name} speech must be ${preset.minSpeechMs}–${preset.maxSpeechMs} ms; got ${durationMs}`,
    );
  }
  const { order, last } = preset.shotPlan;
  const lengths = clipLengths(durationMs);
  return lengths.map((seconds, i) => ({
    kind: last !== undefined && i === lengths.length - 1 ? last : order[i % order.length],
    seconds,
  }));
}

/** Credits for rendering `durationMs` of speech under `preset`: the sum of its planned clips. */
export function quotePresetCredits(preset: PresetDefinition, durationMs: number): number {
  return planPresetShots(preset, durationMs).reduce((sum, s) => sum + VIDEO_CLIP_CREDITS[s.seconds], 0);
}

/** Provider USD for rendering `durationMs` of speech under `preset`: the sum of its planned clips. */
export function presetProviderUsd(preset: PresetDefinition, durationMs: number): number {
  return planPresetShots(preset, durationMs).reduce((sum, s) => sum + VIDEO_CLIP_USD[s.seconds], 0);
}
