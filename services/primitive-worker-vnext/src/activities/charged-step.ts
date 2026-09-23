// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * One charged step of a Preset render (a starting frame, a clip): the
 * bookkeeping every such activity does around its provider call, in order.
 *
 *   1. retry short-circuit — a step whose primitive_runs row already succeeded
 *      is returned from its first artifact, never made (or paid for) twice;
 *   2. SSRF guard — every reference image must be on our R2 public URL;
 *   3. day cap — the user's spend today plus this step's estimate stays under
 *      cfg.caps.dayUsd (the per-primitive cap does not apply: the Preset's
 *      declared budget governs the render);
 *   4. upsert the step's primitive_runs row (submitted);
 *   5. deduct its credits (the same price table api-v2 quotes from);
 *   6. run the work — and refund here on a non-retryable failure (the workflow
 *      also refunds every charged child on any terminal failure; idempotent).
 *
 * The activity keeps its own input checks (before 1) and its own provider
 * call, upload and artifact/finalize writes (the work).
 */

import { ApplicationFailure } from '@temporalio/activity';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkerConfig } from '../config.js';
import { deductPrimitiveCredits, refundPrimitiveCredits } from '../client/credits.js';

/** A step that already succeeded: its first artifact and what it cost. */
export interface PriorStep {
  url: string;
  actualUsd: number;
}

export interface ChargedStep<T> {
  cfg: Pick<WorkerConfig, 'r2' | 'caps'>;
  db: SupabaseClient;
  primitiveRunId: string;
  userId: string;
  skillRunId: string;
  /** primitive_runs.primitive_id of the row. */
  primitiveId: string;
  /** Reference images the step reads, by input field name (only those given). */
  r2Refs: ReadonlyArray<readonly [field: string, url: string]>;
  /** Our provider-cost estimate for the step (USD): the day cap and the row. */
  estimatedUsd: number;
  /** The row's `input` record. */
  rowInput: Record<string, unknown>;
  /** What deductPrimitiveCredits charges (the price table api-v2 quotes from). */
  charge: Omit<Parameters<typeof deductPrimitiveCredits>[0], 'db' | 'userId' | 'primitiveRunId'>;
  /** The result for a step that already succeeded (1). */
  replay: (prior: PriorStep) => T;
  /** The provider call and its writes (6). */
  work: () => Promise<T>;
}

export async function runChargedStep<T>(step: ChargedStep<T>): Promise<T> {
  const { cfg, db } = step;

  // 1. Retry-safety: a step that already succeeded is returned, not re-made.
  const { data: existing, error: existingErr } = await db
    .from('primitive_runs')
    .select('status, actual_credits_usd, primitive_artifacts(id, url)')
    .eq('id', step.primitiveRunId)
    .maybeSingle();
  if (existingErr) throw new Error(`primitive_runs lookup failed: ${existingErr.message}`);
  if (existing && existing.status === 'succeeded') {
    const art = (existing.primitive_artifacts as Array<{ id: string; url: string }> | null)?.[0];
    if (!art) throw new Error(`inconsistent state: primitive_run ${step.primitiveRunId} succeeded without an artifact`);
    return step.replay({ url: art.url, actualUsd: Number(existing.actual_credits_usd ?? 0) });
  }

  // 2. SSRF guard — every reference must be on our R2.
  const allowedPrefix = cfg.r2.publicUrl.replace(/\/+$/, '') + '/';
  for (const [field, url] of step.r2Refs) {
    if (typeof url !== 'string' || !url.startsWith(allowedPrefix)) {
      throw ApplicationFailure.nonRetryable(
        `${field} must be hosted on the configured R2 public URL (${allowedPrefix})`,
        'REFERENCE_URL_NOT_ALLOWED',
      );
    }
  }

  // 3. The day cap.
  const estimatedUsd = step.estimatedUsd;
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { data: dayRows, error: dayErr } = await db
    .from('primitive_runs')
    .select('actual_credits_usd')
    .eq('user_id', step.userId)
    .gte('created_at', since.toISOString())
    .not('actual_credits_usd', 'is', null);
  if (dayErr) throw new Error(`day-cap query failed: ${dayErr.message}`);
  const dayUsed = (dayRows ?? []).reduce((s, r) => s + Number(r.actual_credits_usd ?? 0), 0);
  if (dayUsed + estimatedUsd > cfg.caps.dayUsd) {
    throw ApplicationFailure.nonRetryable(
      `day budget exceeded: used $${dayUsed.toFixed(2)} + estimate $${estimatedUsd} > cap $${cfg.caps.dayUsd}`,
      'BUDGET_CAP_DAY',
    );
  }

  // 4. The step's row.
  const { error: upsertErr } = await db.from('primitive_runs').upsert(
    {
      id: step.primitiveRunId,
      user_id: step.userId,
      skill_run_id: step.skillRunId,
      primitive_id: step.primitiveId,
      status: 'submitted',
      input: step.rowInput,
      estimated_credits_usd: estimatedUsd,
      started_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (upsertErr) throw new Error(`primitive_runs upsert failed: ${upsertErr.message}`);

  // 5. Charge.
  await deductPrimitiveCredits({ db, userId: step.userId, primitiveRunId: step.primitiveRunId, ...step.charge });

  // 6. The work; a non-retryable failure refunds here.
  try {
    return await step.work();
  } catch (err) {
    if (err instanceof ApplicationFailure && err.nonRetryable) {
      await refundPrimitiveCredits(db, step.primitiveRunId);
    }
    throw err;
  }
}
