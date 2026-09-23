// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// make_hands_on (#18) — rendering an approved draft as a Hands-on Short through
// the API. Driven through the real quote and run routes; only the edges are
// faked (an in-memory database, photo re-hosting, Temporal), as in
// make-product-hero.test.ts. What must hold: the schema (hand gender male or
// female only, a setting from the list, the Modesty choice); the defaults come
// from the draft's Product Details; the Modesty Default is resolved at the route
// and refused with its own code; the quote is the charge, including the image
// step; an unqualified Hands-on × Dialect pair is refused (operators sample).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { HANDS_ON, STARTING_FRAME_CREDITS, VIDEO_CLIP_CREDITS, planPresetShots } from '@agentmedia/schema';

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
const { MakeHandsOnSkillInputSchema, pickHandsOnDefaults } = await import('../skills/hands-on.js');
const { skillRouteOpenApi } = await import('../routes/v1/skills-openapi.js');
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

// ── Schema + registry ───────────────────────────────────────────────────────

const body = (id: string, over: Record<string, unknown> = {}) => ({ draft_id: id, product_image_url: PHOTO, ...over });

describe('make_hands_on skill', () => {
  it('is registered as a composed, agent-facing skill with its own workflow and the Hands-on Preset', () => {
    const s = SKILLS.make_hands_on;
    expect(s.primitive).toBe('composed:make_hands_on');
    expect(s.workflowType).toBe('makeHandsOnWorkflow');
    expect(s.agentFacing).toBe(true);
    expect(s.preset).toBe(HANDS_ON);
  });

  it('takes male or female hands only', () => {
    const id = seedDraft();
    for (const g of ['female', 'male']) expect(MakeHandsOnSkillInputSchema.safeParse(body(id, { hand_gender: g })).success).toBe(true);
    for (const g of ['neutral', 'other', 'FEMALE', '', 1]) {
      expect(MakeHandsOnSkillInputSchema.safeParse(body(id, { hand_gender: g })).success, String(g)).toBe(false);
    }
  });

  it('takes a setting from the list only', () => {
    const id = seedDraft();
    for (const s of ['dressing_table', 'car', 'majlis', 'kitchen', 'desk', 'outdoors']) {
      expect(MakeHandsOnSkillInputSchema.safeParse(body(id, { setting: s })).success, s).toBe(true);
    }
    for (const s of ['beach', 'office', 'Kitchen', '']) {
      expect(MakeHandsOnSkillInputSchema.safeParse(body(id, { setting: s })).success, s).toBe(false);
    }
  });

  it('takes the Modesty choice (arms and hijab only), one photo, and is always 9:16', () => {
    const id = seedDraft();
    const ok = MakeHandsOnSkillInputSchema.safeParse(body(id, { modesty: { arms: 'sleeved' } }));
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.aspect_ratio).toBe('9:16');
    expect(MakeHandsOnSkillInputSchema.safeParse(body(id, { modesty: { arms: 'bare' } })).success).toBe(false);
    expect(MakeHandsOnSkillInputSchema.safeParse(body(id, { modesty: { neckline: 'low' } })).success).toBe(false);
    expect(MakeHandsOnSkillInputSchema.safeParse(body(id, { aspect_ratio: '1:1' })).success).toBe(false);
    expect(MakeHandsOnSkillInputSchema.safeParse({ draft_id: id }).success).toBe(false);
    expect(MakeHandsOnSkillInputSchema.safeParse(body(id, { product_image_base64: 'x'.repeat(80) })).success).toBe(false);
    // Unknown fields are dropped, never passed on: the workflow input names no prompt.
    const extra = MakeHandsOnSkillInputSchema.safeParse(body(id, { prompt: 'hands holding it' }));
    expect(extra.success && 'prompt' in extra.data).toBe(false);
  });

  it('refuses a less modest arms choice at the route (400 invalid_input: bare is not a level)', async () => {
    const r = await call(quoteSkillRoute, OWNER, body(seedDraft(), { modesty: { arms: 'bare' } }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_input');
  });

  it('refuses `captions` like every Preset render (400 captions_moved)', async () => {
    const r = await call(quoteSkillRoute, OWNER, body(seedDraft(), { captions: false }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('captions_moved');
  });
});

// ── Defaults from the Product Details ───────────────────────────────────────

describe('Hands-on defaults come from the Product Details', () => {
  it.each([
    ['عطر نسائي بنفحات الورد والمسك', 'dressing_table', 'female'],
    ['Eau de parfum for women, rose and musk', 'dressing_table', 'female'],
    ['Specialty coffee beans, medium roast', 'kitchen', 'female'],
    ['بخور فاخر للمجلس', 'majlis', 'male'],
    ['Arabic coffee with cardamom', 'majlis', 'male'],
    ['معطر سيارة برائحة العود', 'car', 'male'],
    ['Wireless headphones with noise cancelling', 'desk', 'male'],
    ['Sunscreen SPF 50 for the beach', 'outdoors', 'male'],
    ['Beard oil for men with sandalwood', 'dressing_table', 'male'],
    ['زيت لحية رجالي', 'dressing_table', 'male'],
  ])('%s → %s, %s hands', (details, setting, gender) => {
    expect(pickHandsOnDefaults({ product_details: details, brief: null })).toEqual({ setting, hand_gender: gender });
  });

  it('reads the Brief when there are no Product Details, and falls back to a desk', () => {
    expect(pickHandsOnDefaults({ product_details: null, brief: 'An ad for our new lipstick' })).toEqual({ setting: 'dressing_table', hand_gender: 'female' });
    expect(pickHandsOnDefaults({ product_details: null, brief: 'Something great' })).toEqual({ setting: 'desk', hand_gender: 'male' });
  });

  it('matches whole words, not letters inside another word', () => {
    // "women" contains "men"; "carpet" contains "car"; "stream" contains "tea".
    expect(pickHandsOnDefaults({ product_details: 'A carpet for women', brief: null }).hand_gender).toBe('female');
    expect(pickHandsOnDefaults({ product_details: 'A mainstream carpet', brief: null }).setting).toBe('desk');
  });

  it('the quote shows the defaults it picked, from the draft', async () => {
    const id = seedDraft({ product_details: 'قهوة مختصة محمصة', brief: 'اعلان' });
    const r = await call(quoteSkillRoute, OWNER, body(id));
    expect(r.status).toBe(200);
    expect(r.body.preset_inputs).toEqual({
      hand_gender: 'female',
      setting: 'kitchen',
      modesty: { arms: 'covered', hijab: false },
      source: { hand_gender: 'product_details', setting: 'product_details' },
    });
  });

  it('the user’s choice overrides both defaults, and the run renders exactly what the quote showed', async () => {
    const id = seedDraft({ product_details: 'Perfume for women' });
    const choice = body(id, { hand_gender: 'male', setting: 'car' });
    const q = await call(quoteSkillRoute, OWNER, choice);
    expect(q.body.preset_inputs).toMatchObject({ hand_gender: 'male', setting: 'car', source: { hand_gender: 'user', setting: 'user' } });

    const r = await call(runSkillRoute, OWNER, choice);
    expect(r.status).toBe(202);
    expect(r.body.preset_inputs).toEqual(q.body.preset_inputs);
    expect(started[0].type).toBe('makeHandsOnWorkflow');
    expect(started[0].opts.args[0]).toMatchObject({ hand_gender: 'male', setting: 'car', modesty: { arms: 'covered', hijab: false } });
  });

  it('a run with no choice renders the defaults the quote showed', async () => {
    const id = seedDraft({ product_details: 'عطر رجالي بالعود' });
    const q = await call(quoteSkillRoute, OWNER, body(id));
    const r = await call(runSkillRoute, OWNER, body(id));
    expect(r.status).toBe(202);
    const input = started[0].opts.args[0] as Record<string, unknown>;
    expect({ hand_gender: input.hand_gender, setting: input.setting }).toEqual({
      hand_gender: (q.body.preset_inputs as Record<string, unknown>).hand_gender,
      setting: (q.body.preset_inputs as Record<string, unknown>).setting,
    });
    expect(input).toMatchObject({ hand_gender: 'male', setting: 'majlis' });
  });
});

// ── Modesty, wired at the route ─────────────────────────────────────────────

describe('make_hands_on resolves the Modesty Default at the route', () => {
  const gulfVoice = () => seedVoice({ dialect: 'gulf' });
  beforeEach(() => {
    TABLES.qualified_presets.push({ preset: 'hands_on', dialect: 'gulf', state: 'qualified' });
  });

  it('a Gulf woman’s hands default to covered arms, and no hijab (no person on screen)', async () => {
    const id = seedDraft({ dialect: 'gulf', voice_catalog_id: gulfVoice() });
    const r = await call(runSkillRoute, OWNER, body(id, { hand_gender: 'female' }));
    expect(r.status).toBe(202);
    expect(started[0].opts.args[0]).toMatchObject({ modesty: { arms: 'covered', hijab: false } });
    const run = TABLES.skill_runs.find((s) => s.id === r.body.skill_run_id)!;
    expect(run.input).toMatchObject({ hand_gender: 'female', modesty: { arms: 'covered', hijab: false } });
  });

  it('an allowed choice (sleeved) reaches the render', async () => {
    const id = seedDraft();
    const r = await call(runSkillRoute, OWNER, body(id, { modesty: { arms: 'sleeved' } }));
    expect(r.status).toBe(202);
    expect(started[0].opts.args[0]).toMatchObject({ modesty: { arms: 'sleeved', hijab: false } });
  });

  it.each([
    ['a man', 'male'],
    ['a woman’s hands (Hands-on shows no person)', 'female'],
  ])('refuses a hijab for %s with 400 HIJAB_NOT_OFFERED, on quote and run, before anything is spent', async (_who, gender) => {
    const id = seedDraft({ dialect: 'gulf', voice_catalog_id: gulfVoice() });
    for (const route of [quoteSkillRoute, runSkillRoute]) {
      const r = await call(route, OWNER, body(id, { hand_gender: gender, modesty: { hijab: true } }));
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ error: 'HIJAB_NOT_OFFERED', skill: 'make_hands_on' });
    }
    expect(uploads).toHaveLength(0);
    expect(started).toHaveLength(0);
    expect(draft(id).render_run_id).toBeNull();
  });

  it('maps a choice less modest than the Preset allows to 400 LESS_MODEST_THAN_PRESET', async () => {
    // Hands-on's floor is "sleeved", the least modest level there is, so the
    // schema already refuses anything below it (bare is not a level). The
    // route's mapping is held by the shared resolver with a stricter Preset.
    const { resolvePresetModesty } = await import('../skills/preset-inputs.js');
    const { RenderRefusal } = await import('../skills/product-hero-render.js');
    const strict = { ...HANDS_ON, modesty: { ...HANDS_ON.modesty, arms: { default: 'covered', least: 'covered' } } } as const;
    let caught: unknown;
    try {
      resolvePresetModesty(strict, { dialect: 'gulf' }, 'female', { arms: 'sleeved' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RenderRefusal);
    expect(caught).toMatchObject({ status: 400, code: 'LESS_MODEST_THAN_PRESET' });
  });
});

// ── Quote == charge ─────────────────────────────────────────────────────────

describe('make_hands_on quote/charge parity', () => {
  /** What the worker charges: every planned clip, plus a frame per hands shot. */
  const charge = (ms: number) =>
    planPresetShots(HANDS_ON, ms).reduce(
      (s, shot) => s + VIDEO_CLIP_CREDITS[shot.seconds] + (shot.kind === 'hands' ? STARTING_FRAME_CREDITS.product_in_hands : 0),
      0,
    );

  it.each([5_000, 6_200, 10_000, 10_001, 13_750, 15_000])(
    'quotes a %i ms draft at exactly its clips plus the image step',
    async (ms) => {
      process.env.BILLING_MODE = 'enabled';
      const id = seedDraft({ duration_ms: ms });
      const quoted = await call(quoteSkillRoute, OWNER, body(id));
      expect(quoted.status).toBe(200);
      expect(quoted.body.credits).toBe(charge(ms));
      expect(quoteSkillCredits('make_hands_on', { draft_id: id, duration_ms: ms })).toBe(charge(ms));
    },
  );

  it('quotes 315 credits up to 10 s (two 5 s clips + the frame) and 455 above (10 s + 5 s + the frame)', () => {
    for (const ms of [5_000, 7_500, 10_000]) expect(quoteSkillCredits('make_hands_on', { duration_ms: ms })).toBe(315);
    for (const ms of [10_001, 15_000]) expect(quoteSkillCredits('make_hands_on', { duration_ms: ms })).toBe(455);
  });

  it('charges more than Product Hero by exactly the frame once Product Hero needs a 10 s clip', () => {
    for (const ms of [5_001, 9_000, 10_000, 15_000]) {
      expect(quoteSkillCredits('make_hands_on', { duration_ms: ms }) - quoteSkillCredits('make_product_hero', { duration_ms: ms })).toBe(
        STARTING_FRAME_CREDITS.product_in_hands,
      );
    }
  });

  it('never quotes above the Preset’s declared budget', () => {
    for (let ms = 5_000; ms <= 15_000; ms += 500) {
      expect(quoteSkillCredits('make_hands_on', { duration_ms: ms })).toBeLessThanOrEqual(HANDS_ON.budget.maxCredits);
    }
  });

  it('the stored run prices like the quote (the in-flight reservation)', async () => {
    const id = seedDraft({ duration_ms: 12_400 });
    const r = await call(runSkillRoute, OWNER, body(id));
    expect(r.status).toBe(202);
    const run = TABLES.skill_runs.find((s) => s.id === r.body.skill_run_id)!;
    expect(run.skill_slug).toBe('make_hands_on');
    expect(quoteSkillCredits('make_hands_on', run.input as Record<string, unknown>)).toBe(charge(12_400));
    expect(JSON.stringify(run.input)).not.toContain('audio_key');
  });

  it('a caller who cannot afford the frame and the clips gets a 402 and keeps the draft renderable', async () => {
    process.env.BILLING_MODE = 'enabled';
    (TABLES.user_credits ??= []).push({ user_id: OWNER, monthly_credits_remaining: 300, purchased_balance: 0 });
    const id = seedDraft({ duration_ms: 9_000 }); // 280 + 35
    const r = await call(runSkillRoute, OWNER, body(id));
    expect(r.status).toBe(402);
    expect(r.body.needed).toBe(315);
    expect(draft(id).render_run_id).toBeNull();
    expect(started).toHaveLength(0);
  });
});

// ── Dispatch ────────────────────────────────────────────────────────────────

describe('make_hands_on dispatch', () => {
  it('starts the Hands-on workflow with the draft’s audio and the re-hosted photo, and claims the draft', async () => {
    const id = seedDraft({ duration_ms: 12_400 });
    const r = await call(runSkillRoute, OWNER, body(id, { hand_gender: 'female', setting: 'kitchen' }));
    expect(r.status).toBe(202);
    expect(r.body.skill).toBe('make_hands_on');
    expect(started).toHaveLength(1);
    expect(started[0].opts.workflowId).toBe(`make_hands_on-${r.body.skill_run_id}`);
    const input = started[0].opts.args[0] as Record<string, unknown>;
    expect(input).toMatchObject({
      skill_run_id: r.body.skill_run_id,
      user_id: OWNER,
      draft_id: id,
      audio_key: `vnext/drafts/${OWNER}/${id}.mp3`,
      duration_ms: 12_400,
      product_image_url: 'https://r2.test/u/product.png',
      aspect_ratio: '9:16',
      hand_gender: 'female',
      setting: 'kitchen',
    });
    // Never prompts: the worker resolves them server-side by Preset id.
    expect(Object.keys(input).some((k) => /prompt|preset/.test(k))).toBe(false);
    expect(draft(id).render_run_id).toBe(r.body.skill_run_id);
  });

  it('an Idempotency-Key replay with a different setting is refused (the key names the request)', async () => {
    const id = seedDraft();
    const headers = { 'Idempotency-Key': 'hands-on-key-1' };
    expect((await call(runSkillRoute, OWNER, body(id, { setting: 'desk' }), { headers })).status).toBe(202);
    const again = await call(runSkillRoute, OWNER, body(id, { setting: 'car' }), { headers });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('idempotency_key_reused');
    const replay = await call(runSkillRoute, OWNER, body(id, { setting: 'desk' }), { headers });
    expect(replay.status).toBe(202);
    expect(replay.body.idempotent_replay).toBe(true);
    expect(started).toHaveLength(1);
  });
});

// ── Qualified Preset ────────────────────────────────────────────────────────

describe('make_hands_on renders only a Qualified Preset', () => {
  const OPERATOR = 'cccccccc-0000-4000-8000-000000000003';
  const gulfVoice = () => seedVoice({ dialect: 'gulf' });

  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'ops@agentmedia.test';
    AUTH_USERS[OPERATOR] = { email: 'ops@agentmedia.test', email_confirmed_at: '2026-09-01T00:00:00Z' };
  });
  afterEach(() => {
    delete process.env.ADMIN_EMAILS;
  });

  it('refuses a user’s draft in a Dialect Hands-on is not qualified for, on quote and run, before anything is spent', async () => {
    // Product Hero is qualified for Gulf; Hands-on is not: the pair is per Preset.
    TABLES.qualified_presets.push({ preset: 'product_hero', dialect: 'gulf', state: 'qualified' });
    const id = seedDraft({ dialect: 'gulf', voice_catalog_id: gulfVoice() });
    for (const route of [quoteSkillRoute, runSkillRoute]) {
      const r = await call(route, OWNER, body(id));
      expect(r.status).toBe(422);
      expect(r.body).toMatchObject({ error: 'PRESET_NOT_QUALIFIED', skill: 'make_hands_on', preset: 'hands_on', dialect: 'gulf' });
    }
    expect(uploads).toHaveLength(0);
    expect(started).toHaveLength(0);
    expect(draft(id).render_run_id).toBeNull();
  });

  it('refuses a withdrawn Hands-on pair at once', async () => {
    TABLES.qualified_presets.find((q) => q.preset === 'hands_on')!.state = 'withdrawn';
    const r = await call(runSkillRoute, OWNER, body(seedDraft()));
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('PRESET_NOT_QUALIFIED');
    expect(started).toHaveLength(0);
  });

  it('an operator renders an unqualified pair (a reviewer sample Short)', async () => {
    const id = seedDraft({ user_id: OPERATOR, dialect: 'gulf', voice_catalog_id: gulfVoice() });
    expect((await call(quoteSkillRoute, OPERATOR, body(id))).status).toBe(200);
    const r = await call(runSkillRoute, OPERATOR, body(id));
    expect(r.status).toBe(202);
    expect(started[0].type).toBe('makeHandsOnWorkflow');
  });
});

// ── OpenAPI ─────────────────────────────────────────────────────────────────

describe('make_hands_on in the OpenAPI spec', () => {
  it('lists the Modesty refusal codes under 400 on run and quote', () => {
    const { paths } = skillRouteOpenApi();
    const run = JSON.stringify((paths['/v1/skills/{slug}/run'] as Record<string, unknown>) ?? paths);
    for (const code of ['LESS_MODEST_THAN_PRESET', 'HIJAB_NOT_OFFERED']) expect(run).toContain(code);
  });
});
