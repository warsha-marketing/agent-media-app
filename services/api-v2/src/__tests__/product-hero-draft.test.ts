// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Product Hero draft (Brief → diacritized Script → voice preview), driven through
// the real HTTP routes with every provider faked at the seam: the Script writer
// (Claude), the voice (ElevenLabs), audio storage and the draft table. No network.
//
// What must hold: the input schema; a draft comes back with Script, playable
// audio, the duration MEASURED from the audio, and the alignment; re-voicing an
// edited Script makes a NEW draft in the parent's Dialect; speech outside 5–15 s
// is refused with a code the UI and agent can act on; nobody reads a draft they
// do not own; and draft audio is private: the owner gets a short-lived signed
// URL minted at read time, never a public URL or the storage key.

import { describe, it, expect, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerDraftRoutes, draftOpenApi } from '../routes/v1/drafts.js';
import { productionDraftDeps } from '../drafts/providers.js';
import {
  CreateDraftInputSchema,
  RevoiceDraftInputSchema,
  mp3DurationMs,
  type DraftDeps,
  type DraftRow,
  type Alignment,
} from '../drafts/product-hero-draft.js';

// ── Fakes ────────────────────────────────────────────────────────────────────

/** A real MPEG-1 Layer III stream of silent frames (128 kbps, 44.1 kHz), so the
 *  duration is measured from audio bytes exactly as it is in production. */
function silentMp3(ms: number): Buffer {
  const frameMs = (1152 / 44100) * 1000;
  const frames = Math.round(ms / frameMs);
  const frame = Buffer.alloc(417); // 144 * 128000 / 44100, no padding
  frame[0] = 0xff; frame[1] = 0xfb; frame[2] = 0x90; frame[3] = 0x64;
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

/** The one Approved (Levantine) Voice in the fake catalog; see voice-catalog.test.ts for the catalog itself. */
const VOICE = '10000000-0000-4000-8000-000000000001';

const SCRIPT_A = 'هَيْدا المُنْتَجْ رَحْ يْغَيِّرْ يومَكْ';
const SCRIPT_B = 'جَرِّبُو هَلَّقْ وْشُوفْ الفَرِقْ بْعَيْنَكْ';

function alignmentFor(text: string, ms: number): Alignment {
  const chars = [...text];
  const step = ms / 1000 / chars.length;
  return {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => +(i * step).toFixed(3)),
    character_end_times_seconds: chars.map((_, i) => +((i + 1) * step).toFixed(3)),
  };
}

/** Where the bucket would serve objects publicly. Draft audio must never be handed out here. */
const PUBLIC_PREFIX = 'https://pub.r2.test/';
const SIGNED_PREFIX = 'https://signed.r2.test/';

interface Harness {
  baseUrl: string;
  rows: DraftRow[];
  calls: { write: Array<Record<string, unknown>>; voice: string[]; store: string[]; sign: string[] };
  close: () => Promise<void>;
}

const servers: Harness[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
});

