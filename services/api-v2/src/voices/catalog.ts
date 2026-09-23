// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The Voice catalog (#7): every Voice a Short may be spoken in, each tagged with
 * exactly one Dialect and an approval state (CONTEXT.md: Voice, Approved Voice).
 *
 *   pending  ──approve──▶ approved ──revoke──▶ revoked ──approve──▶ approved
 *      └────────────revoke────────────▶ revoked
 *
 * A Voice becomes an Approved Voice only when an operator approves it after a
 * native speaker of its Dialect accepted it; nothing automatic can approve one.
 * Approving and revoking record who and when. Users only ever see Approved
 * Voices of the Dialect they asked for, read straight from the table on every
 * request, so a revoked Voice leaves the picker at once. Drafting (drafts/) asks
 * `approvedVoiceFor` and refuses anything else with VOICE_NOT_APPROVED.
 *
 * Operators are the ADMIN_EMAILS allowlist the web admin panel already uses
 * (see voices/providers.ts); here they are just `isOperator(userId)`.
 *
 * Every dependency is injected (VoiceDeps) so the route tests run on fakes.
 */

import { z } from 'zod';

// ── Vocabulary ───────────────────────────────────────────────────────────────

/** Every Dialect a Voice can be tagged with (CONTEXT.md). Which Dialects can be
 *  drafted is a separate question (drafts/ LIVE_DIALECTS). */
export const VOICE_DIALECTS = ['levantine', 'gulf', 'egyptian', 'maghrebi', 'msa'] as const;
export type VoiceDialect = (typeof VOICE_DIALECTS)[number];
export const VoiceDialectSchema = z.enum(VOICE_DIALECTS);

// Male or female only: a gender-neutral voice is not culturally acceptable for
// MENA ads (owner decision, 2026-09-23).
export const VOICE_GENDERS = ['female', 'male'] as const;
export type VoiceGender = (typeof VOICE_GENDERS)[number];

export const VOICE_STATES = ['pending', 'approved', 'revoked'] as const;
export type VoiceState = (typeof VOICE_STATES)[number];

/** Voice providers a Voice can be spoken by. */
export const VOICE_PROVIDERS = ['elevenlabs'] as const;

/** Delivery style, a short lowercase tag ("warm", "energetic", "calm"). */
const StyleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9-]{0,39}$/, 'style is a short lowercase tag, e.g. warm or energetic');

/** An https URL the browser can play, with no credentials in it. */
const SampleUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2_000)
  .refine((v) => {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password;
  }, 'sample_url must be an https URL without credentials');

// ── Inputs ───────────────────────────────────────────────────────────────────

export const ListVoicesQuerySchema = z
  .object({
    dialect: VoiceDialectSchema,
    gender: z.enum(VOICE_GENDERS).optional(),
    style: StyleSchema.optional(),
  })
  .strict();
export type ListVoicesQuery = z.infer<typeof ListVoicesQuerySchema>;

export const OperatorListQuerySchema = z
  .object({
    state: z.enum(VOICE_STATES).optional(),
    dialect: VoiceDialectSchema.optional(),
  })
  .strict();
export type OperatorListQuery = z.infer<typeof OperatorListQuerySchema>;

export const AddVoiceInputSchema = z
  .object({
    provider: z.enum(VOICE_PROVIDERS).default('elevenlabs'),
    provider_voice_id: z.string().trim().regex(/^[A-Za-z0-9_-]{10,80}$/, 'not a provider voice id'),
    display_name: z.string().trim().min(1).max(80),
    /** Exactly one Dialect: the one a native speaker reviews it in. */
    dialect: VoiceDialectSchema,
    gender: z.enum(VOICE_GENDERS),
    style: StyleSchema,
    sample_url: SampleUrlSchema,
  })
  .strict();
export type AddVoiceInput = z.infer<typeof AddVoiceInputSchema>;

