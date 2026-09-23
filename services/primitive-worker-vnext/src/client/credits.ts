// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Credit ledger integration for vNext Activities.
 *
 * Deducts at the start of each primitive Activity via the existing
 * Supabase RPC `deduct_credits` (used by legacy generations too).
 * Refunds on terminal failure via `refund_credits(p_job_id)`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ApplicationFailure } from '@temporalio/activity';
import { STARTING_FRAME_CREDITS, VIDEO_CLIP_CREDITS, type StartingFrame } from '@agentmedia/schema';

/**
 * Is billing explicitly disabled for this deployment?
 *
 * FAIL-CLOSED by design: anything other than an explicit opt-out means CHARGE.
 * An unset, empty, misspelled, or partially-configured environment therefore
 * bills normally instead of giving media away.
 *
 * `BILLING_MODE=disabled` is the self-host switch (no credit ledger; the operator
 * pays upstream providers directly). It MUST be set identically on api-v2 and on
 * every worker — a split configuration is what makes silent revenue loss possible,
 * so keep this predicate byte-identical to `isBillingEnabled()` in
 * services/api-v2/src/routes/v1/skills.ts.
 */
export function isBillingDisabled(): boolean {
  return process.env.BILLING_MODE?.trim().toLowerCase() === 'disabled';
}

export type PrimitiveCreditableId =
  | 'portrait_gpt2'
  | 'character_sheet_gpt2'
  | 'simple_selfie'
  | 'product_in_hands'
  | 'subtitles_v2'
  | 'wireframe_gpt2'
  | 'lip_sync'
  | 'product_hero_clip'
  | 'preset_frame';

// Portraits are not charged (free identity prep). Character sheets are charged
// ONLY when generated standalone (make_character_sheet); inside a video flow the
// make_ugc_video workflow passes bill_credits:false so the sheet is free.
const PORTRAIT_CREDITS = 0;
const CHARACTER_SHEET_CREDITS = 35;

// Video clip prices come from the shared table in @agentmedia/schema — the SAME
// one api-v2 quotes from (see packages/schema/src/video-pricing.ts).
const SELFIE_CREDITS_BY_DURATION = VIDEO_CLIP_CREDITS;

/**
 * Credits for one run of `primitive`. `duration` prices a clip; `frame` prices a
 * Preset's starting frame (`preset_frame`) by its kind, from the same table
 * api-v2 quotes from — so a second frame kind is charged its own price.
 */
export function quotePrimitiveCredits(
  primitive: PrimitiveCreditableId,
  duration?: 5 | 10 | 15,
  frame?: StartingFrame,
): number {
  if (primitive === 'product_hero_clip') {
    // A silent clip costs what any clip of its length costs; api-v2 quotes the
    // planned clips from the same table, so the quote is exactly these charges.
    if (duration !== 5 && duration !== 10) {
      throw ApplicationFailure.nonRetryable(`product_hero_clip has no ${duration}s price`, 'INVALID_INPUT');
    }
    return VIDEO_CLIP_CREDITS[duration];
  }
  switch (primitive) {
    case 'portrait_gpt2':
      return PORTRAIT_CREDITS;
    case 'character_sheet_gpt2':
      return CHARACTER_SHEET_CREDITS;
    case 'simple_selfie':
      return SELFIE_CREDITS_BY_DURATION[duration ?? 10];
    case 'product_in_hands':
      return SELFIE_CREDITS_BY_DURATION[duration ?? 10];
    case 'subtitles_v2':
      return 15;
    case 'wireframe_gpt2':
      return 35;
    case 'lip_sync':
      return SELFIE_CREDITS_BY_DURATION[duration ?? 10];
    case 'preset_frame':
      // A Preset's starting frame (#18), by kind: the shared price api-v2 quotes from.
      if (frame === undefined || !Object.hasOwn(STARTING_FRAME_CREDITS, frame)) {
        throw ApplicationFailure.nonRetryable(`preset_frame has no price for frame ${String(frame)}`, 'INVALID_INPUT');
      }
      return STARTING_FRAME_CREDITS[frame];
  }
}

