// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// make_product_hero — rendering an approved Product Hero draft through the API.
//
// Driven through the real quote, run and cancel routes. Only the edges are
// faked: the database (an in-memory stand-in for the tables these routes touch),
// photo re-hosting, and Temporal. What must hold: the schema (9:16 fixed,
// exactly one product photo); the registry entry (composed, agent-facing, own
// workflow); the quote is the charge for representative durations; a draft that
// is not the caller's, being rendered, already rendered, or outside 5–15 s is
// refused before anything is spent; a render that never started, failed or was
// canceled leaves the draft renderable again; and an Idempotency-Key replay
// returns the original run.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { planProductHeroShots, PRODUCT_HERO, VIDEO_CLIP_CREDITS } from '@agentmedia/schema';

// ── In-memory tables behind a supabase-shaped client ────────────────────────

type Row = Record<string, unknown>;
const TABLES: Record<string, Row[]> = {};
/** Test hooks: fail a table's inserts, or run something just before an update
 *  applies (to stage a concurrent writer). */
const HOOKS: { failInsert?: string; beforeUpdate?: (table: string) => void } = {};
let rowSeq = 0;

function query(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let inserted: Row | null = null;
  let removing = false;
  const rows = () => (TABLES[table] ??= []);
  const run = (): { data: Row[]; error: { code?: string; message: string } | null } => {
    if (inserted) {
      if (HOOKS.failInsert === table) return { data: [], error: { message: `${table} insert refused` } };
      const row: Row = { id: `00000000-0000-4000-8000-${String(++rowSeq).padStart(12, '0')}`, ...inserted };
      // The partial unique index on skill_runs (user, slug, Idempotency-Key).
      if (
        table === 'skill_runs' &&
        row.idempotency_key &&
        rows().some((r) => r.user_id === row.user_id && r.skill_slug === row.skill_slug && r.idempotency_key === row.idempotency_key)
      ) {
        return { data: [], error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }
      rows().push(row);
      return { data: [row], error: null };
    }
    if (patch) HOOKS.beforeUpdate?.(table);
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
    then: (ok: (v: ReturnType<typeof run>) => unknown, fail?: (e: unknown) => unknown) =>
      Promise.resolve(run()).then(ok, fail),
  };
  return qb;
}

vi.mock('../server.js', () => ({ supabase: { from: (t: string) => query(t) } }));

const uploads: string[] = [];
vi.mock('../lib/r2-upload.js', () => ({
  uploadUserImageFromUrl: async (_u: string, url: string) => (uploads.push(url), { url: 'https://r2.test/u/product.png' }),
  uploadUserImageBase64: async () => (uploads.push('base64'), { url: 'https://r2.test/u/product.png' }),
  uploadUserVideoFromUrl: async () => ({ url: 'https://r2.test/u/v.mp4' }),
}));

const started: Array<{ type: string; opts: { workflowId: string; args: unknown[] } }> = [];
const terminated: string[] = [];
const TEMPORAL: { startFails?: boolean } = {};
vi.mock('../orchestrator/temporal/client.js', () => ({
  getTemporalClient: async () => ({
    workflow: {
      start: async (type: string, opts: { workflowId: string; args: unknown[] }) => {
        if (TEMPORAL.startFails) throw new Error('temporal unreachable');
        started.push({ type, opts });
        return {};
      },
      getHandle: (id: string) => ({ terminate: async () => void terminated.push(id) }),
    },
  }),
}));

const { quoteSkillRoute, runSkillRoute, cancelSkillRunRoute } = await import('../routes/v1/skills.js');
const { SKILLS, MakeProductHeroSkillInputSchema } = await import('../skills/registry.js');
const { quoteSkillCredits } = await import('../skills/credit-quotes.js');

// ── Helpers ─────────────────────────────────────────────────────────────────

const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const STRANGER = 'bbbbbbbb-0000-4000-8000-000000000002';
let draftSeq = 0;

const APPROVED_VOICE = 'ffffffff-0000-4000-8000-000000000001';

function seedVoice(over: Partial<Row> = {}): string {
  const id = `ffffffff-0000-4000-8000-${String(++rowSeq).padStart(12, '0')}`;
  (TABLES.voices ??= []).push({ id, dialect: 'levantine', state: 'approved', ...over });
  return id;
}

function seedDraft(over: Partial<Row> = {}): string {
  if (!TABLES.voices?.some((v) => v.id === APPROVED_VOICE)) {
    (TABLES.voices ??= []).push({ id: APPROVED_VOICE, dialect: 'levantine', state: 'approved' });
  }
  const id = `dddddddd-0000-4000-8000-${String(++draftSeq).padStart(12, '0')}`;
  (TABLES.short_drafts ??= []).push({
    id,
    user_id: OWNER,
    preset: 'product_hero',
    dialect: 'levantine',
    audio_key: `vnext/drafts/${OWNER}/${id}.mp3`,
    duration_ms: 9_000,
    voice_catalog_id: APPROVED_VOICE,
    render_started_at: null,
    render_run_id: null,
    ...over,
  });
  return id;
}

/** A skill run of the owner's in `status`, holding the claim on `draftId`. */
function seedRenderRun(draftId: string, status: string): string {
  const id = `eeeeeeee-0000-4000-8000-${String(++rowSeq).padStart(12, '0')}`;
  (TABLES.skill_runs ??= []).push({ id, user_id: OWNER, skill_slug: 'make_product_hero', status, input: { draft_id: draftId, duration_ms: 9_000 } });
  Object.assign(draft(draftId), { render_run_id: id, render_started_at: '2026-09-01T00:00:00Z' });
  return id;
}

function draft(id: string): Row {
  return TABLES.short_drafts.find((d) => d.id === id)!;
}

async function call(
  route: (req: Request, res: Response) => Promise<void>,
  userId: string,
  body: Record<string, unknown>,
  opts: { slug?: string; headers?: Record<string, string>; params?: Record<string, string> } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const out = { status: 0, body: {} as Record<string, unknown> };
  const headers = Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const req = {
    userId,
    params: opts.params ?? { slug: opts.slug ?? 'make_product_hero' },
    body,
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  const res = {
    status(code: number) { out.status = code; return this; },
    json(payload: Record<string, unknown>) { out.body = payload; return this; },
  } as unknown as Response;
  await route(req, res);
  return out;
}

const PHOTO = 'https://cdn.example.com/bottle.jpg';

beforeEach(() => {
  for (const k of Object.keys(TABLES)) delete TABLES[k];
  delete HOOKS.failInsert;
  delete HOOKS.beforeUpdate;
  delete TEMPORAL.startFails;
  uploads.length = 0;
  started.length = 0;
  terminated.length = 0;
  process.env.BILLING_MODE = 'disabled';
  process.env.TEMPORAL_ADDRESS = 'temporal.test:7233';
  process.env.TEMPORAL_NAMESPACE = 'test';
});

afterEach(() => {
  delete process.env.BILLING_MODE;
});

// ── Schema + registry ───────────────────────────────────────────────────────

describe('make_product_hero skill', () => {
  it('is registered as a composed, agent-facing skill with its own workflow', () => {
    const s = SKILLS.make_product_hero;
    expect(s.primitive).toBe('composed:make_product_hero');
    expect(s.workflowType).toBe('makeProductHeroWorkflow');
    expect(s.agentFacing).toBe(true);
  });

  it('takes an approved draft and one product photo, and is always 9:16', () => {
    const ok = MakeProductHeroSkillInputSchema.safeParse({ draft_id: seedDraft(), product_image_url: PHOTO });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.aspect_ratio).toBe('9:16');

    const id = seedDraft();
    expect(MakeProductHeroSkillInputSchema.safeParse({ draft_id: id, product_image_url: PHOTO, aspect_ratio: '1:1' }).success).toBe(false);
    expect(MakeProductHeroSkillInputSchema.safeParse({ draft_id: id }).success).toBe(false); // no photo
    expect(
      MakeProductHeroSkillInputSchema.safeParse({ draft_id: id, product_image_url: PHOTO, product_image_base64: 'x'.repeat(80) }).success,
    ).toBe(false); // two photos
    expect(MakeProductHeroSkillInputSchema.safeParse({ draft_id: 'not-a-uuid', product_image_url: PHOTO }).success).toBe(false);
    expect(MakeProductHeroSkillInputSchema.safeParse({ draft_id: id, product_image_url: 'http://insecure.test/p.png' }).success).toBe(false);
  });
});

// ── Quote == charge ─────────────────────────────────────────────────────────

describe('make_product_hero quote/charge parity', () => {
  const clipCharge = (ms: number) =>
    planProductHeroShots(ms).reduce((s, d) => s + VIDEO_CLIP_CREDITS[d], 0);

  it.each([5_000, 6_200, 10_000, 10_001, 13_750, 15_000])(
    'quotes a %i ms draft at exactly what its planned clips are charged',
    async (ms) => {
      process.env.BILLING_MODE = 'enabled';
      const id = seedDraft({ duration_ms: ms });
      const quoted = await call(quoteSkillRoute, OWNER, { draft_id: id, product_image_url: PHOTO });
      expect(quoted.status).toBe(200);
      expect(quoted.body.credits).toBe(clipCharge(ms));
      // The same pricing function the run preflight and in-flight reservation use.
      expect(quoteSkillCredits('make_product_hero', { draft_id: id, duration_ms: ms })).toBe(clipCharge(ms));
    },
  );

  it('never quotes above the Preset’s declared budget', () => {
    for (let ms = 5_000; ms <= 15_000; ms += 500) {
      expect(quoteSkillCredits('make_product_hero', { duration_ms: ms })).toBeLessThanOrEqual(
        PRODUCT_HERO.budget.maxCredits,
      );
    }
  });
});

// ── Dispatch ────────────────────────────────────────────────────────────────

describe('make_product_hero dispatch', () => {
  it('starts the render with the draft’s audio and claims the draft for that run', async () => {
    const id = seedDraft({ duration_ms: 12_400 });
    const r = await call(runSkillRoute, OWNER, { draft_id: id, product_image_url: PHOTO });

    expect(r.status).toBe(202);
    expect(r.body.skill).toBe('make_product_hero');
    expect(started).toHaveLength(1);
    expect(started[0].type).toBe('makeProductHeroWorkflow');
    expect(started[0].opts.workflowId).toBe(`make_product_hero-${r.body.skill_run_id}`);
    expect(started[0].opts.args[0]).toMatchObject({
      skill_run_id: r.body.skill_run_id,
      user_id: OWNER,
      draft_id: id,
      audio_key: `vnext/drafts/${OWNER}/${id}.mp3`,
      duration_ms: 12_400,
      product_image_url: 'https://r2.test/u/product.png', // re-hosted + moderated
      aspect_ratio: '9:16',
    });
    expect(draft(id).render_run_id).toBe(r.body.skill_run_id);
    // The run row carries what the in-flight reservation needs to price it.
    const run = TABLES.skill_runs.find((s) => s.id === r.body.skill_run_id)!;
    expect(run.skill_slug).toBe('make_product_hero');
    expect(quoteSkillCredits('make_product_hero', run.input as Record<string, unknown>)).toBe(420);
    expect(JSON.stringify(run.input)).not.toContain('audio_key');
  });

  it('a caller who cannot afford the render gets a 402 and keeps the draft renderable', async () => {
    process.env.BILLING_MODE = 'enabled';
    (TABLES.user_credits ??= []).push({ user_id: OWNER, monthly_credits_remaining: 100, purchased_balance: 0 });
    const id = seedDraft({ duration_ms: 9_000 });
    const r = await call(runSkillRoute, OWNER, { draft_id: id, product_image_url: PHOTO });
    expect(r.status).toBe(402);
    expect(r.body.needed).toBe(280);
    expect(draft(id).render_run_id).toBeNull();
    expect(started).toHaveLength(0);
  });

  it('refuses a second render while the first is in flight', async () => {
    const id = seedDraft();
    expect((await call(runSkillRoute, OWNER, { draft_id: id, product_image_url: PHOTO })).status).toBe(202);
    const again = await call(runSkillRoute, OWNER, { draft_id: id, product_image_url: PHOTO });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('draft_render_in_flight');
    expect(started).toHaveLength(1);
  });

  it.each([
    ['submitted', 'draft_render_in_flight'],
    ['running', 'draft_render_in_flight'],
    ['succeeded', 'draft_already_rendered'],
  ])('refuses a draft whose render is %s, on quote and run', async (status, code) => {
    const id = seedDraft();
    const holder = seedRenderRun(id, status);
    for (const route of [quoteSkillRoute, runSkillRoute]) {
      const r = await call(route, OWNER, { draft_id: id, product_image_url: PHOTO });
      expect(r.status).toBe(409);
      expect(r.body.error).toBe(code);
    }
    expect(draft(id).render_run_id).toBe(holder);
    expect(started).toHaveLength(0);
    expect(uploads).toHaveLength(0); // refused before touching the photo
  });

  it.each(['failed', 'canceled'])('renders the same draft again after a %s render', async (status) => {
    const id = seedDraft();
    seedRenderRun(id, status); // a claim nobody released
    const quoted = await call(quoteSkillRoute, OWNER, { draft_id: id, product_image_url: PHOTO });
    expect(quoted.status).toBe(200);
    const r = await call(runSkillRoute, OWNER, { draft_id: id, product_image_url: PHOTO });
    expect(r.status).toBe(202);
    expect(draft(id).render_run_id).toBe(r.body.skill_run_id);
    expect(started).toHaveLength(1);
  });

  it('a failed Temporal start fails the run and releases the draft', async () => {
    const id = seedDraft();
    TEMPORAL.startFails = true;
    const r = await call(runSkillRoute, OWNER, { draft_id: id, product_image_url: PHOTO });
    expect(r.status).toBe(502);
    expect(r.body.error).toBe('temporal_dispatch_failed');
    const [run] = TABLES.skill_runs;
    expect(run.status).toBe('failed');
    expect(draft(id).render_run_id).toBeNull();

    delete TEMPORAL.startFails;
    const retry = await call(runSkillRoute, OWNER, { draft_id: id, product_image_url: PHOTO });
    expect(retry.status).toBe(202);
    expect(draft(id).render_run_id).toBe(retry.body.skill_run_id);
  });

  it('a failed skill_runs insert leaves the draft unclaimed', async () => {
    const id = seedDraft();
    HOOKS.failInsert = 'skill_runs';
    const r = await call(runSkillRoute, OWNER, { draft_id: id, product_image_url: PHOTO });
    expect(r.status).toBe(500);
    expect(r.body.error).toBe('skill_run_insert_failed');
    expect(draft(id).render_run_id).toBeNull();
    expect(started).toHaveLength(0);
  });

  it('losing the claim to a concurrent render refuses without leaving a run behind', async () => {
    const id = seedDraft();
    // Another request claims the draft between this one's check and its claim.
    HOOKS.beforeUpdate = (table) => {
      if (table !== 'short_drafts' || draft(id).render_run_id) return;
      delete HOOKS.beforeUpdate;
      seedRenderRun(id, 'running');
    };
    const r = await call(runSkillRoute, OWNER, { draft_id: id, product_image_url: PHOTO });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('draft_render_in_flight');
    expect(TABLES.skill_runs.filter((s) => s.status === 'submitted')).toHaveLength(0);
    expect(started).toHaveLength(0);
  });

  it('an Idempotency-Key replay returns the original run instead of a 409', async () => {
    const id = seedDraft();
    const headers = { 'Idempotency-Key': 'render-once-123' };
    const first = await call(runSkillRoute, OWNER, { draft_id: id, product_image_url: PHOTO }, { headers });
    expect(first.status).toBe(202);
    const replay = await call(runSkillRoute, OWNER, { draft_id: id, product_image_url: PHOTO }, { headers });
    expect(replay.status).toBe(202);
    expect(replay.body).toMatchObject({ skill_run_id: first.body.skill_run_id, draft_id: id, idempotent_replay: true });
    expect(started).toHaveLength(1);
    expect(TABLES.skill_runs).toHaveLength(1);
    // A different key is a new request, refused while the first is in flight.
    const other = await call(runSkillRoute, OWNER, { draft_id: id, product_image_url: PHOTO }, { headers: { 'Idempotency-Key': 'another' } });
    expect(other.status).toBe(409);
  });

  it('canceling a render releases the draft', async () => {
    const id = seedDraft();
    const r = await call(runSkillRoute, OWNER, { draft_id: id, product_image_url: PHOTO });
    const runId = String(r.body.skill_run_id);
    const canceled = await call(cancelSkillRunRoute, OWNER, {}, { params: { skill_run_id: runId } });
    expect(canceled.status).toBe(200);
    expect(canceled.body.status).toBe('canceled');
    expect(terminated).toEqual([`make_product_hero-${runId}`]);
    expect(draft(id).render_run_id).toBeNull();
  });

  it('refuses someone else’s draft as if it did not exist', async () => {
    const id = seedDraft({ user_id: STRANGER });
    for (const route of [quoteSkillRoute, runSkillRoute]) {
      const r = await call(route, OWNER, { draft_id: id, product_image_url: PHOTO });
      expect(r.status).toBe(404);
      expect(r.body.error).toBe('draft_not_found');
    }
    expect(draft(id).render_run_id).toBeNull();
    expect(started).toHaveLength(0);
    expect(uploads).toHaveLength(0); // refused before touching the photo
  });

  it.each([
    ['revoked', () => seedVoice({ state: 'revoked' })],
    ['still pending review', () => seedVoice({ state: 'pending' })],
    ['approved only for another Dialect', () => seedVoice({ dialect: 'gulf' })],
    ['no longer in the catalog', () => 'ffffffff-0000-4000-8000-0000000000ff'],
    ['missing (a draft from before the catalog)', () => null],
  ])('refuses a draft whose Voice is %s, on quote and run', async (_why, voice) => {
    const id = seedDraft({ voice_catalog_id: voice() });
    for (const route of [quoteSkillRoute, runSkillRoute]) {
      const r = await call(route, OWNER, { draft_id: id, product_image_url: PHOTO });
      expect(r.status).toBe(422);
      expect(r.body.error).toBe('voice_not_approved');
      expect(String(r.body.detail)).toMatch(/Re-voice/);
    }
    expect(draft(id).render_run_id).toBeNull();
    expect(started).toHaveLength(0);
    expect(uploads).toHaveLength(0);
  });

  it.each([4_999, 15_001])('refuses a %i ms draft (outside 5–15 s) on quote and run', async (ms) => {
    const id = seedDraft({ duration_ms: ms });
    for (const route of [quoteSkillRoute, runSkillRoute]) {
      const r = await call(route, OWNER, { draft_id: id, product_image_url: PHOTO });
      expect(r.status).toBe(422);
      expect(r.body.error).toBe('draft_out_of_band');
    }
    expect(draft(id).render_run_id).toBeNull();
    expect(started).toHaveLength(0);
  });
});
