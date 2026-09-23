// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * What a skill run charged and what came back, read from the credit ledger.
 *
 * Every charge a vNext run makes is a `deduct_credits(p_job_id = primitive run
 * id)` call, recorded as `credit_transactions` rows of type `generation_debit`
 * (negative, one per bucket) with `reference_id` = the primitive run. A refund
 * (`refund_credits`, from the workflow's compensation or cancel) writes
 * `generation_refund` rows against the same reference. So the ledger rows of a
 * run's primitive runs are the truth; `primitive_runs.credits_deducted` is only
 * a best-effort stamp.
 */

export type RefundStatus =
  /** Nothing is owed back: nothing was charged, or the run delivered / is still running. */
  | 'not_due'
  /** The run failed or was canceled and part of its charge has not been refunded yet. */
  | 'pending'
  /** The run failed or was canceled and every credit it charged was refunded. */
  | 'refunded';

export interface RunCredits {
  charged: number;
  refunded: number;
  refund_status: RefundStatus;
}

export interface LedgerRow {
  type: string;
  amount: number | string | null;
}

const UNDELIVERED = new Set(['failed', 'canceled', 'cancelled']);

export function summarizeRunCredits(runStatus: string, ledger: readonly LedgerRow[]): RunCredits {
  let charged = 0;
  let refunded = 0;
  for (const row of ledger) {
    const amount = Math.abs(Number(row.amount ?? 0));
    if (!Number.isFinite(amount)) continue;
    if (row.type === 'generation_debit') charged += amount;
    else if (row.type === 'generation_refund') refunded += amount;
  }
  let refund_status: RefundStatus = 'not_due';
  if (UNDELIVERED.has(runStatus) && charged > 0) refund_status = refunded >= charged ? 'refunded' : 'pending';
  return { charged, refunded, refund_status };
}

/** OpenAPI schema for the `credits` field of a run status. */
export const RUN_CREDITS_OPENAPI = {
  type: ['object', 'null'],
  description:
    'Credits this run charged and refunded, from the credit ledger. null if the ledger could not be read.',
  properties: {
    charged: { type: 'integer', description: 'Credits deducted for this run (0 if nothing was charged).' },
    refunded: { type: 'integer', description: 'Credits returned to the balance for this run.' },
    refund_status: {
      type: 'string',
      enum: ['not_due', 'pending', 'refunded'],
      description:
        '`not_due`: nothing charged, or the run delivered / is still running. `pending`: the run failed or was canceled and not all of its charge is back yet. `refunded`: the run failed or was canceled and every charged credit was refunded.',
    },
  },
  required: ['charged', 'refunded', 'refund_status'],
} as const;
