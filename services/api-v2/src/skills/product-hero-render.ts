// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Product Hero render — which drafts may be rendered, and claiming one (#5).
 *
 * The render phase ships exactly the audio the user approved, so it only
 * accepts a draft that:
 *   - belongs to the caller (someone else's draft is indistinguishable from none),
 *   - has not been rendered yet (a draft renders at most once), and
 *   - speaks for 5–15 s (the Preset's duration contract).
 * The quote and run routes both resolve the draft here, so a quote can never
 * price a draft the run would refuse.
 *
 * Claiming stamps short_drafts.rendered_at, conditionally on it still being
 * NULL, so two concurrent renders of one draft cannot both start. The column is
 * set-once (a trigger forbids any other change to a rendered draft), so a claim
 * is final: a render that later fails is refunded, and the draft stays spent —
 * the user re-voices (free) to render again.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { PRODUCT_HERO } from '@agentmedia/schema';

/** The draft fields the render needs. */
export interface RenderableDraft {
  id: string;
  user_id: string;
  /** Private storage key; passed to the worker, never to a client. */
  audio_key: string;
  duration_ms: number;
  rendered_at: string | null;
}

export interface ProductHeroDraftStore {
  /** The draft only if `userId` owns it; null otherwise. */
  getOwned(id: string, userId: string): Promise<RenderableDraft | null>;
  /** Stamp rendered_at if still unset. False when it was already stamped. */
  claimForRender(id: string, userId: string): Promise<boolean>;
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
    'This draft has already been rendered; a draft renders once. Re-voice its Script to make a new draft, then render that.',
  );

/** Resolve a draft the caller may render, or throw the RenderRefusal to send. */
export async function resolveRenderableDraft(
  store: ProductHeroDraftStore,
  userId: string,
  draftId: string,
): Promise<RenderableDraft> {
  const draft = await store.getOwned(draftId, userId);
  if (!draft) throw draftNotFound();
  if (draft.rendered_at) throw draftAlreadyRendered();
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
        .select('id, user_id, audio_key, duration_ms, rendered_at')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw new Error(`short_drafts read: ${error.message}`);
      return (data as RenderableDraft | null) ?? null;
    },
    async claimForRender(id, userId) {
      const { data, error } = await supabase
        .from(TABLE)
        .update({ rendered_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId)
        .is('rendered_at', null)
        .select('id');
      if (error) throw new Error(`short_drafts claim: ${error.message}`);
      return Array.isArray(data) && data.length === 1;
    },
  };
}
