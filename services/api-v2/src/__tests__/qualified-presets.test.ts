// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Qualified Presets (#8), driven through the real HTTP routes: the preset
// picker, the operator qualify / withdraw routes, and the draft routes that the
// qualification gates. The qualification table, the operator check, the Voice
// catalog and every draft provider are faked at the seam. No network.
//
// What must hold: users are offered only Qualified Presets, each Dialect marked
// available or coming soon; only operators qualify and withdraw, and both record
// who and when; drafting (create and re-voice) refuses an unqualified pair with
// PRESET_NOT_QUALIFIED before any provider is paid, for users but not for
// operators (reviewer samples); and a Gulf draft goes through, written and voiced
// in Gulf, once Gulf is qualified.

import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { registerPresetRoutes, presetOpenApi } from '../routes/v1/presets.js';
import { registerDraftRoutes } from '../routes/v1/drafts.js';
import { DialectSchema, type DraftDeps, type DraftRow } from '../drafts/product-hero-draft.js';
import { systemPrompt } from '../drafts/providers.js';
import { SCRIPT_DIALECTS } from '@agentmedia/schema';
import {
  type PresetDeps,
  type QualifiedPresetRow,
} from '../presets/qualification.js';
import type { VoiceRow } from '../voices/catalog.js';

// ── Fakes ────────────────────────────────────────────────────────────────────

function silentMp3(ms: number): Buffer {
  const frameMs = (1152 / 44100) * 1000;
  const frame = Buffer.alloc(417);
  frame[0] = 0xff; frame[1] = 0xfb; frame[2] = 0x90; frame[3] = 0x64;
  return Buffer.concat(Array.from({ length: Math.round(ms / frameMs) }, () => frame));
}

const OPERATOR = 'op-1';
const USER = 'user-a';
const LEVANTINE_VOICE = '10000000-0000-4000-8000-000000000001';
const GULF_VOICE = '10000000-0000-4000-8000-000000000002';
const SCRIPT = 'هَيْدا المُنْتَجْ رَحْ يْغَيِّرْ يومَكْ';

function voice(id: string, dialect: 'levantine' | 'gulf'): VoiceRow {
  return {
    id, provider: 'elevenlabs', provider_voice_id: `el_${dialect}_0000000000`, display_name: dialect, dialect,
    gender: 'female', style: 'warm', sample_url: 'https://samples.test/v.mp3', state: 'approved', added_by: OPERATOR,
    created_at: '2026-09-23T00:00:00Z', approved_by: OPERATOR, approved_at: '2026-09-23T00:00:00Z', revoked_by: null, revoked_at: null,
  };
}

/** The seed the migration ships: Product Hero × Levantine, qualified after the owner's live native review. */
const SEED: QualifiedPresetRow = {
  preset: 'product_hero',
  dialect: 'levantine',
  state: 'qualified',
  qualified_by: null,
  qualified_at: '2026-09-23T00:00:00.000Z',
  withdrawn_by: null,
  withdrawn_at: null,
  notes: 'seed: owner live native review 2026-09-23 (first live Product Hero render, Levantine)',
  created_at: '2026-09-23T00:00:00.000Z',
  updated_at: '2026-09-23T00:00:00.000Z',
};

interface Harness {
  baseUrl: string;
  rows: QualifiedPresetRow[];
  drafts: DraftRow[];
  written: Array<{ dialect: string }>;
  voiced: Array<{ dialect: string; provider_voice_id: string }>;
  close: () => Promise<void>;
}

const servers: Harness[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
});

let clock = Date.parse('2026-09-24T09:00:00.000Z');