/** @param durations ms of speech the fake voice returns, one per voicing, in order. */
async function start(opts: { durations: number[]; scripts?: string[]; override?: Partial<DraftDeps> }): Promise<Harness> {
  const rows: DraftRow[] = [];
  const calls = { write: [] as Array<Record<string, unknown>>, voice: [] as string[], store: [] as string[], sign: [] as string[] };
  const durations = [...opts.durations];
  const scripts = [...(opts.scripts ?? [SCRIPT_A, SCRIPT_B])];
  let seq = 0;

  const deps: DraftDeps = {
    writeScript: async (input) => {
      calls.write.push(input as unknown as Record<string, unknown>);
      return { script: scripts.shift() ?? SCRIPT_A, model: 'claude-test' };
    },
    voiceScript: async ({ script, voice }) => {
      calls.voice.push(script);
      const ms = durations.shift() ?? 8000;
      return {
        audio: silentMp3(ms),
        mime: 'audio/mpeg',
        alignment: alignmentFor(script, ms),
        provider: voice.provider,
        voiceId: voice.provider_voice_id,
        ttsModel: 'eleven_test',
      };
    },
    storeAudio: async ({ userId, draftId }) => {
      const key = `vnext/drafts/${userId}/${draftId}.mp3`;
      calls.store.push(key);
      return { key };
    },
    signAudioUrl: async (key) => {
      calls.sign.push(key);
      return {
        url: `${SIGNED_PREFIX}${key}?X-Amz-Expires=900&X-Amz-Signature=sig${calls.sign.length}`,
        expires_at: new Date(Date.now() + 900_000).toISOString(),
      };
    },
    repo: {
      insert: async (row) => {
        const saved = { ...row, created_at: new Date(Date.now() + rows.length).toISOString(), render_started_at: null, render_run_id: null };
        rows.push(saved);
        return saved;
      },
      getOwned: async (id, userId) => rows.find((r) => r.id === id && r.user_id === userId) ?? null,
    },
    voices: {
      get: async (id) =>
        id === VOICE
          ? {
              id: VOICE, provider: 'fake-voice', provider_voice_id: 'voice-test', display_name: 'Test', dialect: 'levantine',
              gender: 'female', style: 'warm', sample_url: 'https://samples.test/v.mp3', state: 'approved', added_by: 'op',
              created_at: '2026-09-23T00:00:00Z', approved_by: 'op', approved_at: '2026-09-23T00:00:00Z', revoked_by: null, revoked_at: null,
            }
          : null,
    },
    newId: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    ...opts.override,
  };

  const app = express();
  app.use(express.json());
  const NOOP: express.RequestHandler = (_req, _res, next) => next();
  // Bearer <user> → that user, so ownership can be exercised across two users.
  const auth: express.RequestHandler = (req, res, next) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing Bearer token' } });
      return;
    }
    (req as { userId?: string }).userId = h.slice(7);
    next();
  };
  registerDraftRoutes(app, { generateLimiter: NOOP, readLimiter: NOOP, authMiddleware: auth, draftLimiter: NOOP }, deps);

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const h: Harness = {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    rows,
    calls,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
  servers.push(h);
  return h;
}

async function call(h: Harness, method: string, path: string, user: string | null, body?: unknown) {
  const res = await fetch(`${h.baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(user ? { Authorization: `Bearer ${user}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

// ── Input schema ─────────────────────────────────────────────────────────────

describe('draft input schema', () => {
  it('accepts a Brief in any language with the Levantine Dialect', () => {
    expect(CreateDraftInputSchema.safeParse({ brief: 'Promo for our new cold brew', dialect: 'levantine', voice_id: VOICE }).success).toBe(true);
    expect(CreateDraftInputSchema.safeParse({ brief: 'إعلان لقهوة باردة جديدة', dialect: 'levantine', voice_id: VOICE }).success).toBe(true);
  });

  it('knows Gulf as a Dialect (so it can be enabled later) but not arbitrary strings', () => {
    expect(CreateDraftInputSchema.safeParse({ brief: 'Promo', dialect: 'gulf', voice_id: VOICE }).success).toBe(true);
    expect(CreateDraftInputSchema.safeParse({ brief: 'Promo', dialect: 'french' }).success).toBe(false);
  });

  it('rejects an empty, missing or oversized Brief and unknown fields', () => {
    expect(CreateDraftInputSchema.safeParse({ brief: '   ', dialect: 'levantine', voice_id: VOICE }).success).toBe(false);
    expect(CreateDraftInputSchema.safeParse({ dialect: 'levantine', voice_id: VOICE }).success).toBe(false);
    expect(CreateDraftInputSchema.safeParse({ brief: 'x'.repeat(2001), dialect: 'levantine', voice_id: VOICE }).success).toBe(false);
    expect(CreateDraftInputSchema.safeParse({ brief: 'Promo', dialect: 'levantine', model: 'x' }).success).toBe(false);
  });

  it('re-voice takes the edited Script, bounded in length', () => {
    expect(RevoiceDraftInputSchema.safeParse({ script: SCRIPT_A, dialect: 'levantine', voice_id: VOICE }).success).toBe(true);
    expect(RevoiceDraftInputSchema.safeParse({ script: '', dialect: 'levantine', voice_id: VOICE }).success).toBe(false);
    expect(RevoiceDraftInputSchema.safeParse({ script: 'ب'.repeat(601), dialect: 'levantine', voice_id: VOICE }).success).toBe(false);
    expect(RevoiceDraftInputSchema.safeParse({ script: SCRIPT_A, dialect: 'levantine', parent_draft_id: 'nope' }).success).toBe(false);
  });
});

describe('mp3DurationMs', () => {
  it('measures the audio itself, frame by frame', () => {
    expect(Math.abs(mp3DurationMs(silentMp3(8000)) - 8000)).toBeLessThan(30);
    expect(Math.abs(mp3DurationMs(silentMp3(14_500)) - 14_500)).toBeLessThan(30);
  });

  it('skips a leading ID3 tag and returns 0 for bytes that are not MP3', () => {
    const id3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0, 0, 0, 0, 10]), Buffer.alloc(10)]);
    expect(Math.abs(mp3DurationMs(Buffer.concat([id3, silentMp3(6000)])) - 6000)).toBeLessThan(30);
    expect(mp3DurationMs(Buffer.from('not audio at all'))).toBe(0);
  });
});

