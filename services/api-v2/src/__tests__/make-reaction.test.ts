// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// make_reaction (#19) — rendering an approved draft as a Reaction Short through
// the real quote and run routes. Only the edges are faked: the database (an
// in-memory stand-in), image re-hosting and Temporal. What must hold: the
// schema (saved character, gender, the Modesty choice); a saved character of
// someone else is refused as if it did not exist; the Modesty Default is
// resolved at the route (Gulf woman → hijab on; a less modest choice and a
// hijab for a man are refused with 400 and their code) and handed to the
// render; the quote is the charge; an unqualified Reaction–Dialect pair is
// refused (operators may sample it).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { planPresetShots, REACTION, STANDARD_MODESTY, VIDEO_CLIP_CREDITS } from '@agentmedia/schema';

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

const { quoteSkillRoute, runSkillRoute } = await import('../routes/v1/skills.js');
const { SKILLS } = await import('../skills/registry.js');
const { MakeReactionSkillInputSchema, REACTION_REFUSALS } = await import('../skills/reaction.js');
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

async function call(route: (req: Request, res: Response) => Promise<void>, userId: string, payload: Record<string, unknown>) {
  const out = { status: 0, body: {} as Record<string, unknown> };
  const req = { userId, params: { slug: 'make_reaction' }, body: payload, header: () => undefined } as unknown as Request;
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
  SKILLS.make_reaction.preset = REACTION;
});

// ── Schema + registry ───────────────────────────────────────────────────────

describe('make_reaction skill', () => {
  it('is a composed, agent-facing Preset skill with its own workflow', () => {
    const s = SKILLS.make_reaction;
    expect(s.primitive).toBe('composed:make_reaction');
    expect(s.workflowType).toBe('makeReactionWorkflow');
    expect(s.agentFacing).toBe(true);
    expect(s.preset).toBe(REACTION);
  });

  it('takes a draft, one product photo, a saved character and its gender; 9:16 and Music Bed on by default', () => {
    const ok = MakeReactionSkillInputSchema.safeParse(body(seedDraft()));
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data).toMatchObject({ aspect_ratio: '9:16', music: true });
    const id = seedDraft();
    const bad = (over: Record<string, unknown>) => MakeReactionSkillInputSchema.safeParse(body(id, over)).success;
    expect(bad({ character_id: undefined })).toBe(false);
    expect(bad({ character_id: '' })).toBe(false);
    expect(bad({ character_gender: undefined })).toBe(false);
    expect(bad({ character_gender: 'other' })).toBe(false);
    expect(bad({ product_image_url: undefined })).toBe(false);
    expect(bad({ product_image_base64: 'x'.repeat(80) })).toBe(false); // two photos
    expect(bad({ aspect_ratio: '1:1' })).toBe(false);
  });

  it('takes the Modesty choice (arms and hijab) and nothing less modest than a level', () => {
    const id = seedDraft();
    const parses = (modesty: unknown) => MakeReactionSkillInputSchema.safeParse(body(id, { modesty })).success;
    expect(parses({ hijab: false })).toBe(true);
    expect(parses({ arms: 'sleeved', hijab: true })).toBe(true);
    expect(parses({ arms: 'bare' })).toBe(false);
    expect(parses({ neckline: 'low' })).toBe(false); // strict
  });

  it('refuses the old captions field, like every Preset render', () => {
    expect(MakeReactionSkillInputSchema.safeParse(body(seedDraft(), { captions: false })).success).toBe(false);
  });
});

// ── The saved character ─────────────────────────────────────────────────────

