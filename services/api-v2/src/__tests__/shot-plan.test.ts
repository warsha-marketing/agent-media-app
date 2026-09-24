// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Shot Plan review (#26) through the real routes: POST /v1/skills/{slug}/shot-plan
// composes every shot of a Preset render (stable id, kind, on-screen length,
// model → fallback, scene text, locked Guardrails) behind the same draft gate as
// the quote; `shot_edits` on the quote and the run is checked against that plan
// (422 SHOT_EDIT_INVALID / SHOT_EDIT_BREAKS_GUARDRAIL), never changes the
// price, is part of the Idempotency-Key fingerprint, and reaches the worker as
// validated scene text only. Only the edges are faked (database, re-hosting,
// Temporal), as in make-reaction.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { planPresetShots, REACTION } from '@agentmedia/schema';
import { NO_SPEAKING_PERSON, REACTION_PROMPTS, SCENE_TEXT_MAX_CHARS, SETTING_WORDS } from '@agentmedia/shot-prompts';

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

const AUTH_USERS: Record<string, { email: string; email_confirmed_at: string | null }> = {};
vi.mock('../server.js', () => ({
  supabase: {
    from: (t: string) => query(t),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: AUTH_USERS[id] ?? null }, error: null }) } },
  },
}));

/** Every image re-hosted, in order; a URL listed in BLOCKED is refused by moderation. */
const uploads: string[] = [];
const BLOCKED = new Set<string>();
vi.mock('../lib/r2-upload.js', async (orig) => {
  const { ModerationError } = await import('../lib/image-moderation.js');
  return {
    publicStorageMessage: (await orig<typeof import('../lib/r2-upload.js')>()).publicStorageMessage,
    uploadUserImageFromUrl: async (_u: string, url: string) => {
      if (BLOCKED.has(url)) throw new ModerationError(['sexual']);
      uploads.push(url);
      return { url: `https://r2.test/u/${url.split('/').pop()}` };
    },
    uploadUserImageBase64: async () => (uploads.push('base64'), { url: 'https://r2.test/u/product.png' }),
    uploadUserVideoFromUrl: async () => ({ url: 'https://r2.test/u/v.mp4' }),
  };
});

const started: Array<{ type: string; opts: { workflowId: string; args: unknown[] } }> = [];
vi.mock('../orchestrator/temporal/client.js', () => ({
  getTemporalClient: async () => ({
    workflow: {
      start: async (type: string, opts: { workflowId: string; args: unknown[] }) => void started.push({ type, opts }),
      getHandle: () => ({ terminate: async () => undefined }),
    },
  }),
}));

const { quoteSkillRoute, runSkillRoute, shotPlanRoute } = await import('../routes/v1/skills.js');
const { quoteSkillCredits } = await import('../skills/credit-quotes.js');

const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const STRANGER = 'bbbbbbbb-0000-4000-8000-000000000002';
const OPERATOR = 'cccccccc-0000-4000-8000-000000000003';
const PHOTO = 'https://cdn.example.com/bottle.jpg';
const PORTRAIT = 'https://r2.example.com/chars/layla-portrait.png';
const SHEET = 'https://r2.example.com/chars/layla-sheet.png';
const CHAR = 'char_layla00001';
let seq = 0;

function seedVoice(dialect: string): string {
  const id = `ffffffff-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  (TABLES.voices ??= []).push({ id, dialect, state: 'approved' });
  return id;
}

function seedDraft(over: Partial<Row> = {}): string {
  const dialect = (over.dialect as string | undefined) ?? 'levantine';
  const id = `dddddddd-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  (TABLES.short_drafts ??= []).push({
    id,
    user_id: OWNER,
    preset: 'product_hero',
    dialect,
    audio_key: `vnext/drafts/${OWNER}/${id}.mp3`,
    duration_ms: 9_000,
    voice_catalog_id: seedVoice(dialect),
    render_run_id: null,
    ...over,
  });
  return id;
}

