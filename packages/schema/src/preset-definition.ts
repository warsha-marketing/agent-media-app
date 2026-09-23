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
import type { MusicBedTrack } from './music-bed/types.js';
import type { ModestyDefault, ShotSubject } from './modesty.js';
import { STARTING_FRAME_CREDITS, STARTING_FRAME_USD, type StartingFrame } from './starting-frames.js';

/** Clip lengths a Preset renders from. 15 s clips are never needed: two clips
 *  (10 + 5) already cover the longest allowed speech. */
export type PresetClipSeconds = 5 | 10;

/**
 * An input a Preset needs beyond the approved draft. The render refuses to
 * start without every input its Preset requires. (Later Presets add their own,
 * e.g. hand gender and setting for Hands-on, a character for Reaction.)
 */
export type PresetInput = 'product_image' | 'character' | 'hand_gender' | 'setting';

/**
 * The shot plan's order rule, as data: shot i takes `order[i]`, cycling when a
 * plan has more clips than `order` names; if `last` is set, the final shot is
 * always that kind (e.g. "end on the product").
 */
export interface PresetShotOrder<Kind extends string = string> {
  order: readonly [Kind, ...Kind[]];
  /**
   * The kind every Short of this Preset ends on. A Preset with `last` never
   * collapses to a single clip (that one shot would have to be both `order[0]`
   * and `last`): speech one clip would cover (≤10 s) renders as two 5 s clips,
   * `order[0]` then `last`, sharing the speech evenly (closingPair) — the same
   * price as the one 10 s clip it replaces. Longer speech keeps the shared rule.
   */
  last?: Kind;
  /**
   * The longest any one shot stays on screen, in ms (at most 5 000: one 5 s
   * clip). Set, the Preset is cut on the intercut rule (intercutShots) instead
   * of the shared 5/10 s rule: every clip renders 5 s and the speech is shared
   * evenly between whole cycles of `order` — the fewest that keep each shot
   * within this. Reaction uses it so no face lingers (#19).
   */
  maxShotMs?: number;
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
  /**
   * Every kind of shot this Preset makes, and what it shows besides the product
   * (#17): the pipeline adds the Modesty Default to every `hands` and `person`
   * shot, and to no other. `frame` (#18, ./starting-frames.ts): the shot is
   * animated from a generated starting frame instead of the product photo, one
   * frame per planned shot of that kind, priced with the clips.
   */
  shotKinds: Readonly<Record<Kind, { shows: ShotSubject; frame?: StartingFrame }>>;
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
  /**
   * The Preset's Music Bed set (#9): licensed tracks only, mixed ducked under
   * the voice at the mix step. Data — the tracks and their licence records live
   * in ./music-bed/ (tracks.ts + LICENSES.md); a Preset selects its own with
   * musicBedSet(id). Empty = every Short of this Preset is voice only.
   */
  musicBed: readonly MusicBedTrack[];
  /**
   * The Modesty Default (#17, ./modesty.ts): how covered the arms are at the
   * least, and the hijab rule per Dialect. Every Preset declares one; it only
   * reaches the prompts of shots that show people or hands, so a Preset with
   * product shots only renders exactly as before.
   */
  modesty: ModestyDefault;
  // Extension points: Preset-specific steps before the clips are declared as
  // data and priced by quotePresetCredits — per shot kind, a starting frame
  // (shotKinds[kind].frame, #18).
}

/** One planned clip: what kind of shot it is, and how long it renders. */
export interface PlannedShot<Kind extends string = string> {
  kind: Kind;
  seconds: PresetClipSeconds;
  /**
   * How long this shot stays on screen in the cut (the intercut rule, and a
   * Preset's closing pair). Absent,
   * the clips play whole, back to back, and the cut trims the tail to the audio.
   */
  onScreenMs?: number;
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
  const { order, last, maxShotMs } = preset.shotPlan;
  if (maxShotMs !== undefined) return intercutShots(preset.shotPlan, durationMs);
  const lengths = clipLengths(durationMs);
  if (last !== undefined && lengths.length === 1) return closingPair(order[0], last, durationMs);
  return lengths.map((seconds, i) => ({
    kind: last !== undefined && i === lengths.length - 1 ? last : order[i % order.length],
    seconds,
  }));
}

/**
 * A Preset with a `last` kind whose speech one clip would cover (≤10 s): two
 * 5 s clips, `first` then `last`, each on screen for half the speech (the first
 * takes the odd ms). Each share is at most 5 s, so neither clip is ever held.
 */
function closingPair<Kind extends string>(first: Kind, last: Kind, durationMs: number): PlannedShot<Kind>[] {
  const half = Math.floor(durationMs / 2);
  return [
    { kind: first, seconds: 5, onScreenMs: durationMs - half },
    { kind: last, seconds: 5, onScreenMs: half },
  ];
}

/** The longest a shot may stay on screen: one 5 s clip, the shortest a video model renders. */
const MAX_SHOT_MS_LIMIT = 5_000;

/**
 * The intercut rule (PresetShotOrder.maxShotMs): the fewest whole cycles of
 * `order` whose shots, sharing the speech evenly, each stay within
 * `maxShotMs`. Every shot renders as a 5 s clip and is cut to its share; the
 * shares sum to `durationMs` exactly (the first few take the leftover ms).
 *
 *   order [reaction, product], max 5 s:  5–10 s → 2 shots   10.001–15 s → 4 shots
 */
function intercutShots<Kind extends string>(plan: PresetShotOrder<Kind>, durationMs: number): PlannedShot<Kind>[] {
  const { order, last, maxShotMs } = plan;
  if (maxShotMs === undefined || !Number.isInteger(maxShotMs) || maxShotMs <= 0 || maxShotMs > MAX_SHOT_MS_LIMIT) {
    throw new RangeError(`maxShotMs must be a whole number of ms in 1–${MAX_SHOT_MS_LIMIT}; got ${maxShotMs}`);
  }
  const cycles = Math.ceil(durationMs / (maxShotMs * order.length));
  const n = cycles * order.length;
  const base = Math.floor(durationMs / n);
  const extra = durationMs - base * n;
  return Array.from({ length: n }, (_, i) => ({
    kind: last !== undefined && i === n - 1 ? last : order[i % order.length],
    seconds: 5 as const,
    onScreenMs: base + (i < extra ? 1 : 0),
  }));
}

/** The starting frame a planned shot of `kind` is animated from, if any (#18). */
export function shotFrame(preset: Pick<PresetDefinition, 'shotKinds'>, kind: string): StartingFrame | undefined {
  return (preset.shotKinds as Record<string, { frame?: StartingFrame }>)[kind]?.frame;
}

/** Credits for rendering `durationMs` of speech under `preset`: its planned clips plus their starting frames. */
export function quotePresetCredits(preset: PresetDefinition, durationMs: number): number {
  return planPresetShots(preset, durationMs).reduce((sum, s) => {
    const frame = shotFrame(preset, s.kind);
    return sum + VIDEO_CLIP_CREDITS[s.seconds] + (frame ? STARTING_FRAME_CREDITS[frame] : 0);
  }, 0);
}

/** Provider USD for rendering `durationMs` of speech under `preset`: its planned clips plus their starting frames. */
export function presetProviderUsd(preset: PresetDefinition, durationMs: number): number {
  return planPresetShots(preset, durationMs).reduce((sum, s) => {
    const frame = shotFrame(preset, s.kind);
    return sum + VIDEO_CLIP_USD[s.seconds] + (frame ? STARTING_FRAME_USD[frame] : 0);
  }, 0);
}
