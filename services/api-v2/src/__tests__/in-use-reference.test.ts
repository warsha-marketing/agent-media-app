// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// #31 In-use Reference + Scale Anchors at the API, through the real quote, run
// and shot-plan routes (Hands-on; only the edges faked, as in
// make-hands-on.test.ts): the render reads the draft's Product Profile; the
// In-use Reference step is quoted only when the used state differs from the
// photo and the user kept it ("use original instead" drops it); the stored run
// prices like the quote; the workflow gets the Profile and the override; the
// Shot Plan shows the Scale Anchor and the In-use line on the hands shot only.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { HANDS_ON, IN_USE_REFERENCE_CREDITS, PRODUCT_HERO, quotePresetCredits, type ProductProfile } from '@agentmedia/schema';

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

/** Auth users the operator check reads (ADMIN_EMAILS + a confirmed address). */
const AUTH_USERS: Record<string, { email: string; email_confirmed_at: string | null }> = {};
vi.mock('../server.js', () => ({
  supabase: {
    from: (t: string) => query(t),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: AUTH_USERS[id] ?? null }, error: null }) } },
  },
}));

const uploads: string[] = [];
const UPLOAD: { fails?: string } = {};
vi.mock('../lib/r2-upload.js', async (orig) => ({
  publicStorageMessage: (await orig<typeof import('../lib/r2-upload.js')>()).publicStorageMessage,
  uploadUserImageFromUrl: async (_u: string, url: string) => {
    if (UPLOAD.fails) throw new Error(UPLOAD.fails);
    uploads.push(url);
    return { url: 'https://r2.test/u/product.png' };
  },
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

const { quoteSkillRoute, runSkillRoute } = await import('../routes/v1/skills.js');
const { SKILLS } = await import('../skills/registry.js');
const { shotPlanRoute } = await import('../routes/v1/skills.js');
const { quoteSkillCredits } = await import('../skills/credit-quotes.js');

// ── Helpers ─────────────────────────────────────────────────────────────────

const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
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
    brief: 'An ad for our perfume',
    product_details: null,
    audio_key: `vnext/drafts/${OWNER}/${id}.mp3`,
    duration_ms: 9_000,
    voice_catalog_id: APPROVED_VOICE,
    render_started_at: null,
    render_run_id: null,
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
  opts: { slug?: string; headers?: Record<string, string>; params?: Record<string, string> } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const out = { status: 0, body: {} as Record<string, unknown> };
  const headers = Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const req = {
    userId,
    params: opts.params ?? { slug: opts.slug ?? 'make_hands_on' },
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
  for (const k of Object.keys(AUTH_USERS)) delete AUTH_USERS[k];
  // Hands-on × Levantine is a Qualified Preset here (an operator qualified it after review).
  TABLES.qualified_presets = [
    { preset: 'product_hero', dialect: 'levantine', state: 'qualified' },
    { preset: 'hands_on', dialect: 'levantine', state: 'qualified' },
  ];
  delete UPLOAD.fails;
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

const PERFUME: ProductProfile = {
  category: 'fragrance_oud',
  dimensions: { height_cm: 12, width_cm: null, volume_ml: 100 },
  size_class: 'palm',
  parts: [
    { name: 'silver crown cap', removable: true },
    { name: 'bottle', removable: false },
  ],
  used_state: 'uncapped, short silver spray neck visible',
  differs_from_photo: true,
  interaction_verbs: ['spray'],
  grip: 'held upright in one hand',
  physics_risks: ['separate_cap'],
  confidence: 0.9,
};

const body = (id: string, over: Record<string, unknown> = {}) => ({ draft_id: id, product_image_url: PHOTO, ...over });
const handsDraft = (profile: ProductProfile | null, ms = 12_000) => seedDraft({ preset: 'hands_on', duration_ms: ms, product_profile: profile });

describe('the quote prices the In-use Reference only when the render makes one', () => {
  it.each([
    ['the used state differs', PERFUME, {}, true],
    ['the user chose the original photo', PERFUME, { use_original_product_photo: true }, false],
    ['the used state is the photo’s', { ...PERFUME, differs_from_photo: false }, {}, false],
    ['the draft has no Profile', null, {}, false],
  ] as const)('%s', async (_why, profile, over, made) => {
    process.env.BILLING_MODE = 'enabled';
    const id = handsDraft(profile);
    const q = await call(quoteSkillRoute, OWNER, body(id, over));
    expect(q.status).toBe(200);
    expect(q.body.credits).toBe(quotePresetCredits(HANDS_ON, 12_000, { inUseReference: made }));
    expect(q.body.credits).toBe(quotePresetCredits(HANDS_ON, 12_000) + (made ? IN_USE_REFERENCE_CREDITS : 0));
  });

  it('says what it will show, and that the original can be chosen instead', async () => {
    const id = handsDraft(PERFUME);
    const on = await call(quoteSkillRoute, OWNER, body(id));
    expect(on.body.in_use_reference).toEqual({
      made: true,
      use_original_product_photo: false,
      used_state: PERFUME.used_state,
      removed_parts: ['silver crown cap'],
      credits: IN_USE_REFERENCE_CREDITS,
    });
    const off = await call(quoteSkillRoute, OWNER, body(id, { use_original_product_photo: true }));
    expect(off.body.in_use_reference).toMatchObject({ made: false, use_original_product_photo: true, credits: 0 });
    const none = await call(quoteSkillRoute, OWNER, body(handsDraft({ ...PERFUME, differs_from_photo: false })));
    expect(none.body.in_use_reference).toBeNull();
  });

  it('a body cannot price itself out of the step: the route decides `in_use_reference`', async () => {
    process.env.BILLING_MODE = 'enabled';
    const q = await call(quoteSkillRoute, OWNER, body(handsDraft(PERFUME), { in_use_reference: false }));
    expect(q.body.credits).toBe(quotePresetCredits(HANDS_ON, 12_000, { inUseReference: true }));
  });

  it('a Preset with nobody on screen never quotes one, and takes no override', () => {
    expect(quoteSkillCredits('make_product_hero', { duration_ms: 12_000, in_use_reference: true })).toBe(quotePresetCredits(PRODUCT_HERO, 12_000));
    expect('use_original_product_photo' in (SKILLS.make_product_hero.inputSchema.safeParse(body('00000000-0000-4000-8000-000000000000')) as { data: object }).data).toBe(false);
  });
});

describe('the run', () => {
  it.each([
    [{}, true],
    [{ use_original_product_photo: true }, false],
  ] as const)('stores the step for the reservation and hands the worker the Profile and the override (%o)', async (over, made) => {
    const id = handsDraft(PERFUME, 12_400);
    const r = await call(runSkillRoute, OWNER, body(id, over));
    expect(r.status).toBe(202);
    const run = TABLES.skill_runs.find((s) => s.id === r.body.skill_run_id)!;
    expect((run.input as Row).in_use_reference).toBe(made);
    // The in-flight reservation prices exactly what the quote did.
    expect(quoteSkillCredits('make_hands_on', run.input as Record<string, unknown>)).toBe(
      quotePresetCredits(HANDS_ON, 12_400, { inUseReference: made }),
    );
    const [wf] = started;
    const args = wf.opts.args[0] as Row;
    expect(args.product_profile).toEqual(PERFUME);
    expect(args.use_original_product_photo).toBe(!made);
    expect((r.body.in_use_reference as Row).made).toBe(made);
  });

  it('a draft from before the Profile renders as before: no Profile, no step', async () => {
    const r = await call(runSkillRoute, OWNER, body(handsDraft(null)));
    expect(r.status).toBe(202);
    const args = started[0].opts.args[0] as Row;
    expect(args.product_profile).toBeNull();
    expect((TABLES.skill_runs[0].input as Row).in_use_reference).toBe(false);
  });
});

describe('the Shot Plan shows the lines the worker adds', () => {
  const ids = (s: Row, stage: 'image' | 'video') => ((s.guardrails as Row)[stage] as Array<{ id: string }>).map((g) => g.id);
  it('the hands shot carries the Scale Anchor and the In-use line (both stages); the product closer neither', async () => {
    const r = await call(shotPlanRoute, OWNER, body(handsDraft(PERFUME)));
    expect(r.status).toBe(200);
    const shots = r.body.shots as Row[];
    const hands = shots.find((s) => s.shows === 'hands')!;
    const product = shots.find((s) => s.shows === 'product')!;
    for (const stage of ['image', 'video'] as const) expect(ids(hands, stage)).toEqual(expect.arrayContaining(['in_use_reference', 'scale_anchor']));
    expect(hands.product_reference).toBe('in_use_reference');
    expect((hands.prompt_preview as Row).image).toContain('the In-use Reference');
    expect((hands.prompt_preview as Row).video).toContain('about the height of her palm');
    expect(ids(product, 'video')).not.toContain('scale_anchor');
    expect(product.product_reference).toBe('product_photo');
  });

  it('with the original photo: the Scale Anchor only', async () => {
    const r = await call(shotPlanRoute, OWNER, body(handsDraft(PERFUME), { use_original_product_photo: true }));
    const hands = (r.body.shots as Row[]).find((s) => s.shows === 'hands')!;
    expect(ids(hands, 'video')).toContain('scale_anchor');
    expect(ids(hands, 'video')).not.toContain('in_use_reference');
    expect(hands.product_reference).toBe('product_photo');
  });
});