// Candidate search filters, mapped onto ElevenLabs GET /v1/shared-voices by
// voices/candidates.ts. Each list is the provider's own vocabulary.
export const CANDIDATE_AGES = ['young', 'middle_aged', 'old'] as const;
export const CANDIDATE_USE_CASES = [
  'advertisement',
  'narrative_story',
  'social_media',
  'conversational',
  'characters_animation',
  'informative_educational',
  'entertainment_tv',
] as const;
export const CANDIDATE_SORTS = ['trending', 'created_date', 'usage_character_count_1y', 'cloned_by_count'] as const;

export const CandidatesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(0).max(1_000).default(0),
    /** Fans out to every provider accent of the Dialect (voices/candidates.ts DIALECT_ACCENTS). */
    dialect: VoiceDialectSchema.optional(),
    /** One provider accent label, e.g. "syrian". Use instead of dialect, not with it. */
    accent: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z -]{0,39}$/, 'accent is a short lowercase label, e.g. syrian')
      .optional(),
    // Male or female only; "neutral" is refused here and dropped from results.
    gender: z.enum(VOICE_GENDERS).optional(),
    age: z.enum(CANDIDATE_AGES).optional(),
    use_case: z.enum(CANDIDATE_USE_CASES).optional(),
    sort: z.enum(CANDIDATE_SORTS).optional(),
    search: z
      .string()
      .trim()
      .max(60)
      .regex(/^[^\u0000-\u001f\u007f]*$/, 'search has control characters')
      .optional(),
  })
  .strict()
  .refine((q) => !(q.dialect && q.accent), { message: 'pass dialect or accent, not both', path: ['accent'] });
export type CandidateSearch = z.infer<typeof CandidatesQuerySchema>;

// ── Rows ─────────────────────────────────────────────────────────────────────

export interface VoiceRow {
  id: string;
  provider: string;
  provider_voice_id: string;
  display_name: string;
  dialect: VoiceDialect;
  gender: VoiceGender;
  style: string;
  sample_url: string;
  state: VoiceState;
  added_by: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  /** The last revocation. Kept when a Voice is approved again after a new review. */
  revoked_by: string | null;
  revoked_at: string | null;
}

export type NewVoiceRow = Omit<VoiceRow, 'created_at' | 'approved_by' | 'approved_at' | 'revoked_by' | 'revoked_at'>;

export type VoiceStatePatch =
  | { state: 'approved'; approved_by: string; approved_at: string }
  | { state: 'revoked'; revoked_by: string; revoked_at: string };

/** A voice found in a provider's shared library: raw material for a candidate. */
export interface VoiceCandidate {
  provider: string;
  provider_voice_id: string;
  display_name: string;
  description: string;
  gender: VoiceGender | null;
  accent: string;
  /** The provider's accent label mapped to a Dialect; a guess for the operator, never an approval. */
  suggested_dialect: VoiceDialect | null;
  style: string | null;
  sample_url: string | null;
}

export interface VoiceDeps {
  repo: {
    /** Every Approved Voice of one Dialect. Read per request, never cached. */
    listApproved(dialect: VoiceDialect): Promise<VoiceRow[]>;
    list(filter: OperatorListQuery): Promise<VoiceRow[]>;
    get(id: string): Promise<VoiceRow | null>;
    /** Throws VoiceError 409 VOICE_EXISTS when the provider voice is already catalogued. */
    insert(row: NewVoiceRow): Promise<VoiceRow>;
    /** Atomically apply `patch` iff the Voice is in one of `from`; null otherwise. */
    transition(id: string, from: VoiceState[], patch: VoiceStatePatch): Promise<VoiceRow | null>;
  };
  isOperator(userId: string): Promise<boolean>;
  findCandidates(query: CandidateSearch): Promise<{ candidates: VoiceCandidate[]; has_more: boolean; page: number }>;
  now(): Date;
  newId(): string;
}

export class VoiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

// ── Operations ───────────────────────────────────────────────────────────────