async function start(opts: { seed?: QualifiedPresetRow[]; operatorCheckFails?: boolean } = {}): Promise<Harness> {
  const rows: QualifiedPresetRow[] = (opts.seed ?? [SEED]).map((r) => ({ ...r }));
  const drafts: DraftRow[] = [];
  const written: Harness['written'] = [];
  const voiced: Harness['voiced'] = [];
  let seq = 0;

  const isOperator = async (userId: string) => {
    if (opts.operatorCheckFails) throw new Error('auth admin unreachable');
    return userId === OPERATOR;
  };
  const presetDeps: PresetDeps = {
    repo: {
      list: async () => rows.map((r) => ({ ...r })),
      get: async (preset, dialect) => {
        const r = rows.find((x) => x.preset === preset && x.dialect === dialect);
        return r ? { ...r } : null;
      },
      qualify: async (preset, dialect, patch) => {
        const r = rows.find((x) => x.preset === preset && x.dialect === dialect);
        if (r && r.state === 'qualified') return null;
        if (r) return { ...Object.assign(r, patch, { updated_at: patch.qualified_at }) };
        const now = patch.qualified_at;
        const row: QualifiedPresetRow = {
          preset, dialect, withdrawn_by: null, withdrawn_at: null, notes: null, created_at: now, updated_at: now, ...patch,
        };
        rows.push(row);
        return { ...row };
      },
      withdraw: async (preset, dialect, patch) => {
        const r = rows.find((x) => x.preset === preset && x.dialect === dialect && x.state === 'qualified');
        return r ? { ...Object.assign(r, patch, { updated_at: patch.withdrawn_at }) } : null;
      },
    },
    qualifiedDialects: async (preset) => rows.filter((r) => r.preset === preset && r.state === 'qualified').map((r) => r.dialect),
    isOperator,
    now: () => new Date((clock += 60_000)),
  };

  const voices = [voice(LEVANTINE_VOICE, 'levantine'), voice(GULF_VOICE, 'gulf')];
  const draftDeps: DraftDeps = {
    writeScript: async (input) => {
      written.push({ dialect: input.dialect });
      return { script: SCRIPT, product_terms: [], model: 'claude-test' };
    },
    voiceScript: async ({ script, dialect, voice: v }) => {
      voiced.push({ dialect, provider_voice_id: v.provider_voice_id });
      return {
        audio: silentMp3(8000),
        mime: 'audio/mpeg',
        alignment: { characters: [...script], character_start_times_seconds: [...script].map(() => 0), character_end_times_seconds: [...script].map(() => 8) },
        provider: v.provider,
        voiceId: v.provider_voice_id,
        ttsModel: 'eleven_v3',
      };
    },
    ttsModel: 'eleven_v3',
    storeAudio: async ({ userId, draftId }) => ({ key: `vnext/drafts/${userId}/${draftId}.mp3` }),
    signAudioUrl: async (key) => ({ url: `https://signed.r2.test/${key}`, expires_at: new Date(Date.now() + 900_000).toISOString() }),
    repo: {
      insert: async (row) => {
        const saved = { ...row, created_at: new Date().toISOString(), render_started_at: null, render_run_id: null };
        drafts.push(saved);
        return saved;
      },
      getOwned: async (id, userId) => drafts.find((d) => d.id === id && d.user_id === userId) ?? null,
    },
    voices: { get: async (id) => voices.find((v) => v.id === id) ?? null },
    presets: { qualifiedDialects: presetDeps.qualifiedDialects, isOperator },
    newId: () => `30000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  };

  const app = express();
  app.use(express.json());
  const NOOP: express.RequestHandler = (_req, _res, next) => next();
  const auth: express.RequestHandler = (req, res, next) => {
    const hdr = req.headers.authorization;
    if (!hdr?.startsWith('Bearer ')) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing Bearer token' } });
      return;
    }
    (req as { userId?: string }).userId = hdr.slice(7);
    next();
  };
  registerPresetRoutes(app, { generateLimiter: NOOP, readLimiter: NOOP, authMiddleware: auth }, presetDeps);
  registerDraftRoutes(app, { generateLimiter: NOOP, readLimiter: NOOP, authMiddleware: auth, draftLimiter: NOOP }, draftDeps);

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const h: Harness = {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    rows,
    drafts,
    written,
    voiced,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
  servers.push(h);
  return h;
}

async function call(h: Harness, method: string, path: string, user: string | null, body?: unknown) {
  const res = await fetch(`${h.baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const pair = (preset: string, dialect: string) => `/v1/operator/presets/${preset}/dialects/${dialect}`;
const brief = (dialect: string, voice_id: string) => ({ brief: 'Cold brew promo', dialect, voice_id });

// ── The picker ───────────────────────────────────────────────────────────────

describe('GET /v1/presets (the Preset picker)', () => {
  it('requires auth', async () => {
    const h = await start();
    expect((await call(h, 'GET', '/v1/presets', null)).status).toBe(401);
  });

  it('offers Product Hero with Levantine available and every other Dialect coming soon', async () => {
    const h = await start();
    const r = await call(h, 'GET', '/v1/presets', USER);
    expect(r.status).toBe(200);
    expect(r.body.operator).toBe(false);
    expect(r.body.presets).toHaveLength(1);
    const p = r.body.presets[0];
    expect(p).toMatchObject({ slug: 'product_hero', name: 'Product Hero', skill: 'make_product_hero' });
    expect(p.dialects.map((d: { dialect: string; status: string }) => [d.dialect, d.status])).toEqual([
      ['levantine', 'available'],
      ['gulf', 'coming_soon'],
      ['egyptian', 'coming_soon'],
      ['maghrebi', 'coming_soon'],
      ['msa', 'coming_soon'],
    ]);
    // Users are not told which pairs operators could sample.
    expect(p.dialects[1]).not.toHaveProperty('sample');
  });

  it('offers no Preset that has no qualified Dialect to users, but shows it to operators with sampleable Dialects', async () => {
    const h = await start({ seed: [] });
    expect((await call(h, 'GET', '/v1/presets', USER)).body.presets).toEqual([]);
    const op = await call(h, 'GET', '/v1/presets', OPERATOR);
    expect(op.body.operator).toBe(true);
    const dialects = op.body.presets[0].dialects;
    expect(dialects.find((d: { dialect: string }) => d.dialect === 'gulf')).toMatchObject({ status: 'coming_soon', sample: true });
    // No Script writer for Egyptian yet: not even an operator can draft it.
    expect(dialects.find((d: { dialect: string }) => d.dialect === 'egyptian')).toMatchObject({ status: 'coming_soon', sample: false });
  });

  it('a newly qualified Dialect is offered at once, and a withdrawn one is coming soon again', async () => {
    const h = await start();
    expect((await call(h, 'POST', `${pair('product_hero', 'gulf')}/qualify`, OPERATOR, {})).status).toBe(200);
    const gulf = async () =>
      (await call(h, 'GET', '/v1/presets', USER)).body.presets[0]?.dialects.find((d: { dialect: string }) => d.dialect === 'gulf')?.status;
    expect(await gulf()).toBe('available');
    expect((await call(h, 'POST', `${pair('product_hero', 'gulf')}/withdraw`, OPERATOR, {})).status).toBe(200);
    expect(await gulf()).toBe('coming_soon');
  });
});

// ── Operators ────────────────────────────────────────────────────────────────

describe('operator qualification routes', () => {
  it('only operators can list, qualify or withdraw', async () => {
    const h = await start();
    for (const [method, path] of [
      ['GET', '/v1/operator/presets'],
      ['POST', `${pair('product_hero', 'gulf')}/qualify`],
      ['POST', `${pair('product_hero', 'levantine')}/withdraw`],
    ] as const) {
      const r = await call(h, method, path, USER, method === 'POST' ? {} : undefined);
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(r.body.error.code).toBe('OPERATOR_ONLY');
    }
    expect(h.rows.map((r) => [r.dialect, r.state])).toEqual([['levantine', 'qualified']]);
  });

  it('fails closed when the operator check itself fails', async () => {
    const h = await start({ operatorCheckFails: true });
    expect((await call(h, 'POST', `${pair('product_hero', 'gulf')}/qualify`, OPERATOR, {})).status).toBe(403);
  });

  it('lists every Preset × Script Dialect with its review trail, the seed included', async () => {
    const h = await start();
    const r = await call(h, 'GET', '/v1/operator/presets', OPERATOR);
    expect(r.status).toBe(200);
    expect(r.body.qualifications).toEqual([
      expect.objectContaining({ preset: 'product_hero', dialect: 'levantine', state: 'qualified', qualified_by: null, notes: SEED.notes }),
      expect.objectContaining({ preset: 'product_hero', dialect: 'gulf', state: 'not_reviewed', qualified_at: null }),
    ]);
  });

  it('qualify records who and when (and notes); withdraw records who and when and keeps the qualification trail', async () => {
    const h = await start();
    const q = await call(h, 'POST', `${pair('product_hero', 'gulf')}/qualify`, OPERATOR, { notes: 'Reviewed by 2 Saudi natives, 3 samples' });
    expect(q.status).toBe(200);
    expect(q.body.qualification).toMatchObject({
      preset: 'product_hero', dialect: 'gulf', state: 'qualified', qualified_by: OPERATOR, notes: 'Reviewed by 2 Saudi natives, 3 samples',
    });
    expect(Date.parse(q.body.qualification.qualified_at)).toBeGreaterThan(0);

    const w = await call(h, 'POST', `${pair('product_hero', 'gulf')}/withdraw`, OPERATOR, { notes: 'Arabic Reports: stress wrong on product nouns' });
    expect(w.status).toBe(200);
    expect(w.body.qualification).toMatchObject({
      state: 'withdrawn', withdrawn_by: OPERATOR, qualified_by: OPERATOR, notes: 'Arabic Reports: stress wrong on product nouns',
    });
    expect(Date.parse(w.body.qualification.withdrawn_at)).toBeGreaterThan(Date.parse(q.body.qualification.qualified_at));

    // Qualified again after a new review: the last withdrawal stays on record.
    const again = await call(h, 'POST', `${pair('product_hero', 'gulf')}/qualify`, OPERATOR, {});
    expect(again.status).toBe(200);
    expect(again.body.qualification).toMatchObject({ state: 'qualified', withdrawn_by: OPERATOR });
  });

  it('refuses a transition from the wrong state with 409, naming the current state', async () => {
    const h = await start();
    const twice = await call(h, 'POST', `${pair('product_hero', 'levantine')}/qualify`, OPERATOR, {});
    expect(twice.status).toBe(409);
    expect(twice.body.error).toMatchObject({ code: 'QUALIFICATION_STATE_CONFLICT', state: 'qualified' });
    const never = await call(h, 'POST', `${pair('product_hero', 'gulf')}/withdraw`, OPERATOR, {});
    expect(never.status).toBe(409);
    expect(never.body.error).toMatchObject({ code: 'QUALIFICATION_STATE_CONFLICT', state: 'not_reviewed' });
  });

  it('refuses an unknown Preset (404), a Dialect no Script can be written in (400), and unknown fields (400)', async () => {
    const h = await start();
    const unknown = await call(h, 'POST', `${pair('talking_head', 'gulf')}/qualify`, OPERATOR, {});
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('PRESET_NOT_FOUND');
    const egyptian = await call(h, 'POST', `${pair('product_hero', 'egyptian')}/qualify`, OPERATOR, {});
    expect(egyptian.status).toBe(400);
    expect(egyptian.body.error.code).toBe('INVALID_INPUT');
    const extra = await call(h, 'POST', `${pair('product_hero', 'gulf')}/qualify`, OPERATOR, { state: 'qualified' });
    expect(extra.status).toBe(400);
    expect(h.rows).toHaveLength(1);
  });
});

// ── The draft gate ───────────────────────────────────────────────────────────

describe('drafting honours qualification', () => {
  it('Script Dialects are exactly the Dialects a draft can be written in', () => {
    expect(DialectSchema.options).toEqual([...SCRIPT_DIALECTS]);
  });

  it('refuses a user draft for an unqualified pair with PRESET_NOT_QUALIFIED before any provider is paid', async () => {
    const h = await start();
    const r = await call(h, 'POST', '/v1/drafts/product-hero', USER, brief('gulf', GULF_VOICE));
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: 'PRESET_NOT_QUALIFIED', preset: 'product_hero', dialect: 'gulf', available: ['levantine'] });
    expect(h.written).toHaveLength(0);
    expect(h.voiced).toHaveLength(0);
    expect(h.drafts).toHaveLength(0);
  });

  it('refuses a user re-voice for an unqualified pair too', async () => {
    const h = await start();
    const r = await call(h, 'POST', '/v1/drafts/product-hero/revoice', USER, { script: SCRIPT, dialect: 'gulf', voice_id: GULF_VOICE });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('PRESET_NOT_QUALIFIED');
    expect(h.voiced).toHaveLength(0);
  });

  it('a Gulf draft goes through once Gulf is qualified: written and voiced in Gulf', async () => {
    const h = await start();
    expect((await call(h, 'POST', `${pair('product_hero', 'gulf')}/qualify`, OPERATOR, {})).status).toBe(200);
    const r = await call(h, 'POST', '/v1/drafts/product-hero', USER, brief('gulf', GULF_VOICE));
    expect(r.status).toBe(201);
    expect(r.body.draft.dialect).toBe('gulf');
    expect(h.written).toEqual([{ dialect: 'gulf' }]);
    expect(h.voiced).toEqual([{ dialect: 'gulf', provider_voice_id: 'el_gulf_0000000000' }]);
    // And a re-voice of it stays in Gulf.
    const again = await call(h, 'POST', '/v1/drafts/product-hero/revoice', USER, { script: SCRIPT, dialect: 'gulf', parent_draft_id: r.body.draft.id });
    expect(again.status).toBe(201);
    expect(again.body.draft.dialect).toBe('gulf');
  });

  it('the Gulf Script writer is told to write Gulf, not Levantine', () => {
    const gulf = systemPrompt('gulf', { deliveryTags: true });
    expect(gulf).toMatch(/Gulf Arabic/);
    expect(gulf).not.toMatch(/Levantine Arabic/);
  });

  it('a withdrawn pair is refused at once, even for the launch Dialect', async () => {
    const h = await start();
    expect((await call(h, 'POST', `${pair('product_hero', 'levantine')}/withdraw`, OPERATOR, {})).status).toBe(200);
    const r = await call(h, 'POST', '/v1/drafts/product-hero', USER, brief('levantine', LEVANTINE_VOICE));
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: 'PRESET_NOT_QUALIFIED', available: [] });
  });

  it('operators can draft an unqualified pair to make reviewer sample Shorts', async () => {
    const h = await start();
    const r = await call(h, 'POST', '/v1/drafts/product-hero', OPERATOR, brief('gulf', GULF_VOICE));
    expect(r.status).toBe(201);
    expect(r.body.draft.dialect).toBe('gulf');
    expect(h.written).toEqual([{ dialect: 'gulf' }]);
    const re = await call(h, 'POST', '/v1/drafts/product-hero/revoice', OPERATOR, { script: SCRIPT, dialect: 'gulf', parent_draft_id: r.body.draft.id });
    expect(re.status).toBe(201);
  });

  it('a failing operator check refuses the unqualified pair (fails closed)', async () => {
    const h = await start({ operatorCheckFails: true });
    const r = await call(h, 'POST', '/v1/drafts/product-hero', OPERATOR, brief('gulf', GULF_VOICE));
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('PRESET_NOT_QUALIFIED');
  });
});

