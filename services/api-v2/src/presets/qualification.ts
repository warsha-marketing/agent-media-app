// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Qualified Presets (#8): which Preset–Dialect pairs users are offered
 * (CONTEXT.md: Preset, Qualified Preset, Dialect).
 *
 *   (not reviewed) ──qualify──▶ qualified ──withdraw──▶ withdrawn ──qualify──▶ qualified
 *
 * A pair becomes qualified only when an operator qualifies it after native
 * speakers of that Dialect accepted its sample Shorts. A completed render is
 * never evidence of quality on its own, so nothing automatic qualifies a pair.
 * Qualifying and withdrawing record who and when. The table is read on every
 * request, so a withdrawn pair stops being offered, drafted and rendered at once.
 *
 * `assertPresetAvailable` is THE gate the draft routes (create, re-voice) and the
 * render routes (quote, run) call: an unqualified pair is refused with
 * PRESET_NOT_QUALIFIED. Operators pass it, so they can make the sample Shorts
 * native reviewers judge before a pair is qualified.
 *
 * A Preset is identified by its stable id ('product_hero'), from the Preset
 * registry (@agentmedia/schema PRESETS, #16), which defines what a Preset IS;
 * this module only decides which Preset–Dialect pairs are offered.
 *
 * Every dependency is injected (PresetDeps) so the route tests run on fakes.
 */

import { z } from 'zod';
import { DIALECTS, DIALECT_NAMES, PRESETS as PRESET_DEFINITIONS, SCRIPT_DIALECTS, type Dialect, type PresetId } from '@agentmedia/schema';
import { SKILLS } from '../skills/registry.js';

// ── Vocabulary ───────────────────────────────────────────────────────────────

/** What the picker says about each Preset. Keyed by PresetId, so a new Preset
 *  in the registry does not compile until it has its picker line. */
const PICKER_SUMMARIES: Record<PresetId, string> = {
  product_hero: 'Silent product shots cut to an Arabic voice-over. Only your product on screen.',
  reaction: 'Your saved character reacts silently to your product, intercut with product shots, under an Arabic voice-over.',
};

/**
 * One picker row per Preset, in registry order: every Preset definition
 * (@agentmedia/schema PRESETS, #16 — what a Preset IS) with its picker line and
 * the skill that renders it. Adding Hands-on and Reaction (#15) to the registry
 * lists them here; users are offered one only once an operator qualifies a
 * Dialect for it.
 */
export const PRESET_PICKER_ROWS = (Object.keys(PRESET_DEFINITIONS) as PresetId[]).map((id) => ({
  slug: id,
  name: PRESET_DEFINITIONS[id].name,
  summary: PICKER_SUMMARIES[id],
  /** The skill that renders it (POST /v1/skills/{skill}/quote and /run). */
  skill: Object.values(SKILLS).find((s) => s.preset?.id === id)?.slug ?? null,
}));
export const PRESET_SLUGS = PRESET_PICKER_ROWS.map((p) => p.slug);

// Dialects: every Dialect (DIALECTS, picker order; the ones not qualified show as
// "coming soon") and the Script Dialects (SCRIPT_DIALECTS: only these can be
// drafted, so only these can be sampled and qualified) come from ONE list in
// @agentmedia/schema (src/dialects.ts).

export const QUALIFICATION_STATES = ['qualified', 'withdrawn'] as const;
export type QualificationState = (typeof QUALIFICATION_STATES)[number];

// ── Inputs ───────────────────────────────────────────────────────────────────

export const QualificationPathSchema = z
  .object({
    preset: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'not a Preset slug'),
    dialect: z.enum(SCRIPT_DIALECTS, {
      errorMap: () => ({ message: `only a Dialect a Script can be written in can be qualified (${SCRIPT_DIALECTS.join(', ')})` }),
    }),
  })
  .strict();

