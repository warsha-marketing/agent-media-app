// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// make_product_hero never burns Captions (#22) — through the real quote and run
// routes. #10's Captions toggle is gone: the render input has no `captions`, the
// workflow is never handed an alignment, and the quote and run say nothing
// about Captions. Captions are added after the render (routes/v1/shorts.ts).
// A client that still sends `captions` (any value) is refused with 400
// captions_moved, pointing at the Caption editor, on both quote and run, before
// anything is looked up or started. The edges (database, photo re-hosting,
// Temporal) are faked as in make-product-hero-music.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

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
const { MakeProductHeroSkillInputSchema, SKILLS } = await import('../skills/registry.js');

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

const CAPTIONS_MOVED = {
  error: 'captions_moved',
  skill: 'make_product_hero',
  detail: 'Captions are added after the render with the Caption editor (GET /v1/shorts/{id}/captions, POST /v1/shorts/{id}/caption-exports).',
};

describe('make_product_hero: no Captions in the render', () => {
  it('the input schema refuses a captions field with the Caption editor pointer', () => {
    const base = { draft_id: seedDraft(), product_image_url: PHOTO };
    expect(MakeProductHeroSkillInputSchema.safeParse(base).success).toBe(true);
    for (const captions of [true, false, { on: true }]) {
      const r = MakeProductHeroSkillInputSchema.safeParse({ ...base, captions });
      expect(r.success).toBe(false);
      expect(r.error!.issues).toEqual([expect.objectContaining({ path: ['captions'], message: CAPTIONS_MOVED.detail })]);
    }
  });

  it('is the shared Preset render schema, without a Modesty choice (Product Hero shows nobody)', async () => {
    const { presetRenderInputSchema } = await import('../skills/preset-inputs.js');
    const { PRODUCT_HERO, HANDS_ON, REACTION } = await import('@agentmedia/schema');
    const { zodToJsonSchema } = await import('zod-to-json-schema');
    expect(zodToJsonSchema(MakeProductHeroSkillInputSchema)).toEqual(zodToJsonSchema(presetRenderInputSchema(PRODUCT_HERO, {})));
    const props = (s: Parameters<typeof zodToJsonSchema>[0]) => Object.keys((zodToJsonSchema(s) as { properties: object }).properties);
    expect(props(MakeProductHeroSkillInputSchema)).toEqual(['draft_id', 'product_image_url', 'product_image_base64', 'aspect_ratio', 'music']);
    // Presets that show hands or a person take the Modesty choice.
    expect(props(presetRenderInputSchema(HANDS_ON, {}))).toContain('modesty');
    expect(props(presetRenderInputSchema(REACTION, {}))).toContain('modesty');
    // As before: an unknown `modesty` on Product Hero is dropped, never refused.
    const parsed = MakeProductHeroSkillInputSchema.parse({ draft_id: seedDraft(), product_image_url: PHOTO, modesty: { arms: 'bare' } });
    expect(parsed).not.toHaveProperty('modesty');
  });

  it('every Preset render schema refuses a captions field', () => {
    const presets = Object.values(SKILLS).filter((s) => s.preset);
    expect(presets.map((s) => s.slug)).toContain('make_product_hero');
    for (const skill of presets) {
      const r = skill.inputSchema.safeParse({ draft_id: seedDraft(), product_image_url: PHOTO, captions: true });
      expect(r.success, skill.slug).toBe(false);
      expect(JSON.stringify(r.error?.issues), skill.slug).toContain(CAPTIONS_MOVED.detail);
    }
  });

  it('a run without captions: the workflow gets no alignment, the run records nothing about Captions', async () => {
    const r = await call(runSkillRoute, { draft_id: seedDraft(), product_image_url: PHOTO });
    expect(r.status).toBe(202);
    expect(workflowInput()).not.toHaveProperty('captions');
    expect(JSON.stringify(workflowInput())).not.toContain('character_start_times_seconds');
    expect(runRow(r.body.skill_run_id).input).not.toHaveProperty('captions');
    expect(r.body).not.toHaveProperty('captions');
  });

  it('the quote says nothing about Captions', async () => {
    const q = await call(quoteSkillRoute, { draft_id: seedDraft(), product_image_url: PHOTO });
    expect(q.status).toBe(200);
    expect(q.body).not.toHaveProperty('captions');
  });

  it.each([
    ['captions: true', true],
    ['captions: false', false],
    ['captions: null', null],
  ])('run and quote with %s are refused 400 captions_moved, and nothing starts', async (_label, captions) => {
    const body = { draft_id: seedDraft(), product_image_url: PHOTO, captions };
    const run = await call(runSkillRoute, body, { 'Idempotency-Key': `captions-${String(captions)}` });
    expect(run).toEqual({ status: 400, body: CAPTIONS_MOVED });
    expect(await call(quoteSkillRoute, body)).toEqual({ status: 400, body: CAPTIONS_MOVED });
    expect(started).toHaveLength(0);
    expect(TABLES.skill_runs ?? []).toHaveLength(0);
  });

  it('an Idempotency-Key replayed with captions added is refused, not replayed', async () => {
    const id = seedDraft();
    const headers = { 'Idempotency-Key': 'render-no-captions' };
    const first = await call(runSkillRoute, { draft_id: id, product_image_url: PHOTO }, headers);
    expect(first.status).toBe(202);
    const again = await call(runSkillRoute, { draft_id: id, product_image_url: PHOTO, captions: true }, headers);
    expect(again).toEqual({ status: 400, body: CAPTIONS_MOVED });
    expect(started).toHaveLength(1);
  });
});
