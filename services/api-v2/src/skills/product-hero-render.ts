// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Product Hero render — which drafts may be rendered, and the render claim (#5).
 *
 * The render phase ships exactly the audio the user approved, so it only
 * accepts a draft that:
 *   - belongs to the caller (someone else's draft is indistinguishable from none),
 *   - is not being rendered and was never rendered successfully, and
 *   - speaks for 5–15 s (the Preset's duration contract).
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

import type { SupabaseClient } from '@supabase/supabase-js';
import { PRODUCT_HERO } from '@agentmedia/schema';

/** Where the run holding a draft's claim is. */
export type RenderRunStatus = 'submitted' | 'running' | 'succeeded' | 'failed' | 'canceled';

/** The draft fields the render needs. */
export interface RenderableDraft {
  id: string;
  user_id: string;
  /** Private storage key; passed to the worker, never to a client. */
  audio_key: string;
  duration_ms: number;
  /** The skill run holding the render claim; null = free. */
  render_run_id: string | null;
  /** That run's status (null when there is no claim, or its run is missing). */
  render_run_status: RenderRunStatus | null;
}

export interface ProductHeroDraftStore {
  /** The draft only if `userId` owns it (with its claim's run status); null otherwise. */
  getOwned(id: string, userId: string): Promise<RenderableDraft | null>;
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
  ) {
    super(message);
  }
}

export const draftNotFound = () =>
  new RenderRefusal(404, 'draft_not_found', 'No such draft on this account. Make a draft first (POST /v1/drafts/product-hero).');

export const draftAlreadyRendered = () =>
  new RenderRefusal(
    409,
    'draft_already_rendered',
    'This draft has already been rendered into a Short. Re-voice its Script to make a new draft, then render that.',
  );

export const draftRenderInFlight = () =>
  new RenderRefusal(
    409,
    'draft_render_in_flight',
    'This draft is being rendered right now. Poll that run; if it fails, the draft can be rendered again.',
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

/** Resolve a draft the caller may render, or throw the RenderRefusal to send. */
export async function resolveRenderableDraft(
  store: ProductHeroDraftStore,
  userId: string,
  draftId: string,
): Promise<RenderableDraft> {
  const draft = await store.getOwned(draftId, userId);
  if (!draft) throw draftNotFound();
  assertClaimFree(draft);
  const ms = Number(draft.duration_ms);
  if (!Number.isFinite(ms) || ms < PRODUCT_HERO.minSpeechMs || ms > PRODUCT_HERO.maxSpeechMs) {
    throw new RenderRefusal(
      422,
      'draft_out_of_band',
      `This draft speaks for ${(ms / 1000).toFixed(1)} s; a Product Hero Short needs ` +
        `${PRODUCT_HERO.minSpeechMs / 1000}–${PRODUCT_HERO.maxSpeechMs / 1000} s. Edit the Script and re-voice it.`,
    );
  }
  return draft;
}

const TABLE = 'short_drafts';

export function supabaseProductHeroDraftStore(supabase: SupabaseClient): ProductHeroDraftStore {
  return {
    async getOwned(id, userId) {
      // Service-role client bypasses RLS, so ownership is enforced here.
      const { data, error } = await supabase
        .from(TABLE)
        .select('id, user_id, audio_key, duration_ms, render_run_id')
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
      return { ...row, render_run_id: row.render_run_id ?? null, render_run_status: status };
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
