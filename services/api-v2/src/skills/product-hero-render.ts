// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Preset render — which drafts may be rendered, and the render claim (#5).
 * Product Hero was the first Preset; every Preset render resolves its draft
 * here, against its own definition (#16).
 *
 * The render phase ships exactly the audio the user approved, so it only
 * accepts a draft that:
 *   - belongs to the caller (someone else's draft is indistinguishable from none),
 *   - is not being rendered and was never rendered successfully,
 *   - speaks within the Preset's speech band (5–15 s for Product Hero), and
 *   - was spoken by a Voice that is an Approved Voice of its Dialect NOW: only
 *     Approved Voices may appear in a Short (CONTEXT.md), so a Voice revoked
 *     since drafting, or a legacy draft with no catalog Voice, is refused.
 * The quote and run routes both resolve the draft here, so a quote can never
 * price a draft the run would refuse.
 *
 * The render claim (short_drafts.render_run_id, guarded by a trigger — see
 * supabase/migrations/20260923120000_short_drafts_render_claim.sql) names the
 * skill run rendering the draft. It is taken conditionally on its current value,
 * so two concurrent renders cannot both start, and it is released when that run
 * fails or is canceled (both refund), so the user can retry the SAME draft. A
 * claim still held by a failed or canceled run (its release did not happen) is
 * treated as free and replaced in one step. A succeeded run's claim is permanent.
 */

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CharacterAlignment, PresetDefinition } from '@agentmedia/schema';

/** Where the run holding a draft's claim is. */
export type RenderRunStatus = 'submitted' | 'running' | 'succeeded' | 'failed' | 'canceled';

/** The draft fields the render needs. */
export interface RenderableDraft {
  id: string;
  user_id: string;
  dialect: string;
  /** The catalog Voice that spoke it; null on drafts from before the catalog. */
  voice_catalog_id: string | null;
  /** Private storage key; passed to the worker, never to a client. */
  audio_key: string;
  duration_ms: number;
  /** The voiced Script's TTS character alignment (Delivery Tags included); Captions (#10) are timed from it. */
  alignment: CharacterAlignment;
  /** The skill run holding the render claim; null = free. */
  render_run_id: string | null;
  /** What the draft was written from; Hands-on (#18) picks its default setting and hand gender from them. */
  brief?: string | null;
  product_details?: string | null;
  /** Product Interaction (#25): how a real person uses the product; every Preset render passes it to the worker. */
  product_interaction?: string | null;
  /** That run's status (null when there is no claim, or its run is missing). */
  render_run_status: RenderRunStatus | null;
}

/** The catalog fields the Voice gate reads. */
export interface DraftVoice {
  dialect: string;
  state: string;
}

export interface ProductHeroDraftStore {
  /** The draft only if `userId` owns it (with its claim's run status); null otherwise. */
  getOwned(id: string, userId: string): Promise<RenderableDraft | null>;
  /** A catalog Voice by id; null if there is none. */
  getVoice(id: string): Promise<DraftVoice | null>;
  /**
   * Point the draft's claim at `runId` if it still holds `current` (null = free,
   * or the failed/canceled run getOwned saw). False when someone else won.
   */
  claimForRender(id: string, userId: string, runId: string, current: string | null): Promise<boolean>;
  /** Release whatever draft `runId` holds (after that run failed or was canceled). Idempotent. */
  releaseRender(runId: string): Promise<void>;
}

/** A refusal the route maps to a status and a machine-readable code. */
export class RenderRefusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Extra machine-readable fields for the response body (e.g. a refused shot edit's shot_id). */
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
  }
}

/**
 * Every refusal a make_product_hero quote or run can answer with, by code: the
 * one table the refusals below and the OpenAPI entry (skills-openapi.ts) read.
 */
export const RENDER_REFUSALS = {
  captions_moved: {
    status: 400,
    when: 'the body has a `captions` field (any value): a render never burns Captions; they are added after the render with the Caption editor (GET /v1/shorts/{id}/captions, POST /v1/shorts/{id}/caption-exports)',
  },
  draft_not_found: { status: 404, when: 'no such draft on this account' },
  draft_render_in_flight: { status: 409, when: 'a render of this draft is in flight; if it fails, the draft can be rendered again' },
  draft_already_rendered: { status: 409, when: 'this draft was already rendered into a Short; re-voice to make a new draft' },
  draft_out_of_band: { status: 422, when: 'the draft does not speak for 5–15 s' },
  voice_not_approved: {
    status: 422,
    when: "the draft's Voice is not an Approved Voice of its Dialect now (revoked, or voiced before the catalog); re-voice",
  },
  // Shot Plan review (#26, skills/shot-plan.ts): a refused `shot_edits` entry, with its shot_id and reason.
  SHOT_EDIT_INVALID: {
    status: 422,
    when: 'a `shot_edits` entry names a shot the Shot Plan does not have, or its scene text is empty, over the length cap, or carries bracketed tags or reference syntax (@image1, "reference image")',
  },
  SHOT_EDIT_BREAKS_GUARDRAIL: {
    status: 422,
    when: 'a `shot_edits` scene contradicts a Guardrail: someone speaks, a hijab comes off, arms or skin are bared, someone undresses (English or Arabic)',
  },
} as const;
export type RenderRefusalCode = keyof typeof RENDER_REFUSALS;

const refusal = (code: RenderRefusalCode, message: string) => new RenderRefusal(RENDER_REFUSALS[code].status, code, message);

/** Where Captions went (#22): the message of every `captions_moved` refusal. */
export const CAPTIONS_MOVED_MESSAGE =
  'Captions are added after the render with the Caption editor (GET /v1/shorts/{id}/captions, POST /v1/shorts/{id}/caption-exports).';