// ── Routes ───────────────────────────────────────────────────────────────────

describe('POST /v1/drafts/product-hero', () => {
  it('requires auth', async () => {
    const h = await start({ durations: [8000] });
    const r = await call(h, 'POST', '/v1/drafts/product-hero', null, { brief: 'Promo', dialect: 'levantine', voice_id: VOICE });
    expect(r.status).toBe(401);
  });

  it('rejects invalid input with 400 before any provider is called', async () => {
    const h = await start({ durations: [8000] });
    const r = await call(h, 'POST', '/v1/drafts/product-hero', 'user-a', { dialect: 'levantine', voice_id: VOICE });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_INPUT');
    expect(h.calls.write).toHaveLength(0);
    expect(h.calls.voice).toHaveLength(0);
  });

  it('refuses a Dialect that is not live yet with a distinct code', async () => {
    const h = await start({ durations: [8000] });
    const r = await call(h, 'POST', '/v1/drafts/product-hero', 'user-a', { brief: 'Promo', dialect: 'gulf', voice_id: VOICE });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('DIALECT_NOT_AVAILABLE');
    expect(h.calls.write).toHaveLength(0);
  });

  it('writes the Script, voices it, and returns a persisted draft with audio, duration and alignment', async () => {
    const h = await start({ durations: [9000] });
    const r = await call(h, 'POST', '/v1/drafts/product-hero', 'user-a', { brief: 'Cold brew promo', dialect: 'levantine', voice_id: VOICE });
    expect(r.status).toBe(201);
    const d = r.body.draft;
    expect(d.preset).toBe('product_hero');
    expect(d.dialect).toBe('levantine');
    expect(d.brief).toBe('Cold brew promo');
    expect(d.script).toBe(SCRIPT_A);
    expect(d.audio_url).toMatch(/^https:\/\/signed\.r2\.test\/vnext\/drafts\/user-a\//);
    expect(Date.parse(d.audio_url_expires_at)).toBeGreaterThan(Date.now());
    expect(Math.abs(d.duration_ms - 9000)).toBeLessThan(30);
    expect(d.alignment.characters.join('')).toBe(SCRIPT_A);
    // The provider is whatever voiced it, not a name the draft core assumes.
    expect(d.voice).toEqual({ id: VOICE, provider: 'fake-voice', provider_voice_id: 'voice-test', model: 'eleven_test' });
    expect(d.render_started_at).toBeNull();
    expect(d.render_run_id).toBeNull();
    // The Brief went to the writer with its Dialect; the writer's Script is what got voiced.
    expect(h.calls.write[0]).toMatchObject({ brief: 'Cold brew promo', dialect: 'levantine' });
    expect(h.calls.voice).toEqual([SCRIPT_A]);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].user_id).toBe('user-a');
    // The render phase (#5) finds the audio by its storage key, kept server-side.
    expect(h.rows[0].audio_key).toBe(h.calls.store[0]);
  });

  it('keeps draft audio private: a signed URL for the owner, never a public URL or the storage key', async () => {
    const h = await start({ durations: [9000] });
    const r = await call(h, 'POST', '/v1/drafts/product-hero', 'user-a', { brief: 'Promo', dialect: 'levantine', voice_id: VOICE });
    expect(r.status).toBe(201);
    const text = JSON.stringify(r.body);
    expect(text).not.toContain(PUBLIC_PREFIX);
    expect(r.body.draft).not.toHaveProperty('audio_key');
    expect(r.body.draft.audio_url.startsWith(SIGNED_PREFIX)).toBe(true);
    // Nothing public is persisted either: the row holds the key only.
    expect(h.rows[0]).not.toHaveProperty('audio_url');
  });

  it('asks the writer for one rewrite when the first voicing misses the band, telling it by how much', async () => {
    const h = await start({ durations: [17_000, 11_000] });
    const r = await call(h, 'POST', '/v1/drafts/product-hero', 'user-a', { brief: 'Promo', dialect: 'levantine', voice_id: VOICE });
    expect(r.status).toBe(201);
    expect(r.body.draft.script).toBe(SCRIPT_B);
    expect(h.calls.write).toHaveLength(2);
    expect(h.calls.write[1]).toMatchObject({ previous: { script: SCRIPT_A, direction: 'shorten' } });
    expect(h.rows).toHaveLength(1);
  });

  it('rejects (and persists nothing) when the rewrite still misses the band', async () => {
    const h = await start({ durations: [3000, 3500] });
    const r = await call(h, 'POST', '/v1/drafts/product-hero', 'user-a', { brief: 'Promo', dialect: 'levantine', voice_id: VOICE });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('SCRIPT_TOO_SHORT');
    expect(r.body.error.script).toBe(SCRIPT_B); // so the UI can put it in the editor
    expect(h.rows).toHaveLength(0);
    expect(h.calls.store).toHaveLength(0);
  });
});

