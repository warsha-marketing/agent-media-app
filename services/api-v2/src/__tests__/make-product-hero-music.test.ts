// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
//
// make_product_hero × Music Bed (#9) through the real quote and run routes.
// The Music Bed is on by default; the quote and the render decide it with the
// same call (resolveMusicBed, seeded by the draft id), so the quote names the
// track the render mixes — or says why the Short is voice only. Mixing is free:
// the Music Bed never changes the price. The edges (database, photo re-hosting,
// Temporal) are faked as in make-product-hero.test.ts; the shipped track set is
// swapped for a test set where a test needs one.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import type { MusicBedTrack } from '@agentmedia/schema';

const TEST_TRACKS: { set: MusicBedTrack[] | null } = { set: null };
vi.mock('@agentmedia/schema', async (orig) => {
  const real = await orig<typeof import('@agentmedia/schema')>();
  return {
    ...real,
    // The real decision, over a test set when one is staged (else the shipped set).
    resolveMusicBed: (...[preset, args]: Parameters<typeof real.resolveMusicBed>) =>
      real.resolveMusicBed({ musicBed: TEST_TRACKS.set ?? preset.musicBed }, args),
  };
});

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

const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const VOICE = 'ffffffff-0000-4000-8000-000000000001';
const PHOTO = 'https://cdn.example.com/bottle.jpg';
let draftSeq = 0;

function seedDraft(durationMs = 9_000): string {
  if (!TABLES.voices?.some((v) => v.id === VOICE)) (TABLES.voices ??= []).push({ id: VOICE, dialect: 'levantine', state: 'approved' });
  const id = `dddddddd-0000-4000-8000-${String(++draftSeq).padStart(12, '0')}`;
  (TABLES.short_drafts ??= []).push({
    id,
    user_id: OWNER,
    dialect: 'levantine',
    audio_key: `vnext/drafts/${OWNER}/${id}.mp3`,
    duration_ms: durationMs,
    voice_catalog_id: VOICE,
    render_run_id: null,
  });
  return id;
}

function track(id: string): MusicBedTrack {
  return {
    id,
    preset: 'product_hero',
    mood: 'luxurious',
    source: { kind: 'library', provider: 'Example Library', provider_ref: id },
    licence: { ref: `LICENSES.md#${id}`, licensor: 'Example Ltd', terms_url: 'https://example.test/terms', terms_checked_on: '2026-09-23', grant: 'paid social ads' },
    storage_key: `music-bed/product_hero/${id}.mp3`,
    duration_ms: 30_000,
  };
}

async function call(route: (req: Request, res: Response) => Promise<void>, body: Record<string, unknown>) {
  const out = { status: 0, body: {} as Record<string, unknown> };
  const req = { userId: OWNER, params: { slug: 'make_product_hero' }, body, header: () => undefined } as unknown as Request;
  const res = {
    status(code: number) { out.status = code; return this; },
    json(payload: Record<string, unknown>) { out.body = payload; return this; },
  } as unknown as Response;
  await route(req, res);
  return out;
}

const workflowInput = () => started.at(-1)!.opts.args[0] as Record<string, unknown>;

beforeEach(() => {
  for (const k of Object.keys(TABLES)) delete TABLES[k];
  // Product Hero × Levantine is a Qualified Preset (#8), as the migration seeds it.
  TABLES.qualified_presets = [{ preset: 'product_hero', dialect: 'levantine', state: 'qualified' }];
  started.length = 0;
  TEST_TRACKS.set = null;
  process.env.BILLING_MODE = 'disabled';
  process.env.TEMPORAL_ADDRESS = 'temporal.test:7233';
  process.env.TEMPORAL_NAMESPACE = 'test';
});
afterEach(() => {
  delete process.env.BILLING_MODE;
});