/**
 * The picker: Approved Voices of the Dialect, narrowed by gender and style, plus
 * every style on offer in that Dialect (so a filter never offers an empty choice).
 * A Dialect has a handful of Voices, so narrowing happens here, not in SQL.
 */
export async function listApprovedVoices(deps: Pick<VoiceDeps, 'repo'>, query: ListVoicesQuery) {
  const all = await deps.repo.listApproved(query.dialect);
  const voices = all
    .filter((v) => v.state === 'approved' && v.dialect === query.dialect)
    .filter((v) => !query.gender || v.gender === query.gender)
    .filter((v) => !query.style || v.style === query.style)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  const styles = [...new Set(all.map((v) => v.style))].sort();
  return { voices: voices.map(toVoiceView), styles };
}

export async function addCandidateVoice(deps: VoiceDeps, operatorId: string, input: AddVoiceInput): Promise<VoiceRow> {
  return deps.repo.insert({
    id: deps.newId(),
    provider: input.provider,
    provider_voice_id: input.provider_voice_id,
    display_name: input.display_name,
    dialect: input.dialect,
    gender: input.gender,
    style: input.style,
    sample_url: input.sample_url,
    state: 'pending',
    added_by: operatorId,
  });
}

async function transition(
  deps: VoiceDeps,
  id: string,
  from: VoiceState[],
  patch: VoiceStatePatch,
): Promise<VoiceRow> {
  const row = await deps.repo.transition(id, from, patch);
  if (row) return row;
  const current = await deps.repo.get(id);
  if (!current) throw new VoiceError(404, 'VOICE_NOT_FOUND', 'Voice not found.');
  throw new VoiceError(
    409,
    'VOICE_STATE_CONFLICT',
    `This Voice is ${current.state}; it cannot be ${patch.state} from there.`,
    { state: current.state },
  );
}

/** After a native speaker of its Dialect accepted it. Records who and when. */
export function approveVoice(deps: VoiceDeps, operatorId: string, id: string): Promise<VoiceRow> {
  return transition(deps, id, ['pending', 'revoked'], {
    state: 'approved',
    approved_by: operatorId,
    approved_at: deps.now().toISOString(),
  });
}

/** Takes a Voice out of the picker and out of drafting at once. Records who and when. */
export function revokeVoice(deps: VoiceDeps, operatorId: string, id: string): Promise<VoiceRow> {
  return transition(deps, id, ['pending', 'approved'], {
    state: 'revoked',
    revoked_by: operatorId,
    revoked_at: deps.now().toISOString(),
  });
}

/**
 * The Voice, if it is an Approved Voice of `dialect`; otherwise VOICE_NOT_APPROVED.
 * Unknown, pending, revoked and other-Dialect Voices all get the same code, so
 * the catalog's review state is not exposed to users.
 */
export async function approvedVoiceFor(
  voices: Pick<VoiceDeps['repo'], 'get'>,
  id: string,
  dialect: string,
): Promise<VoiceRow> {
  const voice = await voices.get(id);
  if (voice && voice.state === 'approved' && voice.dialect === dialect) return voice;
  const wrongDialect = voice?.state === 'approved';
  throw new VoiceError(
    422,
    'VOICE_NOT_APPROVED',
    wrongDialect
      ? `This Voice is not approved for the ${dialect} Dialect. Pick an Approved Voice for ${dialect}.`
      : 'This Voice is not an Approved Voice. Pick one from the Approved Voices for your Dialect.',
    { voice_id: id, dialect },
  );
}

// ── Views ────────────────────────────────────────────────────────────────────

/** What users see in the picker: no review trail, no provider ids. */
export function toVoiceView(row: VoiceRow) {
  return {
    id: row.id,
    display_name: row.display_name,
    dialect: row.dialect,
    gender: row.gender,
    style: row.style,
    sample_url: row.sample_url,
  };
}
export type VoiceView = ReturnType<typeof toVoiceView>;

/** What operators see: the whole row, review trail included. */
export function toOperatorVoiceView(row: VoiceRow) {
  return { ...row };
}