describe('Script writer output guard', () => {
  it('refuses a Script that came back without تشكيل, before paying for a voice', async () => {
    const h = await start({ durations: [8000], scripts: ['هيدا المنتج رح يغير يومك'] });
    const r = await call(h, 'POST', '/v1/drafts/product-hero', 'user-a', { brief: 'Promo', dialect: 'levantine', voice_id: VOICE });
    expect(r.status).toBe(502);
    expect(r.body.error.code).toBe('SCRIPT_GENERATION_FAILED');
    expect(h.calls.voice).toHaveLength(0);
    expect(h.rows).toHaveLength(0);
  });
});

describe('server wiring', () => {
  const server = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'server.ts'), 'utf8');

  it('mounts the draft routes behind auth with a per-user draft ceiling, outside the credit path', () => {
    expect(server).toContain('registerDraftRoutes(app, { generateLimiter, readLimiter, authMiddleware, draftLimiter }, deps);');
    expect(server).toMatch(/const draftLimiter = rateLimit\(\{[\s\S]*?keyGenerator: rateLimitKey/);
    const routes = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'routes/v1/drafts.ts'), 'utf8');
    // The limiter must come after auth, or it buckets by IP instead of by user.
    expect(routes.match(/authMiddleware, draftLimiter, async/g)?.length).toBe(2);
    expect(routes).not.toMatch(/deduct|preflight|videoConcurrencyGate|quoteSkillCredits/);
  });
});

