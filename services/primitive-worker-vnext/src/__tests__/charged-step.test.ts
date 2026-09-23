// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// runChargedStep — the bookkeeping shared by every charged Preset render step
// (presetStartingFrame, presetClip): a succeeded step is returned, never re-made
// or re-charged; references off our R2 and a blown day cap are refused before
// any row or charge; otherwise the row is written, then charged, then the work
// runs, and a non-retryable failure refunds.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ApplicationFailure } from '@temporalio/activity';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runChargedStep, type ChargedStep } from '../activities/charged-step.js';

const R2 = 'https://pub.r2.test';
const cfg = { r2: { publicUrl: `${R2}/` }, caps: { dayUsd: 10 } } as ChargedStep<unknown>['cfg'];

/** A just-enough Supabase fake: records what the step did, in order. */
function fakeDb(opts: { existing?: Record<string, unknown> | null; dayUsed?: number } = {}) {
  const log: string[] = [];
  const rows: Array<Record<string, unknown>> = [];
  const query = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    Object.assign(q, {
      select: chain,
      eq: chain,
      gte: chain,
      not: chain,
      update: (patch: Record<string, unknown>) => {
        log.push(`update:${table}:${Object.keys(patch).join(',')}`);
        return q;
      },
      maybeSingle: async () => ({ data: opts.existing ?? null, error: null }),
      upsert: async (row: Record<string, unknown>) => {
        log.push(`upsert:${table}`);
        rows.push(row);
        return { error: null };
      },
      then: (resolve: (v: unknown) => unknown) =>
        resolve({ data: opts.dayUsed ? [{ actual_credits_usd: opts.dayUsed }] : [], error: null }),
    });
    return q;
  };
  const db = {
    from: (table: string) => query(table),
    rpc: async (name: string) => {
      log.push(`rpc:${name}`);
      return { error: null };
    },
  } as unknown as SupabaseClient;
  return { db, log, rows };
}

function step(db: SupabaseClient, over: Partial<ChargedStep<string>> = {}): ChargedStep<string> {
  return {
    cfg,
    db,
    primitiveRunId: 'run-1',
    userId: 'user-1',
    skillRunId: 'skill-1',
    primitiveId: 'product_hero_clip',
    r2Refs: [['start_image_url', `${R2}/frame.png`]],
    estimatedUsd: 0.6,
    rowInput: { shot_index: 0 },
    charge: { primitive: 'product_hero_clip', duration: 5, description: 'clip 1/2 5s' },
    replay: (prior) => `replayed ${prior.url} $${prior.actualUsd}`,
    work: async () => 'made',
    ...over,
  };
}

afterEach(() => vi.unstubAllEnvs());

describe('runChargedStep', () => {
  it('writes the row, charges, then runs the work', async () => {
    const { db, log, rows } = fakeDb();
    const work = vi.fn(async () => {
      log.push('work');
      return 'made';
    });
    await expect(runChargedStep(step(db, { work }))).resolves.toBe('made');
    expect(log).toEqual(['upsert:primitive_runs', 'rpc:deduct_credits', 'update:primitive_runs:credits_deducted', 'work']);
    expect(rows[0]).toMatchObject({
      id: 'run-1',
      user_id: 'user-1',
      skill_run_id: 'skill-1',
      primitive_id: 'product_hero_clip',
      status: 'submitted',
      input: { shot_index: 0 },
      estimated_credits_usd: 0.6,
    });
  });

  it('returns a step that already succeeded without re-making or re-charging it', async () => {
    const { db, log } = fakeDb({
      existing: { status: 'succeeded', actual_credits_usd: 0.6, primitive_artifacts: [{ id: 'a1', url: `${R2}/clip.mp4` }] },
    });
    const work = vi.fn(async () => 'made');
    await expect(runChargedStep(step(db, { work }))).resolves.toBe(`replayed ${R2}/clip.mp4 $0.6`);
    expect(work).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });

  it('refuses a reference off our R2 before any row or charge', async () => {
    const { db, log } = fakeDb();
    await expect(
      runChargedStep(step(db, { r2Refs: [['start_image_url', `${R2}/ok.png`], ['character_image_url', 'https://evil.test/x.png']] })),
    ).rejects.toMatchObject({ type: 'REFERENCE_URL_NOT_ALLOWED', nonRetryable: true, message: expect.stringContaining('character_image_url') });
    expect(log).toEqual([]);
  });

  it('refuses a step over the day cap before any row or charge', async () => {
    const { db, log } = fakeDb({ dayUsed: 9.8 });
    await expect(runChargedStep(step(db))).rejects.toMatchObject({ type: 'BUDGET_CAP_DAY', nonRetryable: true });
    expect(log).toEqual([]);
  });

  it('refunds on a non-retryable failure, and not on a retryable one', async () => {
    const hard = fakeDb();
    const refused = ApplicationFailure.nonRetryable('provider refused', 'EVOLINK_400');
    await expect(runChargedStep(step(hard.db, { work: async () => { throw refused; } }))).rejects.toBe(refused);
    expect(hard.log.at(-1)).toBe('rpc:refund_credits');

    const soft = fakeDb();
    await expect(runChargedStep(step(soft.db, { work: async () => { throw new Error('timeout'); } }))).rejects.toThrow('timeout');
    expect(soft.log).not.toContain('rpc:refund_credits');
  });
});