export const QualificationBodySchema = z
  .object({
    /** Who reviewed it and what they heard (reviewer, sample links). Replaces the pair's notes when given. */
    notes: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();
export type QualificationBody = z.infer<typeof QualificationBodySchema>;

// ── Rows ─────────────────────────────────────────────────────────────────────

export interface QualifiedPresetRow {
  preset: string;
  dialect: string;
  state: QualificationState;
  /** The operator who last qualified it; null only on a migration seed, whose notes say who reviewed it. */
  qualified_by: string | null;
  qualified_at: string;
  /** The last withdrawal. Kept when the pair is qualified again after a new review. */
  withdrawn_by: string | null;
  withdrawn_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type QualifyPatch = { state: 'qualified'; qualified_by: string; qualified_at: string; notes?: string };
export type WithdrawPatch = { state: 'withdrawn'; withdrawn_by: string; withdrawn_at: string; notes?: string };

/** What the draft and render gates need: the qualified Dialects of a Preset, and who is an operator. */
export interface PresetAccess {
  /** Dialects qualified for `preset` now. Read per request, never cached. */
  qualifiedDialects(preset: string): Promise<string[]>;
  isOperator(userId: string): Promise<boolean>;
}

export interface PresetDeps extends PresetAccess {
  repo: {
    list(): Promise<QualifiedPresetRow[]>;
    get(preset: string, dialect: string): Promise<QualifiedPresetRow | null>;
    /** Insert the pair as qualified, or move it withdrawn → qualified; null if it is already qualified. */
    qualify(preset: string, dialect: string, patch: QualifyPatch): Promise<QualifiedPresetRow | null>;
    /** Move the pair qualified → withdrawn; null if it is not qualified. */
    withdraw(preset: string, dialect: string, patch: WithdrawPatch): Promise<QualifiedPresetRow | null>;
  };
  now(): Date;
}

/**
 * The refusal code for a Preset–Dialect pair that is not a Qualified Preset —
 * ONE string on every route that sends it: the drafts routes (in their
 * `{ error: { code, message, … } }` envelope) and the skill quote/run routes
 * (in theirs, `{ error: code, skill, detail, … }`). It is the domain error's own
 * code, in the UPPER_SNAKE spelling the drafts/presets/voices routes use for
 * every code, so no route renames it.
 */
export const PRESET_NOT_QUALIFIED = 'PRESET_NOT_QUALIFIED';

export class PresetError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const presetOf = (slug: string) => PRESET_PICKER_ROWS.find((p) => p.slug === slug) ?? null;
const presetName = (slug: string) => presetOf(slug)?.name ?? slug;
const dialectName = (d: string) => DIALECT_NAMES[d as Dialect] ?? d;

// ── The gate ─────────────────────────────────────────────────────────────────

/**
 * Pass if `preset` is qualified for `dialect`, or the caller is an operator
 * (making reviewer sample Shorts); otherwise PRESET_NOT_QUALIFIED (422).
 * Returns whether the pass is an operator sample. The operator check runs only
 * for an unqualified pair, and fails closed.
 */
export async function assertPresetAvailable(
  access: PresetAccess,
  userId: string,
  preset: string,
  dialect: string,
): Promise<{ operatorSample: boolean }> {
  const qualified = await access.qualifiedDialects(preset);
  if (qualified.includes(dialect)) return { operatorSample: false };
  let operator = false;
  try {
    operator = await access.isOperator(userId);
  } catch (err) {
    console.error(`[presets] operator check failed: ${(err as Error)?.message ?? 'unknown error'}`);
  }
  if (operator) return { operatorSample: true };
  const available = DIALECTS.filter((d) => qualified.includes(d));
  throw new PresetError(
    422,
    PRESET_NOT_QUALIFIED,
    `${presetName(preset)} is not offered in ${dialectName(dialect)} yet (coming soon). ` +
      (available.length ? `Available: ${available.map(dialectName).join(', ')}.` : 'No Dialect is available for it yet.'),
    { preset, dialect, available },
  );
}

// ── The picker ───────────────────────────────────────────────────────────────

/**
 * The Preset picker for a caller: each Preset with every Dialect marked
 * available or coming soon. Users see only Presets with at least one available
 * Dialect (only Qualified Presets are offered). Operators see every Preset, and
 * `sample: true` on the unqualified Dialects they can still draft to make
 * reviewer samples.
 */
export async function listPresetsFor(deps: Pick<PresetDeps, 'repo' | 'isOperator'>, userId: string) {
  const [rows, operator] = await Promise.all([deps.repo.list(), deps.isOperator(userId).catch(() => false)]);
  const qualified = new Set(rows.filter((r) => r.state === 'qualified').map((r) => `${r.preset}:${r.dialect}`));
  const presets = PRESET_PICKER_ROWS.map((p) => ({
    slug: p.slug,
    name: p.name,
    summary: p.summary,
    skill: p.skill,
    dialects: DIALECTS.map((d) => {
      const available = qualified.has(`${p.slug}:${d}`);
      return {
        dialect: d,
        name: DIALECT_NAMES[d],
        status: available ? ('available' as const) : ('coming_soon' as const),
        ...(operator ? { sample: !available && (SCRIPT_DIALECTS as readonly string[]).includes(d) } : {}),
      };
    }),
  })).filter((p) => operator || p.dialects.some((d) => d.status === 'available'));
  return { presets, operator };
}

// ── Operator operations ──────────────────────────────────────────────────────

function knownPreset(slug: string): void {
  if (!presetOf(slug)) throw new PresetError(404, 'PRESET_NOT_FOUND', `No Preset "${slug}".`, { preset: slug });
}

/** Every Preset × Script Dialect, with its review trail; a pair never qualified is 'not_reviewed'. */
export async function operatorQualifications(deps: Pick<PresetDeps, 'repo'>) {
  const rows = await deps.repo.list();
  const byPair = new Map(rows.map((r) => [`${r.preset}:${r.dialect}`, r]));
  return PRESET_PICKER_ROWS.flatMap((p) =>
    SCRIPT_DIALECTS.map((d) => {
      const row = byPair.get(`${p.slug}:${d}`);
      return row
        ? { ...toQualificationView(row), preset_name: p.name }
        : { ...emptyView(p.slug, d), preset_name: p.name };
    }),
  );
}

async function currentState(deps: PresetDeps, preset: string, dialect: string): Promise<string> {
  return (await deps.repo.get(preset, dialect))?.state ?? 'not_reviewed';
}

/** After native speakers of the Dialect accepted its sample Shorts. Records who and when. */
export async function qualifyPreset(deps: PresetDeps, operatorId: string, preset: string, dialect: string, body: QualificationBody) {
  knownPreset(preset);
  const row = await deps.repo.qualify(preset, dialect, {
    state: 'qualified',
    qualified_by: operatorId,
    qualified_at: deps.now().toISOString(),
    ...(body.notes ? { notes: body.notes } : {}),
  });
  if (row) return toQualificationView(row);
  throw new PresetError(409, 'QUALIFICATION_STATE_CONFLICT', `${presetName(preset)} is already qualified for ${dialectName(dialect)}.`, {
    state: await currentState(deps, preset, dialect),
  });
}

/** Stops offering, drafting and rendering the pair at once. Records who and when. */
export async function withdrawPreset(deps: PresetDeps, operatorId: string, preset: string, dialect: string, body: QualificationBody) {
  knownPreset(preset);
  const row = await deps.repo.withdraw(preset, dialect, {
    state: 'withdrawn',
    withdrawn_by: operatorId,
    withdrawn_at: deps.now().toISOString(),
    ...(body.notes ? { notes: body.notes } : {}),
  });
  if (row) return toQualificationView(row);
  throw new PresetError(409, 'QUALIFICATION_STATE_CONFLICT', `${presetName(preset)} is not qualified for ${dialectName(dialect)}, so it cannot be withdrawn.`, {
    state: await currentState(deps, preset, dialect),
  });
}

// ── Views ────────────────────────────────────────────────────────────────────

export function toQualificationView(row: QualifiedPresetRow) {
  return {
    preset: row.preset,
    dialect: row.dialect,
    state: row.state as QualificationState | 'not_reviewed',
    qualified_by: row.qualified_by,
    qualified_at: row.qualified_at as string | null,
    withdrawn_by: row.withdrawn_by,
    withdrawn_at: row.withdrawn_at,
    notes: row.notes,
  };
}
export type QualificationView = ReturnType<typeof toQualificationView>;

function emptyView(preset: string, dialect: string): QualificationView {
  return { preset, dialect, state: 'not_reviewed', qualified_by: null, qualified_at: null, withdrawn_by: null, withdrawn_at: null, notes: null };
}