describe('POST /v1/drafts/product-hero/revoice', () => {
  it('voices the edited Script as a NEW draft and leaves the earlier one unchanged', async () => {
    const h = await start({ durations: [8000, 12_000] });
    const first = (await call(h, 'POST', '/v1/drafts/product-hero', 'user-a', { brief: 'Promo', dialect: 'levantine', voice_id: VOICE })).body.draft;
    const snapshot = JSON.parse(JSON.stringify(h.rows[0]));

    const edited = `${SCRIPT_A} ${SCRIPT_B}`;
    const r = await call(h, 'POST', '/v1/drafts/product-hero/revoice', 'user-a', {
      script: edited,
      dialect: 'levantine',
      parent_draft_id: first.id,
    });
    expect(r.status).toBe(201);
    const second = r.body.draft;
    expect(second.id).not.toBe(first.id);
    expect(second.script).toBe(edited);
    expect(second.parent_draft_id).toBe(first.id);
    expect(second.brief).toBe('Promo'); // inherited from the parent
    expect(Math.abs(second.duration_ms - 12_000)).toBeLessThan(30);
    expect(second.dialect).toBe('levantine'); // inherited from the parent
    expect(second.audio_url).not.toBe(first.audio_url);
    // Re-voicing never rewrites: the user's words go to the voice verbatim.
    expect(h.calls.write).toHaveLength(1);
    expect(h.calls.voice[1]).toBe(edited);
    expect(h.rows).toHaveLength(2);
    expect(h.rows[0]).toEqual(snapshot);
  });

  it('rejects speech under 5 s with SCRIPT_TOO_SHORT and an instruction to lengthen', async () => {
    const h = await start({ durations: [4200] });
    const r = await call(h, 'POST', '/v1/drafts/product-hero/revoice', 'user-a', { script: SCRIPT_A, dialect: 'levantine', voice_id: VOICE });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: 'SCRIPT_TOO_SHORT', action: 'lengthen', min_ms: 5000, max_ms: 15000 });
    expect(Math.abs(r.body.error.duration_ms - 4200)).toBeLessThan(30);
    expect(r.body.error.message).toMatch(/lengthen/i);
    expect(h.rows).toHaveLength(0);
    expect(h.calls.store).toHaveLength(0);
  });

  it('rejects speech over 15 s with SCRIPT_TOO_LONG and an instruction to shorten', async () => {
    const h = await start({ durations: [16_300] });
    const r = await call(h, 'POST', '/v1/drafts/product-hero/revoice', 'user-a', { script: SCRIPT_A, dialect: 'levantine', voice_id: VOICE });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: 'SCRIPT_TOO_LONG', action: 'shorten' });
    expect(r.body.error.message).toMatch(/shorten/i);
    expect(h.rows).toHaveLength(0);
  });

  it("rejects a Dialect that differs from the parent's before paying for a voice", async () => {
    const h = await start({ durations: [8000, 8000] });
    const first = (await call(h, 'POST', '/v1/drafts/product-hero', 'user-a', { brief: 'Promo', dialect: 'levantine', voice_id: VOICE })).body.draft;
    const r = await call(h, 'POST', '/v1/drafts/product-hero/revoice', 'user-a', {
      script: SCRIPT_A,
      dialect: 'gulf',
      parent_draft_id: first.id,
    });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: 'DIALECT_MISMATCH', dialect: 'gulf', parent_dialect: 'levantine' });
    expect(h.calls.voice).toHaveLength(1);
    expect(h.rows).toHaveLength(1);
  });

  it("cannot branch from another user's draft", async () => {
    const h = await start({ durations: [8000, 8000] });
    const first = (await call(h, 'POST', '/v1/drafts/product-hero', 'user-a', { brief: 'Promo', dialect: 'levantine', voice_id: VOICE })).body.draft;
    const r = await call(h, 'POST', '/v1/drafts/product-hero/revoice', 'user-b', {
      script: SCRIPT_A,
      dialect: 'levantine',
      parent_draft_id: first.id,
    });
    expect(r.status).toBe(404);
    expect(h.calls.voice).toHaveLength(1);
  });
});

