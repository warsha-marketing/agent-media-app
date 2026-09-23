// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// make_product_hero × Arabic Captions (#10) through the real quote and run
// routes. Captions are off by default. Turned on, the run hands the workflow
// the draft's stored TTS alignment — the cues are derived from it in the
// worker, never from speech-to-text — and records only the flag on the skill
// run. Captions are free: the quote, the in-flight reservation and the charge
// are the same with them on or off. The toggle is part of the request body, so
// the Idempotency-Key fingerprint covers it. The edges (database, photo
// re-hosting, Temporal) are faked as in make-product-hero-music.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { planProductHeroShots, VIDEO_CLIP_CREDITS } from '@agentmedia/schema';

type Row = Record<string, unknown>;
const TABLES: Record<string, Row[]> = {};
let rowSeq = 0;

function query(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let inserted: Row | null = null;
  let removing = false;
  const rows = () => (TABLES[table] ??= []);
  const run = (): { data: Row[]; error: { code?: string; message: string } | null } => {
    if (inserted) {
      const row: Row = { id: `00000000-0000-4000-8000-${String(++rowSeq).padStart(12, '0')}`, ...inserted };
      rows().push(row);
      return { data: [row], error: null };
    }
    const hit = rows().filter((r) => filters.every((f) => f(r)));
    if (patch) for (const r of hit) Object.assign(r, patch);
    if (removing) TABLES[table] = rows().filter((r) => !hit.includes(r));
    return { data: hit, error: null };
  };
  const qb = {
    select: () => qb,
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), qb),
    is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), qb),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), qb),
    gte: () => qb,
    limit: () => qb,
    order: () => qb,
    update: (p: Row) => ((patch = p), qb),
    insert: (r: Row) => ((inserted = r), qb),
    delete: () => ((removing = true), qb),
    maybeSingle: async () => {
      const r = run();
      return { data: r.data[0] ?? null, error: r.error };
    },
    single: async () => {
      const r = run();
      return r.data[0] ? { data: r.data[0], error: null } : { data: null, error: r.error ?? { message: 'no row' } };
    },
    then: (ok: (v: ReturnType<typeof run>) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, fail),
  };
  return qb;
}

vi.mock('../server.js', () => ({
  supabase: {
    from: (t: string) => query(t),
    auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } },
  },
}));
vi.mock('../lib/r2-upload.js', async (orig) => ({
  publicStorageMessage: (await orig<typeof import('../lib/r2-upload.js')>()).publicStorageMessage,
  uploadUserImageFromUrl: async () => ({ url: 'https://r2.test/u/product.png' }),
  uploadUserImageBase64: async () => ({ url: 'https://r2.test/u/product.png' }),
  uploadUserVideoFromUrl: async () => ({ url: 'https://r2.test/u/v.mp4' }),
}));
const started: Array<{ type: string; opts: { workflowId: string; args: unknown[] } }> = [];
vi.mock('../orchestrator/temporal/client.js', () => ({
  getTemporalClient: async () => ({
    workflow: {
      start: async (type: string, opts: { workflowId: string; args: unknown[] }) => void started.push({ type, opts }),
      getHandle: () => ({ terminate: async () => undefined }),
    },
  }),
}));

const { quoteSkillRoute, runSkillRoute } = await import('../routes/v1/skills.js');
const { MakeProductHeroSkillInputSchema } = await import('../skills/registry.js');
const { quoteSkillCredits } = await import('../skills/credit-quotes.js');

const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const VOICE = 'ffffffff-0000-4000-8000-000000000001';
const PHOTO = 'https://cdn.example.com/bottle.jpg';
let draftSeq = 0;

/** The draft's stored alignment: the voiced Script, Delivery Tags included. */
const SCRIPT = '[softly] برغموت، جِلد ومِسك.';
const ALIGNMENT = {
  characters: [...SCRIPT],
  character_start_times_seconds: [...SCRIPT].map((_, i) => i * 0.3),
  character_end_times_seconds: [...SCRIPT].map((_, i) => (i + 1) * 0.3),
};

function seedDraft(durationMs = 9_000): string {
  if (!TABLES.voices?.some((v) => v.id === VOICE)) (TABLES.voices ??= []).push({ id: VOICE, dialect: 'levantine', state: 'approved' });
  const id = `dddddddd-0000-4000-8000-${String(++draftSeq).padStart(12, '0')}`;
  (TABLES.short_drafts ??= []).push({
    id,
    user_id: OWNER,
    dialect: 'levantine',
    audio_key: `vnext/drafts/${OWNER}/${id}.mp3`,
    duration_ms: durationMs,
    alignment: ALIGNMENT,
    voice_catalog_id: VOICE,
    render_run_id: null,
  });
  return id;
}

async function call(
  route: (req: Request, res: Response) => Promise<void>,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  const out = { status: 0, body: {} as Record<string, unknown> };
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const req = { userId: OWNER, params: { slug: 'make_product_hero' }, body, header: (n: string) => h[n.toLowerCase()] } as unknown as Request;
  const res = {
    status(code: number) { out.status = code; return this; },
    json(payload: Record<string, unknown>) { out.body = payload; return this; },
  } as unknown as Response;
  await route(req, res);
  return out;
}