function seedCharacter(over: Partial<Row> = {}): Row {
  const row: Row = {
    id: `99999999-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    user_id: OWNER,
    public_id: CHAR,
    name: 'Layla',
    portrait_url: PORTRAIT,
    character_sheet_url: SHEET,
    archived_at: null,
    ...over,
  };
  (TABLES.user_characters ??= []).push(row);
  return row;
}

const body = (draftId: string, over: Record<string, unknown> = {}) => ({
  draft_id: draftId,
  product_image_url: PHOTO,
  character_id: CHAR,
  character_gender: 'female',
  ...over,
});

async function call(
  route: (req: Request, res: Response) => Promise<void>,
  userId: string,
  payload: Record<string, unknown>,
  slug = 'make_reaction',
  idempotencyKey?: string,
) {
  const out = { status: 0, body: {} as Record<string, unknown> };
  const req = {
    userId,
    params: { slug },
    body: payload,
    header: (name: string) => (name.toLowerCase() === 'idempotency-key' ? idempotencyKey : undefined),
  } as unknown as Request;
  const res = {
    status(code: number) { out.status = code; return this; },
    json(p: Record<string, unknown>) { out.body = p; return this; },
  } as unknown as Response;
  await route(req, res);
  return out;
}

const workflowInput = () => started.at(-1)!.opts.args[0] as Record<string, unknown>;
const draftRow = (id: string) => TABLES.short_drafts.find((d) => d.id === id)!;

beforeEach(() => {
  for (const k of Object.keys(TABLES)) delete TABLES[k];
  for (const k of Object.keys(AUTH_USERS)) delete AUTH_USERS[k];
  TABLES.qualified_presets = [
    { preset: 'reaction', dialect: 'levantine', state: 'qualified' },
    { preset: 'reaction', dialect: 'gulf', state: 'qualified' },
    { preset: 'product_hero', dialect: 'levantine', state: 'qualified' },
    { preset: 'hands_on', dialect: 'levantine', state: 'qualified' },
  ];
  seedCharacter();
  uploads.length = 0;
  BLOCKED.clear();
  started.length = 0;
  process.env.BILLING_MODE = 'disabled';
  process.env.TEMPORAL_ADDRESS = 'temporal.test:7233';
  process.env.TEMPORAL_NAMESPACE = 'test';
});
afterEach(() => {
  delete process.env.BILLING_MODE;
  delete process.env.ADMIN_EMAILS;
});

type ShotView = {
  shot_id: string;
  number: number;
  kind: string;
  on_screen_ms: number;
  model: { id: string; name: string };
  fallback: { id: string; name: string } | null;
  scene_text: string;
  default_scene_text: string;
  edited: boolean;
  guardrails: Array<{ id: string; label: string; text: string; enforced_by: string }>;
  prompt_preview: string;
};
const shotsOf = (b: Record<string, unknown>) => b.shots as ShotView[];
const PERFUME = 'removes the cap, sprays once on the inner wrist, brings the wrist to the nose, smiles';
const EDIT = 'The person sniffs the inner wrist, then nods slowly at the bottle.';

describe('POST /v1/skills/{slug}/shot-plan', () => {
  it('composes every shot of a Reaction render: ids, kinds, lengths, model → fallback, scene, locked Guardrails', async () => {
    const id = seedDraft({ dialect: 'gulf', duration_ms: 12_000, product_interaction: PERFUME });
    const r = await call(shotPlanRoute, OWNER, body(id));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ skill: 'make_reaction', preset: 'reaction', draft_id: id, duration_ms: 12_000, scene_text_max_chars: SCENE_TEXT_MAX_CHARS });
    const shots = shotsOf(r.body);
    const planned = planPresetShots(REACTION, 12_000);
    expect(shots.map((s) => [s.shot_id, s.number, s.kind, s.on_screen_ms])).toEqual(
      planned.map((p, i) => [`shot-${i + 1}-${p.kind}`, i + 1, p.kind, p.onScreenMs]),
    );
    const [reaction, product] = shots;
    expect(reaction.model).toEqual({ id: 'kling-o3-pro', name: 'Kling O3 Pro' });
    expect(reaction.fallback).toEqual({ id: 'veo-3.1', name: 'Veo 3.1' });
    expect(product.model).toEqual({ id: 'seedance-2.0', name: 'Seedance 2.0' });
    expect(product.fallback).toBeNull();
    expect(reaction.scene_text).toBe(`${REACTION_PROMPTS.scenes.reaction} How the product is used, as a real person uses it: ${PERFUME}.`);
    expect(reaction.scene_text).toBe(reaction.default_scene_text);
    expect(reaction.edited).toBe(false);
    // A Gulf woman: hijab on by default, locked with the rest.
    expect(reaction.guardrails.map((g) => g.id)).toEqual(['person_reference', 'product_reference', 'no_speaking', 'modesty', 'hijab', 'format', 'audio_off']);
    expect(reaction.guardrails.find((g) => g.id === 'no_speaking')!.text).toBe(NO_SPEAKING_PERSON);
    expect(reaction.guardrails.find((g) => g.id === 'audio_off')!.enforced_by).toBe('request');
    expect(product.guardrails.map((g) => g.id)).toEqual(['product_reference', 'no_people', 'format', 'audio_off']);
    // The user sees plain words, never a provider's reference syntax.
    for (const s of shots) {
      expect(s.prompt_preview).not.toMatch(/@image|\{\{/);
      expect(s.prompt_preview).toContain(s.scene_text);
    }
    expect(reaction.prompt_preview).toContain('the character’s photo');
  });

  it('shows the edits it is given, and refuses a bad one as the quote would', async () => {
    const id = seedDraft();
    const ok = await call(shotPlanRoute, OWNER, body(id, { shot_edits: { 'shot-1-reaction': EDIT } }));
    expect(ok.status).toBe(200);
    expect(shotsOf(ok.body)[0]).toMatchObject({ scene_text: EDIT, edited: true });
    const bad = await call(shotPlanRoute, OWNER, body(id, { shot_edits: { 'shot-1-reaction': 'She talks to the camera.' } }));
    expect(bad.status).toBe(422);
    expect(bad.body).toMatchObject({ error: 'SHOT_EDIT_BREAKS_GUARDRAIL', shot_id: 'shot-1-reaction', guardrail: 'speech' });
  });

  it('Product Hero and Hands-on: their own shots and scenes, the Hands-on setting filled', async () => {
    const hero = await call(shotPlanRoute, OWNER, { draft_id: seedDraft({ duration_ms: 12_500 }), product_image_url: PHOTO }, 'make_product_hero');
    expect(hero.status).toBe(200);
    expect(shotsOf(hero.body).map((s) => [s.shot_id, s.on_screen_ms])).toEqual([
      ['shot-1-hero', 10_000],
      ['shot-2-detail', 2_500],
    ]);
    const hands = await call(
      shotPlanRoute,
      OWNER,
      { draft_id: seedDraft({ duration_ms: 9_000, product_details: 'Arabica coffee beans' }), product_image_url: PHOTO, setting: 'kitchen' },
      'make_hands_on',
    );
    expect(hands.status).toBe(200);
    const [h, p] = shotsOf(hands.body);
    expect(h.kind).toBe('hands');
    expect(h.scene_text).toContain(SETTING_WORDS.kitchen);
    expect(h.guardrails.map((g) => g.id)).toContain('hands_only');
    expect(p.scene_text).toContain(SETTING_WORDS.kitchen);
  });

  it('is owner-only: someone else’s draft is as if it did not exist', async () => {
    const r = await call(shotPlanRoute, STRANGER, body(seedDraft()));
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('draft_not_found');
  });

  it('refuses an unqualified Preset–Dialect pair, but an operator may preview it', async () => {
    const id = seedDraft({ dialect: 'egyptian' });
    const r = await call(shotPlanRoute, OWNER, body(id));
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('PRESET_NOT_QUALIFIED');

    process.env.ADMIN_EMAILS = 'ops@agentmedia.test';
    AUTH_USERS[OPERATOR] = { email: 'ops@agentmedia.test', email_confirmed_at: '2026-09-01T00:00:00Z' };
    seedCharacter({ user_id: OPERATOR, public_id: 'char_operator01' });
    const own = seedDraft({ user_id: OPERATOR, dialect: 'egyptian' });
    const op = await call(shotPlanRoute, OPERATOR, body(own, { character_id: 'char_operator01' }));
    expect(op.status).toBe(200);
  });

  it('only a Preset render skill has one', async () => {
    const r = await call(shotPlanRoute, OWNER, { prompt: 'x' }, 'make_portrait');
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('not_a_preset_skill');
  });
});

describe('shot_edits on the quote and the run', () => {
  it('never changes the price', async () => {
    process.env.BILLING_MODE = 'enabled';
    (TABLES.user_credits ??= []).push({ user_id: OWNER, monthly_credits_remaining: 10_000, purchased_balance: 0 });
    const id = seedDraft({ duration_ms: 12_000 });
    const plain = await call(quoteSkillRoute, OWNER, body(id));
    const edited = await call(quoteSkillRoute, OWNER, body(id, { shot_edits: { 'shot-1-reaction': EDIT, 'shot-4-product': 'A slow push-in on the product on dark marble.' } }));
    expect(plain.status).toBe(200);
    expect(edited.status).toBe(200);
    expect(edited.body.credits).toBe(plain.body.credits);
    const r = await call(runSkillRoute, OWNER, body(id, { shot_edits: { 'shot-1-reaction': EDIT } }));
    expect(r.status).toBe(202);
    const run = TABLES.skill_runs.find((s) => s.id === r.body.skill_run_id)!;
    expect(quoteSkillCredits('make_reaction', run.input as Record<string, unknown>)).toBe(plain.body.credits);
  });

  it.each([
    ['she talks to the camera', 'She talks to the camera about the scent.', 'speech'],
    ['no headscarf', 'The person, no headscarf, smiles at the bottle.', 'hijab'],
    ['bare arms', 'Bare arms reach for the bottle.', 'exposed'],
    ['Arabic speech', 'تتكلم عن العطر وهي تبتسم', 'speech'],
  ])('refuses an edit that contradicts a Guardrail (%s): 422 SHOT_EDIT_BREAKS_GUARDRAIL, nothing started', async (_l, text, guardrail) => {
    const id = seedDraft();
    for (const route of [quoteSkillRoute, runSkillRoute]) {
      const r = await call(route, OWNER, body(id, { shot_edits: { 'shot-1-reaction': text } }));
      expect(r.status).toBe(422);
      expect(r.body).toMatchObject({ error: 'SHOT_EDIT_BREAKS_GUARDRAIL', skill: 'make_reaction', shot_id: 'shot-1-reaction', reason: 'guardrail', guardrail });
      expect(String(r.body.detail)).toMatch(/Guardrail/);
    }
    expect(started).toHaveLength(0);
    expect(uploads).not.toContain(PHOTO); // refused before the product photo is re-hosted
    expect(draftRow(id).render_run_id).toBeNull();
    expect(TABLES.skill_runs ?? []).toHaveLength(0);
  });

  it.each([
    ['a shot the plan does not have', { 'shot-9-reaction': EDIT }, 'unknown_shot'],
    ['a reaction edit on a product shot id', { 'shot-2-reaction': EDIT }, 'unknown_shot'],
    ['empty scene text', { 'shot-1-reaction': '   ' }, 'empty'],
    ['scene text over the cap', { 'shot-1-reaction': 'a '.repeat(SCENE_TEXT_MAX_CHARS) + 'b' }, 'too_long'],
    ['a bracketed tag', { 'shot-1-reaction': '[excited] The person smiles.' }, 'brackets'],
    ['reference syntax', { 'shot-1-reaction': 'The person in @image2 smiles at @image1.' }, 'reference_syntax'],
  ])('refuses %s: 422 SHOT_EDIT_INVALID', async (_l, shot_edits, reason) => {
    const id = seedDraft();
    for (const route of [quoteSkillRoute, runSkillRoute]) {
      const r = await call(route, OWNER, body(id, { shot_edits }));
      expect(r.status).toBe(422);
      expect(r.body).toMatchObject({ error: 'SHOT_EDIT_INVALID', reason });
    }
    expect(started).toHaveLength(0);
  });

  it('hands the worker validated scene text only — the edits that change a shot, tidied — and stores them on the run', async () => {
    const id = seedDraft();
    const planned = await call(shotPlanRoute, OWNER, body(id));
    const product = shotsOf(planned.body)[1];
    const r = await call(
      runSkillRoute,
      OWNER,
      body(id, { shot_edits: { 'shot-1-reaction': `  ${EDIT}\n `, [product.shot_id]: product.default_scene_text } }),
    );
    expect(r.status).toBe(202);
    const wf = workflowInput();
    expect(wf.shot_edits).toEqual({ 'shot-1-reaction': EDIT });
    expect(wf).not.toHaveProperty('guardrails');
    const run = TABLES.skill_runs.find((s) => s.id === r.body.skill_run_id)!;
    expect((run.input as Record<string, unknown>).shot_edits).toEqual({ 'shot-1-reaction': EDIT });
  });

  it('without edits the workflow input is exactly as before (no shot_edits at all)', async () => {
    const r = await call(runSkillRoute, OWNER, body(seedDraft()));
    expect(r.status).toBe(202);
    expect(workflowInput()).not.toHaveProperty('shot_edits');
    const run = TABLES.skill_runs.find((s) => s.id === r.body.skill_run_id)!;
    expect(run.input as Record<string, unknown>).not.toHaveProperty('shot_edits');
  });

  it('is part of the Idempotency-Key fingerprint: the same key with other edits is refused, with the same edits replayed', async () => {
    const id = seedDraft();
    const key = 'confirm-26-a';
    const first = await call(runSkillRoute, OWNER, body(id, { shot_edits: { 'shot-1-reaction': EDIT } }), 'make_reaction', key);
    expect(first.status).toBe(202);
    const again = await call(runSkillRoute, OWNER, body(id, { shot_edits: { 'shot-1-reaction': EDIT } }), 'make_reaction', key);
    expect(again.status).toBe(202);
    expect(again.body).toMatchObject({ skill_run_id: first.body.skill_run_id, idempotent_replay: true });
    const other = await call(runSkillRoute, OWNER, body(id, { shot_edits: { 'shot-1-reaction': 'The person smiles and nods.' } }), 'make_reaction', key);
    expect(other.status).toBe(409);
    expect(other.body.error).toBe('idempotency_key_reused');
    const none = await call(runSkillRoute, OWNER, body(id), 'make_reaction', key);
    expect(none.status).toBe(409);
    expect(started).toHaveLength(1);
  });
});