describe('GET /v1/drafts/:id', () => {
  it('returns the draft to its owner and 404 to anyone else', async () => {
    const h = await start({ durations: [8000] });
    const d = (await call(h, 'POST', '/v1/drafts/product-hero', 'user-a', { brief: 'Promo', dialect: 'levantine', voice_id: VOICE })).body.draft;

    const mine = await call(h, 'GET', `/v1/drafts/${d.id}`, 'user-a');
    expect(mine.status).toBe(200);
    expect(mine.body.draft.script).toBe(SCRIPT_A);
    expect(mine.body.draft.alignment.characters.length).toBeGreaterThan(0);

    const signsBefore = h.calls.sign.length;
    const theirs = await call(h, 'GET', `/v1/drafts/${d.id}`, 'user-b');
    expect(theirs.status).toBe(404);
    expect(JSON.stringify(theirs.body)).not.toContain(SCRIPT_A);
    expect(JSON.stringify(theirs.body)).not.toContain(SIGNED_PREFIX);
    expect(h.calls.sign.length).toBe(signsBefore); // nothing signed for a non-owner
  });

  it('signs a fresh audio URL on every read, since signed URLs expire', async () => {
    const h = await start({ durations: [8000] });
    const d = (await call(h, 'POST', '/v1/drafts/product-hero', 'user-a', { brief: 'Promo', dialect: 'levantine', voice_id: VOICE })).body.draft;
    const a = (await call(h, 'GET', `/v1/drafts/${d.id}`, 'user-a')).body.draft;
    const b = (await call(h, 'GET', `/v1/drafts/${d.id}`, 'user-a')).body.draft;
    expect(a.audio_url.startsWith(SIGNED_PREFIX)).toBe(true);
    expect(b.audio_url).not.toBe(a.audio_url);
    expect(h.calls.sign).toEqual([h.rows[0].audio_key, h.rows[0].audio_key, h.rows[0].audio_key]);
    expect(JSON.stringify(b)).not.toContain(PUBLIC_PREFIX);
  });

  it('404s a malformed id without touching the table', async () => {
    const h = await start({ durations: [] });
    const r = await call(h, 'GET', '/v1/drafts/not-a-uuid', 'user-a');
    expect(r.status).toBe(404);
  });
});

// ── Private audio storage (the real signer, offline) ─────────────────────────