describe('make_reaction — the saved character', () => {
  it('re-hosts the character’s portrait and hands it to the render with the Preset’s workflow', async () => {
    const id = seedDraft();
    const r = await call(runSkillRoute, OWNER, body(id));
    expect(r.status).toBe(202);
    expect(started).toHaveLength(1);
    expect(started[0].type).toBe('makeReactionWorkflow');
    expect(workflowInput()).toMatchObject({
      draft_id: id,
      product_image_url: 'https://r2.test/u/bottle.jpg',
      character_image_url: 'https://r2.test/u/layla-portrait.png',
      aspect_ratio: '9:16',
    });
    expect(uploads).toEqual([PORTRAIT, PHOTO]);
    expect(draftRow(id).render_run_id).toBe(r.body.skill_run_id);
    const run = TABLES.skill_runs.find((s) => s.id === r.body.skill_run_id)!;
    expect(run.input).toMatchObject({ character_id: CHAR, character_gender: 'female' });
  });

  it('uses the character sheet when the character has no portrait, and takes the row id too', async () => {
    const legacy = seedCharacter({ public_id: null, portrait_url: null, character_sheet_url: 'https://r2.example.com/chars/omar-sheet.png' });
    const r = await call(runSkillRoute, OWNER, body(seedDraft(), { character_id: legacy.id, character_gender: 'male' }));
    expect(r.status).toBe(202);
    expect(workflowInput().character_image_url).toBe('https://r2.test/u/omar-sheet.png');
  });

  it.each([
    ['someone else’s character', () => seedCharacter({ user_id: STRANGER, public_id: 'char_stranger01' }).public_id as string],
    ['an archived character', () => seedCharacter({ public_id: 'char_archived1', archived_at: '2026-09-01T00:00:00Z' }).public_id as string],
    ['a character that does not exist', () => 'char_nobody0001'],
  ])('refuses %s as not found, on quote and run, before anything is spent', async (_label, pick) => {
    const id = seedDraft();
    const characterId = pick();
    for (const route of [quoteSkillRoute, runSkillRoute]) {
      const r = await call(route, OWNER, body(id, { character_id: characterId }));
      expect(r.status).toBe(404);
      expect(r.body).toMatchObject({ error: 'character_not_found', skill: 'make_reaction' });
    }
    expect(uploads).toHaveLength(0);
    expect(started).toHaveLength(0);
    expect(draftRow(id).render_run_id).toBeNull();
  });

  it('refuses a character whose reference is blocked by moderation, before anything is charged', async () => {
    BLOCKED.add(PORTRAIT);
    const id = seedDraft();
    const r = await call(runSkillRoute, OWNER, body(id));
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('unsafe_content');
    expect(started).toHaveLength(0);
    expect(draftRow(id).render_run_id).toBeNull();
  });

  it('only reads on the quote: nothing is re-hosted', async () => {
    const r = await call(quoteSkillRoute, OWNER, body(seedDraft()));
    expect(r.status).toBe(200);
    expect(uploads).toHaveLength(0);
  });
});

// ── The Modesty Default, resolved at the route (#17 on #19) ─────────────────

