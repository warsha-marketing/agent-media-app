// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// make_product_hero — rendering an approved Product Hero draft through the API.
//
// Driven through the real quote and run routes. Only the edges are faked: the
// database (an in-memory stand-in for the two tables these routes touch), photo
// re-hosting, and Temporal. What must hold: the schema (9:16 fixed, exactly one
// product photo); the registry entry (composed, agent-facing, own workflow); the
// quote is the charge for representative durations; and a draft that is not the
// caller's, already rendered, or outside 5–15 s is refused before anything is
// spent — and a draft renders at most once.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { planProductHeroShots, PRODUCT_HERO } from '@agentmedia/schema';

// ── In-memory tables behind a supabase-shaped client ────────────────────────

type Row = Record<string, unknown>;
const TABLES: Record<string, Row[]> = {};

function query(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let inserted: Row | null = null;
  const rows = () => (TABLES[table] ??= []);
  const run = (): Row[] => {
    if (inserted) {
      const row = { id: `00000000-0000-4000-8000-${String(rows().length + 1).padStart(12, '0')}`, ...inserted };
      rows().push(row);
      return [row];
    }
    const hit = rows().filter((r) => filters.every((f) => f(r)));
    if (patch) for (const r of hit) Object.assign(r, patch);
    return hit;
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
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    single: async () => {
      const [r] = run();
      return r ? { data: r, error: null } : { data: null, error: { message: 'no row' } };
    },
    then: (ok: (v: { data: Row[]; error: null }) => unknown, fail?: (e: unknown) => unknown) =>
      Promise.resolve({ data: run(), error: null }).then(ok, fail),
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
vi.mock('../orchestrator/temporal/client.js', () => ({
  getTemporalClient: async () => ({
    workflow: {
      start: async (type: string, opts: { workflowId: string; args: unknown[] }) => {
        started.push({ type, opts });
        return {};
      },
    },
  }),
}));

const { quoteSkillRoute, runSkillRoute } = await import('../routes/v1/skills.js');
const { SKILLS, MakeProductHeroSkillInputSchema } = await import('../skills/registry.js');
const { quoteSkillCredits } = await import('../skills/credit-quotes.js');

// ── Helpers ─────────────────────────────────────────────────────────────────

const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const STRANGER = 'bbbbbbbb-0000-4000-8000-000000000002';
let draftSeq = 0;

function seedDraft(over: Partial<Row> = {}): string {
  const id = `dddddddd-0000-4000-8000-${String(++draftSeq).padStart(12, '0')}`;
  (TABLES.short_drafts ??= []).push({
    id,
    user_id: OWNER,
    preset: 'product_hero',
    dialect: 'levantine',
    audio_key: `vnext/drafts/${OWNER}/${id}.mp3`,
    duration_ms: 9_000,
    rendered_at: null,
    ...over,
  });
  return id;
}

function draft(id: string): Row {
  return TABLES.short_drafts.find((d) => d.id === id)!;
}

async function call(
  route: (req: Request, res: Response) => Promise<void>,
  userId: string,
  body: Record<string, unknown>,
  slug = 'make_product_hero',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const out = { status: 0, body: {} as Record<string, unknown> };
  const req = { userId, params: { slug }, body, header: () => undefined } as unknown as Request;
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
  uploads.length = 0;
  started.length = 0;
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
    planProductHeroShots(ms).reduce((s, d) => s + PRODUCT_HERO.budget.clipCredits[d], 0);

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
        SKILLS.make_product_hero.costBudget!.maxCredits,
      );
    }
  });
});

// ── Dispatch ────────────────────────────────────────────────────────────────

describe('make_product_hero dispatch', () => {
  it('starts the render with the draft’s audio and stamps the draft rendered', async () => {
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
    expect(draft(id).rendered_at).toEqual(expect.any(String));
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
    expect(draft(id).rendered_at).toBeNull();
    expect(started).toHaveLength(0);
  });

  it('renders a draft at most once', async () => {
    const id = seedDraft();
    expect((await call(runSkillRoute, OWNER, { draft_id: id, product_image_url: PHOTO })).status).toBe(202);
    const again = await call(runSkillRoute, OWNER, { draft_id: id, product_image_url: PHOTO });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('draft_already_rendered');
    expect(started).toHaveLength(1);
  });

  it('refuses someone else’s draft as if it did not exist', async () => {
    const id = seedDraft({ user_id: STRANGER });
    for (const route of [quoteSkillRoute, runSkillRoute]) {
      const r = await call(route, OWNER, { draft_id: id, product_image_url: PHOTO });
      expect(r.status).toBe(404);
      expect(r.body.error).toBe('draft_not_found');
    }
    expect(draft(id).rendered_at).toBeNull();
    expect(started).toHaveLength(0);
    expect(uploads).toHaveLength(0); // refused before touching the photo
  });

  it('refuses an already-rendered draft on quote and run', async () => {
    const id = seedDraft({ rendered_at: '2026-09-01T00:00:00Z' });
    for (const route of [quoteSkillRoute, runSkillRoute]) {
      const r = await call(route, OWNER, { draft_id: id, product_image_url: PHOTO });
      expect(r.status).toBe(409);
      expect(r.body.error).toBe('draft_already_rendered');
    }
    expect(started).toHaveLength(0);
  });

  it.each([4_999, 15_001])('refuses a %i ms draft (outside 5–15 s) on quote and run', async (ms) => {
    const id = seedDraft({ duration_ms: ms });
    for (const route of [quoteSkillRoute, runSkillRoute]) {
      const r = await call(route, OWNER, { draft_id: id, product_image_url: PHOTO });
      expect(r.status).toBe(422);
      expect(r.body.error).toBe('draft_out_of_band');
    }
    expect(draft(id).rendered_at).toBeNull();
    expect(started).toHaveLength(0);
  });
});