// ── OpenAPI ──────────────────────────────────────────────────────────────────

describe('preset routes in the OpenAPI spec', () => {
  it('describes the picker and the operator routes', () => {
    const { paths, schemas } = presetOpenApi() as { paths: Record<string, any>; schemas: Record<string, unknown> };
    expect(paths['/v1/presets'].get.operationId).toBe('listPresets');
    expect(paths['/v1/operator/presets'].get.operationId).toBe('operatorListQualifications');
    const qualify = paths['/v1/operator/presets/{preset}/dialects/{dialect}/qualify'].post;
    expect(qualify.responses['403'].description).toContain('OPERATOR_ONLY');
    expect(qualify.responses['409'].description).toContain('QUALIFICATION_STATE_CONFLICT');
    expect(paths['/v1/operator/presets/{preset}/dialects/{dialect}/withdraw'].post.operationId).toBe('operatorWithdrawPreset');
    expect(schemas).toHaveProperty('PresetList');
    expect(schemas).toHaveProperty('Qualification');
  });
});

describe('one spelling of the not-qualified refusal', () => {
  it('the drafts routes and the skill routes document the same code string', async () => {
    const { PRESET_NOT_QUALIFIED } = await import('../presets/qualification.js');
    const { draftOpenApi } = await import('../routes/v1/drafts.js');
    const { skillRouteOpenApi } = await import('../routes/v1/skills-openapi.js');
    expect(PRESET_NOT_QUALIFIED).toBe('PRESET_NOT_QUALIFIED');
    const drafts = draftOpenApi().paths as Record<string, any>;
    expect(drafts['/v1/drafts/product-hero'].post.responses['422'].description).toContain(PRESET_NOT_QUALIFIED);
    const skills = skillRouteOpenApi().paths as Record<string, any>;
    for (const path of ['/v1/skills/{slug}/run', '/v1/skills/{slug}/quote']) {
      expect(skills[path].post.responses['422'].description).toContain(`\`${PRESET_NOT_QUALIFIED}\``);
      expect(skills[path].post.responses['422'].description).not.toContain('preset_not_qualified');
    }
  });
});
