// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Dialects (CONTEXT.md) — the ONE list. The Voice catalog, the drafts, the
 * Qualified Presets and the picker all import from here; the SQL CHECKs on
 * voices / qualified_presets (every Dialect) and short_drafts (Script Dialects)
 * are held equal to these lists by api-v2's dialect-parity test.
 */

/** Every Dialect, in picker order. A Voice is tagged with exactly one. */
export const DIALECTS = ['levantine', 'gulf', 'egyptian', 'maghrebi', 'msa'] as const;
export type Dialect = (typeof DIALECTS)[number];

export const DIALECT_NAMES: Readonly<Record<Dialect, string>> = {
  levantine: 'Levantine',
  gulf: 'Gulf',
  egyptian: 'Egyptian',
  maghrebi: 'Maghrebi',
  msa: 'MSA',
};

/**
 * Dialects a Script can be written in today (each has a Dialect guide). Only
 * these can be drafted, so only these can be sampled and qualified.
 */
export const SCRIPT_DIALECTS = ['levantine', 'gulf'] as const satisfies readonly Dialect[];
export type ScriptDialect = (typeof SCRIPT_DIALECTS)[number];
