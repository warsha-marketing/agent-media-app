// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Voice catalog and approval (#7), driven through the real HTTP routes with the
// catalog table, the operator check, the candidate finder and every draft
// provider faked at the seam. No network.
//
// What must hold: users see only Approved Voices for the Dialect they asked for,
// each with a playable sample, filterable by gender and delivery style; a revoked
// Voice disappears at once; only operators add, approve and revoke, and approve /
// revoke record who and when; drafting refuses any Voice that is not approved
// for the draft's Dialect with VOICE_NOT_APPROVED, and a draft voiced by an
// Approved Voice stores which one.

import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerVoiceRoutes, voiceOpenApi } from '../routes/v1/voices.js';
import { registerDraftRoutes } from '../routes/v1/drafts.js';
import {
  AddVoiceInputSchema,
  VoiceError,
  type NewVoiceRow,
  type VoiceCandidate,
  type VoiceDeps,
  type VoiceRow,
} from '../voices/catalog.js';
import { normalizeCandidate, safeSampleUrl, suggestedDialect } from '../voices/candidates.js';
import type { DraftDeps, DraftRow } from '../drafts/product-hero-draft.js';

// ── Fakes ────────────────────────────────────────────────────────────────────

function silentMp3(ms: number): Buffer {
  const frameMs = (1152 / 44100) * 1000;
  const frame = Buffer.alloc(417);
  frame[0] = 0xff; frame[1] = 0xfb; frame[2] = 0x90; frame[3] = 0x64;
  return Buffer.concat(Array.from({ length: Math.round(ms / frameMs) }, () => frame));
}

const SCRIPT = 'هَيْدا المُنْتَجْ رَحْ يْغَيِّرْ يومَكْ';
const OPERATOR = 'op-1';
const USER = 'user-a';

type Seed = Partial<VoiceRow> & Pick<VoiceRow, 'display_name' | 'dialect' | 'gender' | 'style' | 'state'>;

interface Harness {
  baseUrl: string;
  voices: VoiceRow[];
  drafts: DraftRow[];
  voiced: Array<{ script: string; provider: string; provider_voice_id: string }>;
  written: number;
  ids: Record<string, string>;
  close: () => Promise<void>;
}

const servers: Harness[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
});

let clock = Date.parse('2026-09-23T12:00:00.000Z');

