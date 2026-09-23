// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Preset cost budgets (provider USD), enforced in place of the per-primitive cap.
 *
 * Every standalone primitive checks its own estimate against PRIMITIVE_CAP_USD.
 * A Preset is priced as a whole render instead: its clips are planned from the
 * Short's duration, and the PLANNED RENDER must fit the Preset's declared budget.
 * A 10 s Product Hero clip is over the per-primitive cap on its own, yet a whole
 * 15 s Product Hero render is well within what the Preset declares — so the
 * Preset's budget, not the primitive cap, is the right limit for its clips.
 *
 * This only ever applies to a Preset's own clip activity; every other activity
 * keeps checking cfg.caps.primitiveUsd exactly as before. The day cap still
 * applies to Preset clips too.
 *
 * The credit side of the same budget (what the user pays) lives with the shot
 * plan in @agentmedia/schema (PRODUCT_HERO.budget), shared with the API quote.
 */

import { ApplicationFailure } from '@temporalio/activity';
import { planProductHeroShots, type ProductHeroClipSeconds } from '@agentmedia/schema';

export interface PresetBudget {
  /** Our provider cost per clip, by clip length (Seedance 720p via EvoLink). */
  clipUsd: Readonly<Record<ProductHeroClipSeconds, number>>;
  /** The most one render of this Preset may cost us. */
  maxRunUsd: number;
}

/** Product Hero: at most two silent clips (10 s + 5 s) for 15 s of speech. */
export const PRODUCT_HERO_BUDGET: PresetBudget = {
  clipUsd: { 5: 0.6, 10: 1.2 },
  maxRunUsd: 1.8,
};

/** Provider USD for the whole planned Product Hero render of `durationMs`. */
export function plannedProductHeroUsd(durationMs: number, budget: PresetBudget = PRODUCT_HERO_BUDGET): number {
  return planProductHeroShots(durationMs).reduce((sum, s) => sum + budget.clipUsd[s], 0);
}

/**
 * Refuse (non-retryably) a Product Hero render whose plan exceeds its budget.
 * A duration outside the 5–15 s contract is an INVALID_INPUT, not a budget miss.
 */
export function assertWithinProductHeroBudget(durationMs: number, budget: PresetBudget = PRODUCT_HERO_BUDGET): number {
  let planned: number;
  try {
    planned = plannedProductHeroUsd(durationMs, budget);
  } catch (err) {
    throw ApplicationFailure.nonRetryable((err as Error).message, 'INVALID_INPUT');
  }
  if (planned > budget.maxRunUsd + 1e-9) {
    throw ApplicationFailure.nonRetryable(
      `planned Product Hero render $${planned.toFixed(2)} exceeds the Preset budget $${budget.maxRunUsd.toFixed(2)}`,
      'BUDGET_CAP_PRESET',
    );
  }
  return planned;
}