/**
 * Whether a Preset render body still carries #10's `captions` field. Any value
 * counts, even false: the field no longer exists, and a client sending it
 * should learn where Captions went instead of having it silently dropped.
 */
export const hasCaptionsField = (body: unknown): boolean =>
  typeof body === 'object' && body !== null && !Array.isArray(body) && Object.prototype.hasOwnProperty.call(body, 'captions');

export const captionsMoved = () => refusal('captions_moved', CAPTIONS_MOVED_MESSAGE);

/**
 * Wrap a Preset render's input schema so #10's old `captions` field (any value)
 * is refused with the Caption editor pointer instead of being silently dropped.
 * The run and quote routes answer the same case first, as 400 captions_moved;
 * this keeps the schema itself honest for anyone else validating with it.
 * Every Preset render skill's schema (make_product_hero, make_reaction, …) uses it.
 */
export function refuseCaptionsField<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T, z.output<T>, unknown> {
  return z.preprocess((raw, ctx) => {
    if (hasCaptionsField(raw)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['captions'], message: CAPTIONS_MOVED_MESSAGE });
    return raw;
  }, schema);
}

export const draftNotFound = () =>
  refusal('draft_not_found', 'No such draft on this account. Make a draft first (POST /v1/drafts/product-hero).');

export const draftAlreadyRendered = () =>
  refusal(
    'draft_already_rendered',
    'This draft has already been rendered into a Short. Re-voice its Script to make a new draft, then render that.',
  );

export const draftRenderInFlight = () =>
  refusal(
    'draft_render_in_flight',
    'This draft is being rendered right now. Poll that run; if it fails, the draft can be rendered again.',
  );

export const voiceNotApproved = (legacy: boolean) =>
  refusal(
    'voice_not_approved',
    (legacy
      ? 'This draft was voiced before the Voice catalog, so its Voice was never approved.'
      : 'The Voice that spoke this draft is not an Approved Voice of its Dialect (it may have been revoked).') +
      ' Re-voice the Script with an Approved Voice (GET /v1/voices), then render the new draft.',
  );

/** Refuse a draft whose claim still blocks a new render. */
function assertClaimFree(draft: RenderableDraft): void {
  if (!draft.render_run_id) return;
  switch (draft.render_run_status) {
    case 'failed':
    case 'canceled':
      return; // refunded; the claim is (or may be) released and replaced
    case 'succeeded':
      throw draftAlreadyRendered();
    default:
      // submitted, running — or a run we cannot see: never double-render.
      throw draftRenderInFlight();
  }
}

/** Resolve a draft the caller may render as `preset`, or throw the RenderRefusal to send. */
export async function resolveRenderableDraft(
  store: ProductHeroDraftStore,
  userId: string,
  draftId: string,
  preset: PresetDefinition,
): Promise<RenderableDraft> {
  const draft = await store.getOwned(draftId, userId);
  if (!draft) throw draftNotFound();
  assertClaimFree(draft);
  const ms = Number(draft.duration_ms);
  if (!Number.isFinite(ms) || ms < preset.minSpeechMs || ms > preset.maxSpeechMs) {
    throw refusal(
      'draft_out_of_band',
      `This draft speaks for ${(ms / 1000).toFixed(1)} s; a ${preset.name} Short needs ` +
        `${preset.minSpeechMs / 1000}–${preset.maxSpeechMs / 1000} s. Edit the Script and re-voice it.`,
    );
  }
  if (!draft.voice_catalog_id) throw voiceNotApproved(true);
  const voice = await store.getVoice(draft.voice_catalog_id);
  if (!voice || voice.state !== 'approved' || voice.dialect !== draft.dialect) throw voiceNotApproved(false);
  return draft;
}

const TABLE = 'short_drafts';

export function supabaseProductHeroDraftStore(supabase: SupabaseClient): ProductHeroDraftStore {
  return {
    async getOwned(id, userId) {
      // Service-role client bypasses RLS, so ownership is enforced here.
      const { data, error } = await supabase
        .from(TABLE)
        .select('id, user_id, dialect, voice_catalog_id, audio_key, duration_ms, alignment, render_run_id, brief, product_details, product_interaction')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw new Error(`short_drafts read: ${error.message}`);
      if (!data) return null;
      const row = data as Omit<RenderableDraft, 'render_run_status'>;
      let status: RenderRunStatus | null = null;
      if (row.render_run_id) {
        const { data: run, error: runErr } = await supabase
          .from('skill_runs')
          .select('status')
          .eq('id', row.render_run_id)
          .maybeSingle();
        if (runErr) throw new Error(`skill_runs read: ${runErr.message}`);
        status = (run as { status?: RenderRunStatus } | null)?.status ?? null;
      }
      return {
        ...row,
        voice_catalog_id: row.voice_catalog_id ?? null,
        render_run_id: row.render_run_id ?? null,
        render_run_status: status,
      };
    },
    async getVoice(id) {
      const { data, error } = await supabase.from('voices').select('dialect, state').eq('id', id).maybeSingle();
      if (error) throw new Error(`voices read: ${error.message}`);
      return (data as DraftVoice | null) ?? null;
    },
    async claimForRender(id, userId, runId, current) {
      const base = supabase.from(TABLE).update({ render_run_id: runId }).eq('id', id).eq('user_id', userId);
      const { data, error } = await (current ? base.eq('render_run_id', current) : base.is('render_run_id', null)).select('id');
      if (error) throw new Error(`short_drafts claim: ${error.message}`);
      return Array.isArray(data) && data.length === 1;
    },
    async releaseRender(runId) {
      const { error } = await supabase.from(TABLE).update({ render_run_id: null }).eq('render_run_id', runId);
      if (error) throw new Error(`short_drafts release: ${error.message}`);
    },
  };
}