async function start(opts: { seed?: Record<string, Seed>; candidates?: VoiceCandidate[] } = {}): Promise<Harness> {
  const voices: VoiceRow[] = [];
  const drafts: DraftRow[] = [];
  const voiced: Harness['voiced'] = [];
  const ids: Record<string, string> = {};
  let seq = 0;
  const uuid = (prefix: string) => `${prefix}-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

  for (const [name, s] of Object.entries(opts.seed ?? {})) {
    const id = uuid('10000000');
    ids[name] = id;
    voices.push({
      id,
      provider: 'elevenlabs',
      provider_voice_id: `el_${name}_000000000`,
      sample_url: `https://storage.googleapis.com/samples/${name}.mp3`,
      added_by: OPERATOR,
      created_at: new Date(clock).toISOString(),
      approved_by: s.state === 'approved' ? OPERATOR : null,
      approved_at: s.state === 'approved' ? new Date(clock).toISOString() : null,
      revoked_by: s.state === 'revoked' ? OPERATOR : null,
      revoked_at: s.state === 'revoked' ? new Date(clock).toISOString() : null,
      ...s,
    });
  }

  const repo: VoiceDeps['repo'] = {
    listApproved: async (dialect) => voices.filter((v) => v.state === 'approved' && v.dialect === dialect).map((v) => ({ ...v })),
    list: async ({ state, dialect }) =>
      voices.filter((v) => (!state || v.state === state) && (!dialect || v.dialect === dialect)).map((v) => ({ ...v })),
    get: async (id) => {
      const v = voices.find((x) => x.id === id);
      return v ? { ...v } : null;
    },
    insert: async (row: NewVoiceRow) => {
      if (voices.some((v) => v.provider === row.provider && v.provider_voice_id === row.provider_voice_id)) {
        throw new VoiceError(409, 'VOICE_EXISTS', 'exists');
      }
      const saved: VoiceRow = {
        ...row,
        created_at: new Date(clock).toISOString(),
        approved_by: null,
        approved_at: null,
        revoked_by: null,
        revoked_at: null,
      };
      voices.push(saved);
      return { ...saved };
    },
    transition: async (id, from, patch) => {
      const v = voices.find((x) => x.id === id && from.includes(x.state));
      if (!v) return null;
      Object.assign(v, patch);
      return { ...v };
    },
  };

  const voiceDeps: VoiceDeps = {
    repo,
    isOperator: async (userId) => userId === OPERATOR,
    findCandidates: async (page) => ({ candidates: opts.candidates ?? [], has_more: false, page }),
    now: () => new Date((clock += 60_000)),
    newId: () => uuid('20000000'),
  };

  const h = { voices, drafts, voiced, written: 0, ids } as unknown as Harness;
  const draftDeps: DraftDeps = {
    writeScript: async () => {
      h.written += 1;
      return { script: SCRIPT, model: 'claude-test' };
    },
    voiceScript: async ({ script, voice }) => {
      voiced.push({ script, provider: voice.provider, provider_voice_id: voice.provider_voice_id });
      const ms = 8000;
      return {
        audio: silentMp3(ms),
        mime: 'audio/mpeg',
        alignment: { characters: [...script], character_start_times_seconds: [...script].map(() => 0), character_end_times_seconds: [...script].map(() => ms / 1000) },
        provider: voice.provider,
        voiceId: voice.provider_voice_id,
        ttsModel: 'eleven_test',
      };
    },
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
    voices: { get: repo.get },
    newId: () => uuid('30000000'),
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
  registerVoiceRoutes(app, { generateLimiter: NOOP, readLimiter: NOOP, authMiddleware: auth }, voiceDeps);
  registerDraftRoutes(app, { generateLimiter: NOOP, readLimiter: NOOP, authMiddleware: auth, draftLimiter: NOOP }, draftDeps);

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  h.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  h.close = () => new Promise<void>((r) => server.close(() => r()));
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

/** A catalog with every case the picker must tell apart. */
const CATALOG: Record<string, Seed> = {
  layla: { display_name: 'Layla', dialect: 'levantine', gender: 'female', style: 'warm', state: 'approved' },
  rami: { display_name: 'Rami', dialect: 'levantine', gender: 'male', style: 'energetic', state: 'approved' },
  nour: { display_name: 'Nour', dialect: 'levantine', gender: 'female', style: 'energetic', state: 'approved' },
  sami: { display_name: 'Sami', dialect: 'levantine', gender: 'male', style: 'warm', state: 'pending' },
  hana: { display_name: 'Hana', dialect: 'levantine', gender: 'female', style: 'warm', state: 'revoked' },
  khalid: { display_name: 'Khalid', dialect: 'gulf', gender: 'male', style: 'energetic', state: 'approved' },
};

const names = (voices: Array<{ display_name: string }>) => voices.map((v) => v.display_name).sort();

// ── User: the picker ─────────────────────────────────────────────────────────

describe('GET /v1/voices (the picker)', () => {
  it('requires auth', async () => {
    const h = await start({ seed: CATALOG });
    expect((await call(h, 'GET', '/v1/voices?dialect=levantine', null)).status).toBe(401);
  });

  it('requires a known Dialect', async () => {
    const h = await start({ seed: CATALOG });
    expect((await call(h, 'GET', '/v1/voices', USER)).body.error.code).toBe('INVALID_INPUT');
    expect((await call(h, 'GET', '/v1/voices?dialect=french', USER)).status).toBe(400);
  });

  it('returns only Approved Voices of the requested Dialect, each with a playable sample', async () => {
    const h = await start({ seed: CATALOG });
    const r = await call(h, 'GET', '/v1/voices?dialect=levantine', USER);
    expect(r.status).toBe(200);
    expect(names(r.body.voices)).toEqual(['Layla', 'Nour', 'Rami']);
    for (const v of r.body.voices) {
      expect(v.dialect).toBe('levantine');
      expect(v.sample_url).toMatch(/^https:\/\//);
      expect(v).toHaveProperty('id');
      expect(v).toHaveProperty('gender');
      expect(v).toHaveProperty('style');
    }
    expect(names((await call(h, 'GET', '/v1/voices?dialect=gulf', USER)).body.voices)).toEqual(['Khalid']);
    expect((await call(h, 'GET', '/v1/voices?dialect=egyptian', USER)).body.voices).toEqual([]);
  });

  it('never shows users the review trail or the provider voice id', async () => {
    const h = await start({ seed: CATALOG });
    const [v] = (await call(h, 'GET', '/v1/voices?dialect=gulf', USER)).body.voices;
    for (const hidden of ['state', 'approved_by', 'approved_at', 'added_by', 'revoked_by', 'provider_voice_id']) {
      expect(v).not.toHaveProperty(hidden);
    }
  });

  it('filters by gender, by style, and by both', async () => {
    const h = await start({ seed: CATALOG });
    expect(names((await call(h, 'GET', '/v1/voices?dialect=levantine&gender=female', USER)).body.voices)).toEqual(['Layla', 'Nour']);
    expect(names((await call(h, 'GET', '/v1/voices?dialect=levantine&style=energetic', USER)).body.voices)).toEqual(['Nour', 'Rami']);
    expect(names((await call(h, 'GET', '/v1/voices?dialect=levantine&gender=male&style=energetic', USER)).body.voices)).toEqual(['Rami']);
    expect((await call(h, 'GET', '/v1/voices?dialect=levantine&gender=male&style=warm', USER)).body.voices).toEqual([]);
    expect((await call(h, 'GET', '/v1/voices?dialect=levantine&gender=robot', USER)).status).toBe(400);
  });

  it('lists the styles on offer for the Dialect, so the filter only offers real choices', async () => {
    const h = await start({ seed: CATALOG });
    const r = await call(h, 'GET', '/v1/voices?dialect=levantine&gender=female', USER);
    // Styles of every Approved Voice of the Dialect, not only of the filtered page.
    expect(r.body.styles).toEqual(['energetic', 'warm']);
  });
});

// ── Operator: add, approve, revoke ───────────────────────────────────────────

const CANDIDATE = {
  provider_voice_id: 'el_candidate_0001',
  display_name: 'Maya',
  dialect: 'levantine',
  gender: 'female',
  style: 'Calm',
  sample_url: 'https://storage.googleapis.com/samples/maya.mp3',
};

describe('operator routes', () => {
  it('are operator-only: a signed-in user gets 403 and nothing changes', async () => {
    const h = await start({ seed: CATALOG });
    const before = JSON.stringify(h.voices);
    for (const [method, path, body] of [
      ['GET', '/v1/operator/voices', undefined],
      ['POST', '/v1/operator/voices', CANDIDATE],
      ['POST', `/v1/operator/voices/${h.ids.sami}/approve`, {}],
      ['POST', `/v1/operator/voices/${h.ids.layla}/revoke`, {}],
      ['GET', '/v1/operator/voice-candidates', undefined],
    ] as const) {
      const r = await call(h, method, path, USER, body);
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(r.body.error.code).toBe('OPERATOR_ONLY');
      expect((await call(h, method, path, null, body)).status).toBe(401);
    }
    expect(JSON.stringify(h.voices)).toBe(before);
  });

  it('adds a candidate Voice as pending, invisible to users until approved', async () => {
    const h = await start({ seed: CATALOG });
    const r = await call(h, 'POST', '/v1/operator/voices', OPERATOR, CANDIDATE);
    expect(r.status).toBe(201);
    expect(r.body.voice).toMatchObject({
      provider: 'elevenlabs',
      provider_voice_id: 'el_candidate_0001',
      dialect: 'levantine',
      style: 'calm',
      state: 'pending',
      added_by: OPERATOR,
      approved_by: null,
      approved_at: null,
    });
    expect(names((await call(h, 'GET', '/v1/voices?dialect=levantine', USER)).body.voices)).not.toContain('Maya');
    // The same provider voice cannot be catalogued twice (it has exactly one Dialect).
    const dup = await call(h, 'POST', '/v1/operator/voices', OPERATOR, { ...CANDIDATE, dialect: 'gulf' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('VOICE_EXISTS');
  });

  it('rejects a candidate without exactly one known Dialect or without an https sample', () => {
    expect(AddVoiceInputSchema.safeParse(CANDIDATE).success).toBe(true);
    expect(AddVoiceInputSchema.safeParse({ ...CANDIDATE, dialect: undefined }).success).toBe(false);
    expect(AddVoiceInputSchema.safeParse({ ...CANDIDATE, dialect: ['levantine', 'gulf'] }).success).toBe(false);
    expect(AddVoiceInputSchema.safeParse({ ...CANDIDATE, dialect: 'arabic' }).success).toBe(false);
    expect(AddVoiceInputSchema.safeParse({ ...CANDIDATE, sample_url: 'http://x.test/a.mp3' }).success).toBe(false);
    expect(AddVoiceInputSchema.safeParse({ ...CANDIDATE, sample_url: 'https://u:p@x.test/a.mp3' }).success).toBe(false);
    expect(AddVoiceInputSchema.safeParse({ ...CANDIDATE, provider_voice_id: '../../x' }).success).toBe(false);
  });

  it('approving records the approver and time and puts the Voice in the picker', async () => {
    const h = await start({ seed: CATALOG });
    const added = (await call(h, 'POST', '/v1/operator/voices', OPERATOR, CANDIDATE)).body.voice;
    const r = await call(h, 'POST', `/v1/operator/voices/${added.id}/approve`, OPERATOR, {});
    expect(r.status).toBe(200);
    expect(r.body.voice.state).toBe('approved');
    expect(r.body.voice.approved_by).toBe(OPERATOR);
    expect(Date.parse(r.body.voice.approved_at)).toBeGreaterThan(Date.parse(added.created_at));
    const row = h.voices.find((v) => v.id === added.id)!;
    expect(row).toMatchObject({ state: 'approved', approved_by: OPERATOR, approved_at: r.body.voice.approved_at });
    expect(names((await call(h, 'GET', '/v1/voices?dialect=levantine', USER)).body.voices)).toContain('Maya');
  });

  it('revoking records who and when, and the Voice leaves the picker on the very next read', async () => {
    const h = await start({ seed: CATALOG });
    expect(names((await call(h, 'GET', '/v1/voices?dialect=levantine', USER)).body.voices)).toContain('Rami');
    const r = await call(h, 'POST', `/v1/operator/voices/${h.ids.rami}/revoke`, OPERATOR, {});
    expect(r.status).toBe(200);
    expect(r.body.voice).toMatchObject({ state: 'revoked', revoked_by: OPERATOR });
    expect(Date.parse(r.body.voice.revoked_at)).not.toBeNaN();
    // The original approval stays on record.
    expect(r.body.voice.approved_by).toBe(OPERATOR);
    expect(names((await call(h, 'GET', '/v1/voices?dialect=levantine', USER)).body.voices)).not.toContain('Rami');
  });

  it('refuses transitions that would overwrite the record, and 404s an unknown Voice', async () => {
    const h = await start({ seed: CATALOG });
    const again = await call(h, 'POST', `/v1/operator/voices/${h.ids.layla}/approve`, OPERATOR, {});
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'VOICE_STATE_CONFLICT', state: 'approved' });
    expect((await call(h, 'POST', `/v1/operator/voices/${h.ids.hana}/revoke`, OPERATOR, {})).status).toBe(409);
    const unknown = await call(h, 'POST', '/v1/operator/voices/99999999-0000-4000-8000-000000000000/approve', OPERATOR, {});
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('VOICE_NOT_FOUND');
    expect((await call(h, 'POST', '/v1/operator/voices/not-a-uuid/revoke', OPERATOR, {})).status).toBe(404);
  });

  it('a revoked Voice can be approved again after a new review', async () => {
    const h = await start({ seed: CATALOG });
    const r = await call(h, 'POST', `/v1/operator/voices/${h.ids.hana}/approve`, OPERATOR, {});
    expect(r.status).toBe(200);
    expect(r.body.voice.state).toBe('approved');
    expect(names((await call(h, 'GET', '/v1/voices?dialect=levantine', USER)).body.voices)).toContain('Hana');
  });

  it('lists every Voice with its review trail for operators, filterable by state and Dialect', async () => {
    const h = await start({ seed: CATALOG });
    const all = await call(h, 'GET', '/v1/operator/voices', OPERATOR);
    expect(all.status).toBe(200);
    expect(all.body.voices).toHaveLength(6);
    expect(all.body.voices[0]).toHaveProperty('approved_by');
    expect(names((await call(h, 'GET', '/v1/operator/voices?state=pending', OPERATOR)).body.voices)).toEqual(['Sami']);
    expect(names((await call(h, 'GET', '/v1/operator/voices?dialect=gulf', OPERATOR)).body.voices)).toEqual(['Khalid']);
  });

  it('finds candidates from the provider library, marking the ones already in the catalog', async () => {
    const candidates: VoiceCandidate[] = [
      { provider: 'elevenlabs', provider_voice_id: 'el_rami_000000000', display_name: 'Rami', description: '', gender: 'male', accent: 'syrian', suggested_dialect: 'levantine', style: 'energetic', sample_url: null },
      { provider: 'elevenlabs', provider_voice_id: 'el_new_0000000000', display_name: 'New', description: '', gender: 'female', accent: 'saudi', suggested_dialect: 'gulf', style: 'calm', sample_url: 'https://storage.googleapis.com/x.mp3' },
    ];
    const h = await start({ seed: CATALOG, candidates });
    const r = await call(h, 'GET', '/v1/operator/voice-candidates?page=0', OPERATOR);
    expect(r.status).toBe(200);
    expect(r.body.candidates[0].catalog).toEqual({ id: h.ids.rami, state: 'approved', dialect: 'levantine' });
    expect(r.body.candidates[1].catalog).toBeNull();
  });
});

// ── Candidate finder (ElevenLabs shared library, from the c556541 prototype) ─

describe('candidate normalisation', () => {
  it('prefers the Arabic preview, maps the accent to a Dialect, and never invents labels', () => {
    const c = normalizeCandidate({
      voice_id: 'arabicvoice12345', name: 'Test', accent: 'palestinian', gender: 'female', descriptive: 'Calm',
      preview_url: 'https://storage.googleapis.com/default.mp3',
      verified_languages: [
        { language: 'en', preview_url: 'https://storage.googleapis.com/english.mp3' },
        { language: 'ar', preview_url: 'https://storage.googleapis.com/arabic.mp3' },
      ],
    });
    expect(c).toMatchObject({ suggested_dialect: 'levantine', gender: 'female', style: 'calm', sample_url: 'https://storage.googleapis.com/arabic.mp3' });
    expect(normalizeCandidate({ voice_id: 'unknownvoice123' })).toMatchObject({ suggested_dialect: null, gender: null, style: null });
    expect(normalizeCandidate({ voice_id: '../invalid' })).toBeNull();
  });

  it.each([['syrian', 'levantine'], ['saudi', 'gulf'], ['egyptian', 'egyptian'], ['modern standard', 'msa'], ['algerian', 'maghrebi'], ['iraqi', null]])(
    'maps accent %s to %s',
    (accent, dialect) => expect(suggestedDialect(accent)).toBe(dialect),
  );

  it.each(['http://storage.googleapis.com/a.mp3', 'https://storage.googleapis.com.evil.example/a.mp3', 'https://secret@storage.googleapis.com/a.mp3'])(
    'drops unsafe sample URLs: %s',
    (url) => expect(safeSampleUrl(url)).toBeNull(),
  );
});

// ── Drafting only with an Approved Voice of the draft's Dialect ──────────────

describe('drafting with a Voice from the catalog', () => {
  const create = (h: Harness, voice_id: string | undefined, dialect = 'levantine') =>
    call(h, 'POST', '/v1/drafts/product-hero', USER, { brief: 'Cold brew promo', dialect, ...(voice_id ? { voice_id } : {}) });

  it('requires a voice_id', async () => {
    const h = await start({ seed: CATALOG });
    const r = await create(h, undefined);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_INPUT');
  });

  it('voices the Script with the chosen Approved Voice and stores it on the draft', async () => {
    const h = await start({ seed: CATALOG });
    const r = await create(h, h.ids.nour);
    expect(r.status).toBe(201);
    expect(h.voiced).toEqual([{ script: SCRIPT, provider: 'elevenlabs', provider_voice_id: 'el_nour_000000000' }]);
    expect(h.drafts[0]).toMatchObject({ voice_catalog_id: h.ids.nour, voice_provider: 'elevenlabs', voice_id: 'el_nour_000000000' });
    expect(r.body.draft.voice).toEqual({ id: h.ids.nour, provider: 'elevenlabs', provider_voice_id: 'el_nour_000000000', model: 'eleven_test' });
  });

  for (const [label, voice, code] of [
    ['a pending Voice', 'sami', 'VOICE_NOT_APPROVED'],
    ['a revoked Voice', 'hana', 'VOICE_NOT_APPROVED'],
    ['an Approved Voice of another Dialect', 'khalid', 'VOICE_NOT_APPROVED'],
  ] as const) {
    it(`refuses ${label} with ${code} before any provider is paid`, async () => {
      const h = await start({ seed: CATALOG });
      const r = await create(h, h.ids[voice]);
      expect(r.status).toBe(422);
      expect(r.body.error).toMatchObject({ code, voice_id: h.ids[voice], dialect: 'levantine' });
      expect(h.written).toBe(0);
      expect(h.voiced).toHaveLength(0);
      expect(h.drafts).toHaveLength(0);
    });
  }

  it('refuses a Voice that is not in the catalog with the same code', async () => {
    const h = await start({ seed: CATALOG });
    const r = await create(h, '99999999-0000-4000-8000-000000000000');
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('VOICE_NOT_APPROVED');
  });

  it('a Voice revoked after a draft was made can no longer re-voice it', async () => {
    const h = await start({ seed: CATALOG });
    const first = (await create(h, h.ids.rami)).body.draft;
    await call(h, 'POST', `/v1/operator/voices/${h.ids.rami}/revoke`, OPERATOR, {});
    // Without voice_id the re-voice inherits the parent's Voice, which is now revoked.
    const r = await call(h, 'POST', '/v1/drafts/product-hero/revoice', USER, { script: SCRIPT, dialect: 'levantine', parent_draft_id: first.id });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('VOICE_NOT_APPROVED');
    expect(h.voiced).toHaveLength(1);
  });

  it('re-voices with the parent Voice by default, or with another Approved Voice', async () => {
    const h = await start({ seed: CATALOG });
    const first = (await create(h, h.ids.rami)).body.draft;
    const same = await call(h, 'POST', '/v1/drafts/product-hero/revoice', USER, { script: SCRIPT, dialect: 'levantine', parent_draft_id: first.id });
    expect(same.status).toBe(201);
    expect(h.drafts[1].voice_catalog_id).toBe(h.ids.rami);
    const other = await call(h, 'POST', '/v1/drafts/product-hero/revoice', USER, { script: SCRIPT, dialect: 'levantine', parent_draft_id: first.id, voice_id: h.ids.layla });
    expect(other.status).toBe(201);
    expect(h.drafts[2].voice_catalog_id).toBe(h.ids.layla);
    expect(h.voiced.map((v) => v.provider_voice_id)).toEqual(['el_rami_000000000', 'el_rami_000000000', 'el_layla_000000000']);
  });

  it('a re-voice without a parent must name a Voice', async () => {
    const h = await start({ seed: CATALOG });
    const r = await call(h, 'POST', '/v1/drafts/product-hero/revoice', USER, { script: SCRIPT, dialect: 'levantine' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_INPUT');
  });
});

// ── OpenAPI + wiring ─────────────────────────────────────────────────────────

describe('voice routes in the OpenAPI spec', () => {
  it('documents every mounted voice route', () => {
    const routes: Array<{ method: string; path: string }> = [];
    const recorder = {
      post: (path: string) => routes.push({ method: 'post', path }),
      get: (path: string) => routes.push({ method: 'get', path }),
    } as unknown as express.Express;
    const NOOP: express.RequestHandler = (_req, _res, next) => next();
    registerVoiceRoutes(recorder, { generateLimiter: NOOP, readLimiter: NOOP, authMiddleware: NOOP }, {} as VoiceDeps);
    expect(routes).toHaveLength(6);
    const spec = voiceOpenApi();
    for (const { method, path } of routes) {
      const op = (spec.paths[path.replace(/:(\w+)/g, '{$1}')] as Record<string, any> | undefined)?.[method];
      expect(op, `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(op.security).toEqual([{ bearerAuth: [] }]);
      expect(op.responses['401']).toBeDefined();
      if (path.startsWith('/v1/operator/')) expect(op.responses['403']).toBeDefined();
    }
  });

  it('server.ts mounts the routes and publishes them in /openapi.json', () => {
    const server = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'server.ts'), 'utf8');
    expect(server).toMatch(/registerVoiceRoutes\(app, \{ generateLimiter, readLimiter, authMiddleware \}/);
    expect(server).toContain('const voiceSpec = voiceOpenApi();');
    expect(server).toContain('Object.assign(paths, voiceSpec.paths);');
    expect(server).toContain('...voiceSpec.schemas,');
  });

  it('drafting no longer depends on a single pre-configured voice', () => {
    const providers = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'drafts/providers.ts'), 'utf8');
    expect(providers).not.toContain('PRODUCT_HERO_VOICE_ID');
  });
});