describe('make_reaction — the Modesty Default', () => {
  it('a Gulf woman wears a hijab by default, with covered arms: quoted and handed to the render', async () => {
    const id = seedDraft({ dialect: 'gulf' });
    const q = await call(quoteSkillRoute, OWNER, body(id));
    expect(q.status).toBe(200);
    expect((q.body.preset_inputs as Record<string, unknown>).modesty).toEqual({ arms: 'covered', hijab: true });
    const r = await call(runSkillRoute, OWNER, body(id));
    expect(r.status).toBe(202);
    expect(workflowInput().modesty).toEqual({ arms: 'covered', hijab: true });
    expect(TABLES.skill_runs.find((s) => s.id === r.body.skill_run_id)!.input).toMatchObject({ modesty: { arms: 'covered', hijab: true } });
  });

  it('a Gulf woman may turn the hijab off (it is on by default, not required)', async () => {
    const r = await call(runSkillRoute, OWNER, body(seedDraft({ dialect: 'gulf' }), { modesty: { hijab: false } }));
    expect(r.status).toBe(202);
    expect(workflowInput().modesty).toEqual({ arms: 'covered', hijab: false });
  });

  it('outside the Gulf the hijab is offered and off by default; a woman may choose it', async () => {
    expect(((await call(quoteSkillRoute, OWNER, body(seedDraft()))).body.preset_inputs as Record<string, unknown>).modesty).toEqual({ arms: 'covered', hijab: false });
    await call(runSkillRoute, OWNER, body(seedDraft(), { modesty: { hijab: true, arms: 'sleeved' } }));
    expect(workflowInput().modesty).toEqual({ arms: 'sleeved', hijab: true });
  });

  it('a man gets covered arms and no hijab', async () => {
    await call(runSkillRoute, OWNER, body(seedDraft({ dialect: 'gulf' }), { character_gender: 'male' }));
    expect(workflowInput().modesty).toEqual({ arms: 'covered', hijab: false });
  });

  it('refuses a hijab for a man with 400 HIJAB_NOT_OFFERED, on quote and run', async () => {
    const id = seedDraft();
    for (const route of [quoteSkillRoute, runSkillRoute]) {
      const r = await call(route, OWNER, body(id, { character_gender: 'male', modesty: { hijab: true } }));
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ error: 'HIJAB_NOT_OFFERED', skill: 'make_reaction' });
    }
    expect(started).toHaveLength(0);
    expect(uploads).toHaveLength(0);
  });

  describe('a choice less modest than the Preset allows', () => {
    // STANDARD_MODESTY allows every level the schema can name, so the floor is
    // raised here: arms covered at the least, and a hijab required in the Gulf.
    beforeEach(() => {
      SKILLS.make_reaction.preset = {
        ...REACTION,
        modesty: { arms: { default: 'covered', least: 'covered' }, hijab: { ...STANDARD_MODESTY.hijab, gulf: 'required' } },
      };
    });

    it.each([
      ['sleeved arms under a covered floor', 'levantine', { arms: 'sleeved' }],
      ['a required hijab turned off', 'gulf', { hijab: false }],
    ])('refuses %s with 400 LESS_MODEST_THAN_PRESET, on quote and run', async (_label, dialect, modesty) => {
      const id = seedDraft({ dialect });
      for (const route of [quoteSkillRoute, runSkillRoute]) {
        const r = await call(route, OWNER, body(id, { modesty }));
        expect(r.status).toBe(400);
        expect(r.body).toMatchObject({ error: 'LESS_MODEST_THAN_PRESET', skill: 'make_reaction' });
      }
      expect(started).toHaveLength(0);
      expect(draftRow(id).render_run_id).toBeNull();
    });
  });

  it('maps every ModestyError code to a 400 refusal', () => {
    expect(REACTION_REFUSALS.LESS_MODEST_THAN_PRESET.status).toBe(400);
    expect(REACTION_REFUSALS.HIJAB_NOT_OFFERED.status).toBe(400);
  });
});

// ── Quote == charge ─────────────────────────────────────────────────────────

