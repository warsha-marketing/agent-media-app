// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Modesty Default (CONTEXT.md, #17) — how modest the people and hands in a
 * Preset's shots are, declared as data on the Preset definition.
 *
 * Every Preset declares one. The shared render pipeline adds it to every shot
 * whose kind shows a person or hands (PresetDefinition.shotKinds) and to no
 * other shot, so a Preset with only product shots (Product Hero) is unchanged.
 * The user may pick another culturally acceptable option, never a less modest
 * one than the Preset allows: arms at least as covered as `arms.least`, and no
 * hijab turned off where the Preset requires it.
 *
 * This is the public half (levels, rules, the user-facing input). The prompt
 * wording for each level is server-side, with the worker's shot prompts.
 */

import { z } from 'zod';
import type { Dialect } from './dialects.js';
import type { PresetDefinition } from './preset-definition.js';

/** What a shot shows besides the product. Only `hands` and `person` shots carry the Modesty Default. */
export type ShotSubject = 'product' | 'hands' | 'person';

/**
 * How covered the arms are, least modest first. Bare arms are not an option in
 * any Preset, so they are not a level at all.
 *   sleeved — sleeves to at least the elbow, no bare shoulders or upper arms
 *   covered — long sleeves down to the wrists
 */
export const ARM_COVERAGE = ['sleeved', 'covered'] as const;
export type ArmCoverage = (typeof ARM_COVERAGE)[number];

/**
 * The hijab rule for women in one Dialect:
 *   off      — offered, off by default
 *   on       — offered, on by default (the user may turn it off)
 *   required — always on; turning it off is less modest than the Preset allows
 */
export type HijabRule = 'off' | 'on' | 'required';

/** A Preset's Modesty Default: the default and the least modest arms it allows, and the hijab rule per Dialect. */
export interface ModestyDefault {
  arms: { default: ArmCoverage; least: ArmCoverage };
  hijab: Readonly<Record<Dialect, HijabRule>>;
}

/**
 * The Modesty Default most Presets use: arms covered by default, sleeved at the
 * least, hijab on by default for Gulf and offered everywhere else.
 */
export const STANDARD_MODESTY = {
  arms: { default: 'covered', least: 'sleeved' },
  hijab: { gulf: 'on', levantine: 'off', egyptian: 'off', maghrebi: 'off', msa: 'off' },
} as const satisfies ModestyDefault;

/** The user's choice, as a skill input. Every field optional: omitted means the Preset's default. */
export const modestyChoiceSchema = z
  .object({
    arms: z
      .enum(ARM_COVERAGE)
      .optional()
      .describe('How covered the arms are: "covered" (long sleeves to the wrists) or "sleeved" (sleeves to at least the elbow). Defaults to the Preset’s choice.'),
    hijab: z
      .boolean()
      .optional()
      .describe('Whether a woman on screen wears a hijab. On by default for Gulf. Only for a woman in a Preset that shows a person.'),
  })
  .strict();
export type ModestyChoice = z.infer<typeof modestyChoiceSchema>;

/** The Modesty Default resolved for one render: what the people and hands prompts say. */
export interface Modesty {
  arms: ArmCoverage;
  /** True only for a woman on screen. */
  hijab: boolean;
}

export type ModestyErrorCode = 'LESS_MODEST_THAN_PRESET' | 'HIJAB_NOT_OFFERED';

/** A modesty choice the Preset does not allow. The route layer maps it to 400. */
export class ModestyError extends Error {
  readonly code: ModestyErrorCode;
  constructor(code: ModestyErrorCode, message: string) {
    super(message);
    this.name = 'ModestyError';
    this.code = code;
  }
}

/** Whether any shot kind of `preset` shows `subject`. */
export function presetShows(preset: Pick<PresetDefinition, 'shotKinds'>, subject: ShotSubject): boolean {
  return Object.values(preset.shotKinds).some((k) => k.shows === subject);
}

/** Whether `arms` is at least as modest as `least`. */
export function armsAtLeast(arms: ArmCoverage, least: ArmCoverage): boolean {
  return ARM_COVERAGE.indexOf(arms) >= ARM_COVERAGE.indexOf(least);
}

/**
 * Resolve the Modesty Default for one render: the Preset's defaults for the
 * Short's Dialect, with the user's choice applied. `gender` is the person on
 * screen (Reaction) or the hands (Hands-on); a hijab applies only to a woman in
 * a Preset that shows a person.
 *
 * Throws ModestyError for a choice less modest than the Preset allows, or a
 * hijab where none can be worn.
 */
export function resolveModesty(
  preset: Pick<PresetDefinition, 'name' | 'shotKinds' | 'modesty'>,
  ctx: { dialect: Dialect; gender?: 'female' | 'male'; choice?: ModestyChoice },
): Modesty {
  const { arms: armRule, hijab: hijabRules } = preset.modesty;
  const choice = ctx.choice ?? {};

  const arms = choice.arms ?? armRule.default;
  if (!armsAtLeast(arms, armRule.least)) {
    throw new ModestyError(
      'LESS_MODEST_THAN_PRESET',
      `${preset.name} shows arms at least ${armRule.least}; "${arms}" is less modest than the Preset allows`,
    );
  }

  const canWearHijab = ctx.gender === 'female' && presetShows(preset, 'person');
  if (!canWearHijab) {
    if (choice.hijab === true) {
      throw new ModestyError('HIJAB_NOT_OFFERED', `a hijab is offered only for a woman on screen in ${preset.name}`);
    }
    return { arms, hijab: false };
  }

  const rule = hijabRules[ctx.dialect];
  if (rule === 'required' && choice.hijab === false) {
    throw new ModestyError(
      'LESS_MODEST_THAN_PRESET',
      `${preset.name} requires a hijab in this Dialect; turning it off is less modest than the Preset allows`,
    );
  }
  return { arms, hijab: choice.hijab ?? rule !== 'off' };
}