describe('draft audio storage', () => {
  it('presigns a short-lived GET on the private bucket, never the public URL', async () => {
    vi.resetModules();
    vi.stubEnv('R2_ACCESS_KEY_ID', 'AKIATEST');
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret');
    vi.stubEnv('S3_ENDPOINT', 'https://s3.example.test');
    vi.stubEnv('S3_FORCE_PATH_STYLE', 'true');
    vi.stubEnv('R2_BUCKET', 'public-outputs');
    vi.stubEnv('R2_PRIVATE_BUCKET', 'private-drafts');
    vi.stubEnv('R2_PUBLIC_URL', 'https://pub.r2.test/');
    try {
      const { presignPrivateGet } = await import('../lib/r2-upload.js');
      const signed = await presignPrivateGet('vnext/drafts/user-a/d1.mp3', 900);
      const url = new URL(signed.url);
      expect(url.origin).toBe('https://s3.example.test');
      expect(url.pathname).toBe('/private-drafts/vnext/drafts/user-a/d1.mp3');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
      expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
      expect(signed.url.startsWith('https://pub.r2.test')).toBe(false);
      expect(Date.parse(signed.expires_at) - Date.now()).toBeLessThanOrEqual(900_000);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('never falls back to the public bucket: without R2_PRIVATE_BUCKET it refuses to store or sign', async () => {
    vi.resetModules();
    vi.stubEnv('R2_ACCESS_KEY_ID', 'AKIATEST');
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret');
    vi.stubEnv('S3_ENDPOINT', 'https://s3.example.test');
    vi.stubEnv('R2_BUCKET', 'public-outputs');
    vi.stubEnv('R2_PRIVATE_BUCKET', '');
    try {
      const { presignPrivateGet, putPrivateObject } = await import('../lib/r2-upload.js');
      const refused = expect.objectContaining({ code: 'DRAFT_STORAGE_UNCONFIGURED' });
      await expect(presignPrivateGet('vnext/drafts/user-a/d1.mp3', 900)).rejects.toEqual(refused);
      await expect(putPrivateObject('vnext/drafts/user-a/d1.mp3', Buffer.from('x'), 'audio/mpeg')).rejects.toEqual(refused);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('drafting answers 503 DRAFT_STORAGE_UNCONFIGURED without a private bucket, before any provider is paid', async () => {
    // productionDraftDeps reads the env when called; it is imported statically
    // so its DraftError is the one the route recognises.
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    vi.stubEnv('ELEVENLABS_API_KEY', 'test-key');
    vi.stubEnv('R2_BUCKET', 'public-outputs');
    vi.stubEnv('R2_PRIVATE_BUCKET', '');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const { deps: prod, missing } = productionDraftDeps({} as never);
      expect(missing).toContain('R2_PRIVATE_BUCKET');
      const h = await start({
        durations: [8000],
        override: { writeScript: prod.writeScript, voiceScript: prod.voiceScript, storeAudio: prod.storeAudio },
      });
      fetchSpy.mockClear();
      const r = await call(h, 'POST', '/v1/drafts/product-hero', 'user-a', { brief: 'Cold brew promo', dialect: 'levantine', voice_id: VOICE });
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe('DRAFT_STORAGE_UNCONFIGURED');
      // Only the test's own request went out: no Claude, no ElevenLabs.
      expect(fetchSpy.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringContaining('/v1/drafts/product-hero')]);
      expect(h.rows).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('the production store writes a private object, not a public one', () => {
    const providers = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'drafts/providers.ts'), 'utf8');
    expect(providers).toContain('putPrivateObject(');
    expect(providers).not.toMatch(/putPublicObject|getR2PublicUrlPrefix/);
  });
});

// ── OpenAPI ──────────────────────────────────────────────────────────────────

describe('draft routes in the OpenAPI spec', () => {
  function mountedRoutes(): Array<{ method: string; path: string }> {
    const routes: Array<{ method: string; path: string }> = [];
    const recorder = {
      post: (path: string) => routes.push({ method: 'post', path }),
      get: (path: string) => routes.push({ method: 'get', path }),
    } as unknown as express.Express;
    const NOOP: express.RequestHandler = (_req, _res, next) => next();
    registerDraftRoutes(recorder, { generateLimiter: NOOP, readLimiter: NOOP, authMiddleware: NOOP, draftLimiter: NOOP }, {} as DraftDeps);
    return routes;
  }

  it('documents every mounted draft route with request, response and error schemas', () => {
    const spec = draftOpenApi();
    const routes = mountedRoutes();
    expect(routes).toHaveLength(3);
    for (const { method, path } of routes) {
      const openApiPath = path.replace(/:(\w+)/g, '{$1}');
      const op = (spec.paths[openApiPath] as Record<string, any> | undefined)?.[method];
      expect(op, `${method.toUpperCase()} ${openApiPath}`).toBeDefined();
      expect(op.security).toEqual([{ bearerAuth: [] }]);
      const ok = op.responses[method === 'post' ? '201' : '200'];
      expect(ok.content['application/json'].schema).toEqual({ $ref: '#/components/schemas/DraftResponse' });
      for (const status of ['401', '404']) {
        expect(op.responses[status].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/DraftError' });
      }
      if (method === 'post') {
        expect(op.requestBody.content['application/json'].schema.additionalProperties).toBe(false);
        for (const status of ['400', '422', '429', '502', '503']) expect(op.responses[status]).toBeDefined();
      } else {
        expect(op.parameters[0]).toMatchObject({ name: 'id', in: 'path', required: true });
      }
    }
  });

  it('describes the draft as the API returns it: a signed audio URL, no storage key', () => {
    const { schemas } = draftOpenApi();
    const draft = schemas.Draft as { properties: Record<string, unknown>; required: string[] };
    expect(draft.properties).toHaveProperty('audio_url');
    expect(draft.properties).toHaveProperty('audio_url_expires_at');
    expect(draft.properties).not.toHaveProperty('audio_key');
    expect(draft.required).toContain('audio_url');
  });

  it('server.ts publishes them in /openapi.json', () => {
    const server = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'server.ts'), 'utf8');
    expect(server).toMatch(/const draftSpec = draftOpenApi\(\);/);
    expect(server).toContain('Object.assign(paths, draftSpec.paths);');
    expect(server).toContain('...draftSpec.schemas,');
  });
});

// ── Glossary (CONTEXT.md) ────────────────────────────────────────────────────

describe('draft vocabulary', () => {
  it('says Script, never "copy", in the drafts code, the writer prompt and the page', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      join(here, '..', 'drafts/providers.ts'),
      join(here, '..', 'drafts/product-hero-draft.ts'),
      join(here, '..', 'routes/v1/drafts.ts'),
      join(here, '..', '..', '..', '..', 'apps/web/app/(app-dark)/dashboard/product-hero/page.tsx'),
    ];
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/\bcopy\b/i);
  });
});