const workflowInput = () => started.at(-1)!.opts.args[0] as Record<string, unknown>;
const runRow = (id: unknown) => TABLES.skill_runs.find((s) => s.id === id)!;

beforeEach(() => {
  for (const k of Object.keys(TABLES)) delete TABLES[k];
  TABLES.qualified_presets = [{ preset: 'product_hero', dialect: 'levantine', state: 'qualified' }];
  started.length = 0;
  process.env.BILLING_MODE = 'disabled';
  process.env.TEMPORAL_ADDRESS = 'temporal.test:7233';
  process.env.TEMPORAL_NAMESPACE = 'test';
});
afterEach(() => {
  delete process.env.BILLING_MODE;
});

describe('make_product_hero input: Captions', () => {
  it('are off by default, and only a boolean turns them on', () => {
    const base = { draft_id: seedDraft(), product_image_url: PHOTO };
    expect(MakeProductHeroSkillInputSchema.parse(base).captions).toBe(false);
    expect(MakeProductHeroSkillInputSchema.parse({ ...base, captions: true }).captions).toBe(true);
    expect(MakeProductHeroSkillInputSchema.safeParse({ ...base, captions: 'yes' }).success).toBe(false);
  });
});

describe('make_product_hero run: Captions', () => {
  it('off (the default): the workflow gets no captions, and the run records them off', async () => {
    const r = await call(runSkillRoute, { draft_id: seedDraft(), product_image_url: PHOTO });
    expect(r.status).toBe(202);
    expect(workflowInput().captions).toBeNull();
    expect(runRow(r.body.skill_run_id).input).toMatchObject({ captions: false });
    expect(r.body.captions).toMatchObject({ on: false });
  });

  it("on: the workflow gets the draft's stored alignment (Delivery Tags included, stripped in the worker)", async () => {
    const r = await call(runSkillRoute, { draft_id: seedDraft(), product_image_url: PHOTO, captions: true });
    expect(r.status).toBe(202);
    expect(workflowInput().captions).toEqual({ alignment: ALIGNMENT });
    // The run stores the choice, not the alignment.
    const input = runRow(r.body.skill_run_id).input as Record<string, unknown>;
    expect(input).toMatchObject({ captions: true });
    expect(JSON.stringify(input)).not.toContain('character_start_times_seconds');
    expect(r.body.captions).toMatchObject({ on: true });
  });

  it('the quote says whether Captions will be burned', async () => {
    const id = seedDraft();
    expect((await call(quoteSkillRoute, { draft_id: id, product_image_url: PHOTO })).body.captions).toMatchObject({ on: false });
    expect((await call(quoteSkillRoute, { draft_id: id, product_image_url: PHOTO, captions: true })).body.captions).toMatchObject({ on: true });
  });

  it('refuses an Idempotency-Key replayed with Captions toggled (the fingerprint covers them)', async () => {
    const id = seedDraft();
    const headers = { 'Idempotency-Key': 'render-captions-toggle' };
    const first = await call(runSkillRoute, { draft_id: id, product_image_url: PHOTO }, headers);
    expect(first.status).toBe(202);
    const toggled = await call(runSkillRoute, { draft_id: id, product_image_url: PHOTO, captions: true }, headers);
    expect(toggled.status).toBe(409);
    expect(toggled.body).toMatchObject({ error: 'idempotency_key_reused' });
    expect(started).toHaveLength(1);
  });
});

describe('make_product_hero Captions are free: quote == charge, on or off', () => {
  const charged = (ms: number) => planProductHeroShots(ms).reduce((sum, d) => sum + VIDEO_CLIP_CREDITS[d], 0);

  it.each([5_000, 9_000, 12_000, 15_000])('%i ms: the quote, the reservation and the charge match with Captions on and off', async (ms) => {
    process.env.BILLING_MODE = 'enabled';
    (TABLES.user_credits ??= []).push({ user_id: OWNER, monthly_credits_remaining: 10_000, purchased_balance: 0 });
    const off = await call(quoteSkillRoute, { draft_id: seedDraft(ms), product_image_url: PHOTO });
    const id = seedDraft(ms);
    const on = await call(quoteSkillRoute, { draft_id: id, product_image_url: PHOTO, captions: true });
    expect(on.status).toBe(200);
    expect(on.body.credits).toBe(off.body.credits);
    expect(on.body.credits).toBe(charged(ms));

    // The run reserves (and the worker charges) the planned clips — nothing for Captions.
    const r = await call(runSkillRoute, { draft_id: id, product_image_url: PHOTO, captions: true });
    expect(r.status).toBe(202);
    expect(quoteSkillCredits('make_product_hero', runRow(r.body.skill_run_id).input as Record<string, unknown>)).toBe(on.body.credits);
  });
});