describe('make_reaction quote/charge parity', () => {
  const clipCharge = (ms: number) => planPresetShots(REACTION, ms).reduce((s, shot) => s + VIDEO_CLIP_CREDITS[shot.seconds], 0);

  it.each([5_000, 7_400, 10_000, 10_001, 13_750, 15_000])('quotes a %i ms draft at exactly what its planned clips are charged', async (ms) => {
    process.env.BILLING_MODE = 'enabled';
    (TABLES.user_credits ??= []).push({ user_id: OWNER, monthly_credits_remaining: 10_000, purchased_balance: 0 });
    const id = seedDraft({ duration_ms: ms });
    const q = await call(quoteSkillRoute, OWNER, body(id));
    expect(q.status).toBe(200);
    expect(q.body.credits).toBe(clipCharge(ms));

    const r = await call(runSkillRoute, OWNER, body(id));
    expect(r.status).toBe(202);
    // What the run stored prices identically (preflight and in-flight reservation).
    const run = TABLES.skill_runs.find((s) => s.id === r.body.skill_run_id)!;
    expect(quoteSkillCredits('make_reaction', run.input as Record<string, unknown>)).toBe(clipCharge(ms));
  });

  it('a caller who cannot afford it gets a 402 for the quoted amount and keeps the draft renderable', async () => {
    process.env.BILLING_MODE = 'enabled';
    (TABLES.user_credits ??= []).push({ user_id: OWNER, monthly_credits_remaining: 300, purchased_balance: 0 });
    const id = seedDraft({ duration_ms: 12_000 });
    const q = await call(quoteSkillRoute, OWNER, body(id));
    expect(q.body).toMatchObject({ credits: 560, sufficient: false });
    const r = await call(runSkillRoute, OWNER, body(id));
    expect(r.status).toBe(402);
    expect(r.body.needed).toBe(560);
    expect(started).toHaveLength(0);
    expect(draftRow(id).render_run_id).toBeNull();
  });

  it('never quotes above the Preset’s declared budget', () => {
    for (let ms = 5_000; ms <= 15_000; ms += 250) {
      expect(quoteSkillCredits('make_reaction', { duration_ms: ms })).toBeLessThanOrEqual(REACTION.budget.maxCredits);
    }
  });
});

// ── Qualified Presets (#8) ──────────────────────────────────────────────────

describe('make_reaction renders only a Qualified Preset', () => {
  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'ops@agentmedia.test';
    AUTH_USERS[OPERATOR] = { email: 'ops@agentmedia.test', email_confirmed_at: '2026-09-01T00:00:00Z' };
  });

  it('refuses a draft in a Dialect Reaction is not qualified for, on quote and run, before anything is spent', async () => {
    const id = seedDraft({ dialect: 'egyptian' });
    for (const route of [quoteSkillRoute, runSkillRoute]) {
      const r = await call(route, OWNER, body(id));
      expect(r.status).toBe(422);
      expect(r.body).toMatchObject({ error: 'PRESET_NOT_QUALIFIED', skill: 'make_reaction', preset: 'reaction', dialect: 'egyptian' });
    }
    expect(uploads).toHaveLength(0);
    expect(started).toHaveLength(0);
  });

  it('a Product Hero qualification does not qualify Reaction', async () => {
    TABLES.qualified_presets = [{ preset: 'product_hero', dialect: 'levantine', state: 'qualified' }];
    const r = await call(runSkillRoute, OWNER, body(seedDraft()));
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('PRESET_NOT_QUALIFIED');
  });

  it('an operator renders an unqualified pair with their own character (a reviewer sample Short)', async () => {
    seedCharacter({ user_id: OPERATOR, public_id: 'char_operator01' });
    const id = seedDraft({ user_id: OPERATOR, dialect: 'egyptian' });
    const payload = body(id, { character_id: 'char_operator01' });
    expect((await call(quoteSkillRoute, OPERATOR, payload)).status).toBe(200);
    const r = await call(runSkillRoute, OPERATOR, payload);
    expect(r.status).toBe(202);
    expect(started[0].type).toBe('makeReactionWorkflow');
  });
});

// ── OpenAPI ─────────────────────────────────────────────────────────────────

describe('make_reaction in the OpenAPI spec', () => {
  it('lists every Reaction refusal under its status on run and quote', async () => {
    const { skillRouteOpenApi } = await import('../routes/v1/skills-openapi.js');
    const { paths } = skillRouteOpenApi() as { paths: Record<string, { post: { responses: Record<string, { description: string }> } }> };
    for (const path of ['/v1/skills/{slug}/run', '/v1/skills/{slug}/quote']) {
      for (const [code, { status }] of Object.entries(REACTION_REFUSALS)) {
        expect(paths[path].post.responses[String(status)]?.description, `${path} ${status}`).toMatch(new RegExp(`\`${code}\` \\((make_hands_on, )?make_reaction\\)`));
      }
    }
  });
});
