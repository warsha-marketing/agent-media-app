// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * A Playbook (CONTEXT.md, #27, #32): shared, tested shot and interaction rules
 * for one product category, used by every product in it. Pure DATA: the
 * pipeline reads a Playbook and never branches on its id, so adding one is a
 * data file and a registry entry (./registry.ts), never a pipeline change.
 *
 * A Playbook holds:
 *   - allowed_interactions — how products of the category are used on camera:
 *     simple, continuous, the product already in its used state (the Product
 *     Interaction writer is told these);
 *   - banned_motions — motions refused wherever they are written: the Product
 *     Interaction (the writer's gets one rewrite, a user's edit is refused)
 *     and every shot edit (422 PRODUCT_INTERACTION_BANNED_MOTION /
 *     SHOT_EDIT_BANNED_MOTION), in English and Arabic;
 *   - negatives — extra locked lines on the video stage of its shots;
 *   - defaults — the energy (and performance) of its hands and person shots;
 *   - patterns — per Preset, the shot pattern (roles, in order) and each
 *     role's default fields; the first pattern whose `when` matches the
 *     Product Profile applies.
 *
 * The owner's rule for every Playbook (test M3, #32): ONE main hand-and-product
 * action per shot. The camera and the body move freely; a second action is a
 * second shot, cut on action.
 */

import type { PhysicsRisk, PresetShotSlot } from '@agentmedia/schema';
import type { ShotEnergy, ShotTextField } from '../shot-fields.js';

/**
 * One banned motion: patterns (RegExp sources, no flags; matched on text
 * folded like the guardrail check: lower case, no diacritics, Arabic letter
 * variants unified) in English and Arabic, and why it is banned. A match right
 * after a negation ("never brings the bottle to her face", "لا تقرب الزجاجة")
 * is a rule being stated, not broken, and does not count.
 */
export interface BannedMotion {
  /** Stable id, reported as `rule` (e.g. 'bottle_to_face'). */
  id: string;
  /** Why, as the refusal says it ("the bottle never comes to the face: the wrist is smelled, after the bottle is set down"). */
  why: string;
  en: readonly string[];
  ar: readonly string[];
}

/** A shot role's default fields in a pattern: over the Preset kind's (and the Playbook's) defaults. */
export type PlaybookRoleFields = Partial<Record<ShotTextField, string>> & { energy?: ShotEnergy };

/**
 * A Playbook's shot pattern for one Preset. `order` and `last` replace the
 * Preset's (its speech band, intercut rule and budget stay, and every slot is
 * one of the Preset's own kinds, so the price is planned the same way:
 * planPresetShots). Absent: the Preset's order. `roles` sets each role's
 * default fields; a role's `action` replaces the Product Interaction on that
 * shot (one main action per shot: a split Product Interaction's own part).
 */
export interface PlaybookPresetPattern {
  order?: readonly [PresetShotSlot, ...PresetShotSlot[]];
  last?: PresetShotSlot;
  roles?: Readonly<Record<string, PlaybookRoleFields>>;
}

/** When a pattern applies, from the Product Profile. Absent: always. Every given list must hit. */
export interface PlaybookPatternWhen {
  /** Any of these interaction verbs (lower case). */
  verbs_any?: readonly string[];
  /** Any of these physics risks. */
  risks_any?: readonly PhysicsRisk[];
}

export interface PlaybookPattern {
  /** Stable id, recorded with the Playbook on the run (e.g. 'spray-then-smell'). */
  id: string;
  when?: PlaybookPatternWhen;
  /** By Preset id; a Preset not listed keeps its own shots. */
  presets: Readonly<Record<string, PlaybookPresetPattern>>;
}

export interface Playbook {
  /** Stable id (e.g. 'fragrance_oud'): recorded on the Shot Plan and the render. */
  id: string;
  /** Bumped on every change to the data, so a run records exactly which rules it rendered with. */
  version: number;
  /** Display name ('Fragrance & oud'). */
  name: string;
  /** How products of the category are used on camera (the writer is told). */
  allowed_interactions: readonly string[];
  banned_motions: readonly BannedMotion[];
  /** Extra locked lines on the video stage: `people` on hands and person shots, `product` on product shots. */
  negatives: { people: readonly string[]; product?: readonly string[] };
  /** The defaults of its hands and person shots, over the Preset's. */
  defaults: { energy: ShotEnergy; performance?: string };
  /** The first whose `when` matches the Profile applies; none matching = the Preset's shots. */
  patterns: readonly PlaybookPattern[];
}

/** A Playbook resolved for one render: the Playbook and the pattern the Profile picked (null: none). */
export interface ResolvedPlaybook {
  playbook: Playbook;
  pattern: PlaybookPattern | null;
}

/** What a Shot Plan, a run input and a render's final_output record of the Playbook. */
export interface PlaybookChoice {
  id: string;
  version: number;
  pattern: string | null;
}