/**
 * Atomically deduct credits and stamp the count onto the primitive_runs
 * row. Throws ApplicationFailure.nonRetryable INSUFFICIENT_CREDITS when
 * the user can't pay (so Temporal doesn't retry).
 *
 * Safe to call after the primitive_runs upsert; the rpc references
 * primitive_run_id as p_job_id so refund_credits can find it later.
 */
export async function deductPrimitiveCredits(args: {
  db: SupabaseClient;
  userId: string;
  primitiveRunId: string;
  primitive: PrimitiveCreditableId;
  duration?: 5 | 10 | 15;
  /** The starting frame's kind: prices a `preset_frame`. */
  frame?: StartingFrame;
  description: string;
  /** Charge this exact amount instead of the list price — pass 0 to make the
   *  primitive free (e.g. a character sheet generated inside a video). */
  creditsOverride?: number;
}): Promise<number> {
  // Billing FAILS CLOSED: we charge unless billing is *explicitly* disabled.
  //
  // Do NOT infer this from the presence of STRIPE_SECRET_KEY. A worker has no
  // reason to hold a Stripe key, so "no key ⇒ don't charge" silently turns every
  // render free the moment the hosted worker is deployed without it — a direct
  // revenue leak, and one that no test or health check would surface.
  //
  // Self-hosters opt out deliberately with BILLING_MODE=disabled (see
  // isBillingDisabled), and that single switch must be set identically on the API
  // and every worker.
  if (isBillingDisabled()) return 0;

  const credits = args.creditsOverride ?? quotePrimitiveCredits(args.primitive, args.duration, args.frame);
  // Free primitive (portrait, or a sheet inside a video): stamp 0 and skip the
  // ledger RPC entirely — there is nothing to charge.
  if (credits <= 0) {
    const { error: stampErr } = await args.db
      .from('primitive_runs')
      .update({ credits_deducted: 0 })
      .eq('id', args.primitiveRunId);
    if (stampErr) console.warn(`[credits] failed to stamp 0 credits_deducted: ${stampErr.message}`);
    return 0;
  }
  const { error } = await args.db.rpc('deduct_credits', {
    p_user_id: args.userId,
    p_amount: credits,
    p_job_id: args.primitiveRunId,
    p_description: args.description,
  });
  if (error) {
    const msg = error.message || '';
    // USER_NOT_FOUND = the user has no user_credits row at all. That is a
    // permanent condition (an onboarding gap), not a transient fault, so it
    // must be non-retryable — otherwise Temporal retries the activity forever
    // against a row that will never appear, killing the render and spamming
    // Sentry. Treat "no row" as zero balance => INSUFFICIENT_CREDITS. (2026-06-12)
    if (/insufficient/i.test(msg) || /balance/i.test(msg) || /USER_NOT_FOUND/i.test(msg)) {
      throw ApplicationFailure.nonRetryable(
        `insufficient credits: needed ${credits}, ${msg}`,
        'INSUFFICIENT_CREDITS',
      );
    }
    throw new Error(`deduct_credits failed: ${msg}`);
  }
  // Stamp credits_deducted on the primitive_runs row.
  const { error: stampErr } = await args.db
    .from('primitive_runs')
    .update({ credits_deducted: credits })
    .eq('id', args.primitiveRunId);
  if (stampErr) {
    // Non-fatal: ledger is already authoritative via credit_transactions.
    // Log via re-throw only if it's a connectivity issue.
    console.warn(`[credits] failed to stamp credits_deducted: ${stampErr.message}`);
  }
  return credits;
}

/**
 * Refund whatever credits were deducted against this primitive_run.
 * Safe to call multiple times (refund_credits guards against double-refund).
 */
export async function refundPrimitiveCredits(
  db: SupabaseClient,
  primitiveRunId: string,
): Promise<void> {
  const { error } = await db.rpc('refund_credits', { p_job_id: primitiveRunId });
  if (error) {
    console.warn(`[credits] refund failed for ${primitiveRunId}: ${error.message}`);
  }
}