describe('make_product_hero input: Music Bed on/off', () => {
  it('is on by default and can be turned off', () => {
    const on = MakeProductHeroSkillInputSchema.parse({ draft_id: seedDraft(), product_image_url: PHOTO });
    expect(on.music).toBe(true);
    const off = MakeProductHeroSkillInputSchema.parse({ draft_id: seedDraft(), product_image_url: PHOTO, music: false });
    expect(off.music).toBe(false);
    expect(MakeProductHeroSkillInputSchema.safeParse({ draft_id: seedDraft(), product_image_url: PHOTO, music: 'yes' }).success).toBe(false);
  });
});

describe('make_product_hero Music Bed — with licensed tracks', () => {
  beforeEach(() => {
    TEST_TRACKS.set = [track('ph-a'), track('ph-b'), track('ph-c')];
  });

  it('music on: the quote names a track from the set, and the render mixes that same track', async () => {
    const id = seedDraft();
    const q = await call(quoteSkillRoute, { draft_id: id, product_image_url: PHOTO });
    expect(q.status).toBe(200);
    const bed = q.body.music_bed as { on: boolean; track_id: string; detail: string };
    expect(bed.on).toBe(true);
    expect(['ph-a', 'ph-b', 'ph-c']).toContain(bed.track_id);

    const r = await call(runSkillRoute, { draft_id: id, product_image_url: PHOTO });
    expect(r.status).toBe(202);
    expect(workflowInput().music_bed).toEqual({ track_id: bed.track_id, storage_key: `music-bed/product_hero/${bed.track_id}.mp3` });
    expect(r.body.music_bed).toMatchObject({ on: true, track_id: bed.track_id });
    // The run records the choice (not the private key).
    const run = TABLES.skill_runs.find((s) => s.id === r.body.skill_run_id)!;
    expect(run.input).toMatchObject({ music: true, music_bed: bed.track_id });
    expect(JSON.stringify(run.input)).not.toContain('music-bed/');
  });

  it('music off: no track is sent to the render, and the page can say why', async () => {
    const id = seedDraft();
    const q = await call(quoteSkillRoute, { draft_id: id, product_image_url: PHOTO, music: false });
    expect(q.body.music_bed).toMatchObject({ on: false, track_id: null, reason: 'off' });
    expect(String((q.body.music_bed as { detail: string }).detail)).toMatch(/add a sound in TikTok/);

    await call(runSkillRoute, { draft_id: id, product_image_url: PHOTO, music: false });
    expect(workflowInput().music_bed).toBeNull();
  });

  it('the Music Bed never changes the price', async () => {
    process.env.BILLING_MODE = 'enabled';
    const id = seedDraft(12_000);
    const on = await call(quoteSkillRoute, { draft_id: id, product_image_url: PHOTO });
    const off = await call(quoteSkillRoute, { draft_id: id, product_image_url: PHOTO, music: false });
    expect(on.status).toBe(200);
    expect(on.body.credits).toBe(off.body.credits);
    expect(on.body.music_bed).toMatchObject({ on: true });
  });
});

describe('make_product_hero Music Bed — the Preset has no licensed tracks yet', () => {
  it('music on renders voice only, and the quote says the set is empty', async () => {
    TEST_TRACKS.set = [];
    const id = seedDraft();
    const q = await call(quoteSkillRoute, { draft_id: id, product_image_url: PHOTO });
    expect(q.body.music_bed).toMatchObject({ on: false, track_id: null, reason: 'no_tracks' });
    expect(String((q.body.music_bed as { detail: string }).detail)).toMatch(/no licensed Music Bed/i);

    const r = await call(runSkillRoute, { draft_id: id, product_image_url: PHOTO });
    expect(r.status).toBe(202);
    expect(workflowInput().music_bed).toBeNull();
  });

  it('the shipped set behaves the same while it is empty', async () => {
    const id = seedDraft();
    const q = await call(quoteSkillRoute, { draft_id: id, product_image_url: PHOTO });
    const { PRODUCT_HERO } = await import('@agentmedia/schema');
    if (PRODUCT_HERO.musicBed.length === 0) expect(q.body.music_bed).toMatchObject({ on: false, reason: 'no_tracks' });
    else expect(q.body.music_bed).toMatchObject({ on: true });
  });
});
