// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Captions after the render (#22), through the real HTTP routes with the
// database and Temporal faked at the seam (ShortCaptionDeps).
//
// What must hold: only the owner of a finished Short reads its suggested lines
// (the draft alignment cut by #10's cue rules) or exports it; anyone else gets
// 404. An export burns the edited lines onto the CLEAN Short (also for a render
// made with #10's toggle on); bad lines or styles are refused with 422 and one
// actionable code per problem before anything starts; the Idempotency-Key is
// bound to the body like every other run.

import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { CAPTION_LINE_LIMITS, DEFAULT_CAPTION_STYLE, suggestedCaptionLines, type CharacterAlignment } from '@agentmedia/schema';
import { registerShortCaptionRoutes, shortCaptionOpenApi } from '../routes/v1/shorts.js';
import {
  ExportUnconfiguredError,
  cleanShortUrl,
  type CaptionExportWorkflowInput,
  type ShortCaptionDeps,
  type ShortRun,
  type ShortStep,
  type StoredExport,
} from '../captions/short-captions.js';

const OWNER = 'user-owner';
const OTHER = 'user-other';
const SHORT = '11111111-0000-4000-8000-000000000001';
const DRAFT = '22222222-0000-4000-8000-000000000001';
const CLEAN = 'https://r2.test/vnext/mix/product-hero.mp4';

const SCRIPT = '[confidently] رومي رويال، فريش وراقية. [softly] جِلد ومِسك.';
function alignmentOf(text: string, step = 0.1): CharacterAlignment {
  const chars = [...text];
  return {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => +(i * step).toFixed(3)),
    character_end_times_seconds: chars.map((_, i) => +((i + 1) * step).toFixed(3)),
  };
}
const ALIGNMENT = alignmentOf(SCRIPT);
const DURATION_MS = 6_400;

function renderRun(over: Partial<ShortRun> = {}): ShortRun {
  return {
    id: SHORT,
    user_id: OWNER,
    skill_slug: 'make_product_hero',
    status: 'succeeded',
    input: { draft_id: DRAFT },
    final_output: { video_url: CLEAN, duration_ms: DURATION_MS, audio_duration_ms: 6_380, draft_id: DRAFT },
    ...over,
  };
}

interface Harness {
  baseUrl: string;
  runs: ShortRun[];
  steps: Record<string, ShortStep[]>;
  exports: Array<StoredExport & { user_id: string; idempotency_key: string | null; error_code?: string }>;
  started: Array<{ workflowId: string; input: CaptionExportWorkflowInput }>;
  startFails: Error | null;
  close(): Promise<void>;
}

const servers: Harness[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
});

async function start(): Promise<Harness> {
  let seq = 0;
  const h = { runs: [renderRun()], steps: {}, exports: [], started: [], startFails: null } as unknown as Harness;
  const deps: ShortCaptionDeps = {
    getRun: async (id, userId) => h.runs.find((r) => r.id === id && r.user_id === userId) ?? null,
    getSteps: async (runId) => h.steps[runId] ?? [],
    getDraftAlignment: async (id, userId) => (id === DRAFT && userId === OWNER ? ALIGNMENT : null),
    exports: {
      findByKey: async (userId, key) => h.exports.find((e) => e.user_id === userId && e.idempotency_key === key) ?? null,
      insert: async (row) => {
        if (row.idempotency_key && h.exports.some((e) => e.user_id === row.user_id && e.idempotency_key === row.idempotency_key)) return 'conflict';
        const id = `33333333-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
        h.exports.push({ id, status: 'submitted', input: row.input, request_fingerprint: row.request_fingerprint, user_id: row.user_id, idempotency_key: row.idempotency_key });
        return { id };
      },
      fail: async (id, code) => {
        const e = h.exports.find((x) => x.id === id)!;
        e.status = 'failed';
        e.error_code = code;
      },
    },
    startExport: async (workflowId, input) => {
      if (h.startFails) throw h.startFails;
      h.started.push({ workflowId, input });
    },
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
  registerShortCaptionRoutes(app, { generateLimiter: NOOP, readLimiter: NOOP, authMiddleware: auth }, deps);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  h.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  h.close = () => new Promise<void>((r) => server.close(() => r()));
  servers.push(h);
  return h;
}

async function call(h: Harness, method: string, path: string, user: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${h.baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const captionsPath = (id = SHORT) => `/v1/shorts/${id}/captions`;
const exportPath = (id = SHORT) => `/v1/shorts/${id}/caption-exports`;
const LINES = [
  { text: 'رومي رويال،', start: 1.3, end: 2.4 },
  { text: ' فريش\nوراقية. ', start: 2.4, end: 3.9 },
  { text: 'جلد ومسك', start: 4.1, end: 5.5 },
];
const STYLE = { position: 'top', size: 'l', colour: 'yellow' };

// ── Suggested lines ──────────────────────────────────────────────────────────

describe('GET /v1/shorts/:id/captions', () => {
  it("gives the owner the suggested lines from the draft alignment, over the clean Short, with the style whitelist", async () => {
    const h = await start();
    const r = await call(h, 'GET', captionsPath(), OWNER);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ short_id: SHORT, video_url: CLEAN, duration_ms: DURATION_MS, style: DEFAULT_CAPTION_STYLE });
    expect(r.body.lines).toEqual(suggestedCaptionLines(ALIGNMENT, DURATION_MS / 1000));
    const shown = r.body.lines.map((l: { text: string }) => l.text).join(' ');
    expect(shown).not.toMatch(/\[|softly|confidently/); // no Delivery Tags
    expect(shown).toContain('جلد ومسك'); // no diacritics
    expect(r.body.options).toMatchObject({ positions: ['lower_third', 'centre', 'top'], sizes: ['s', 'm', 'l'], limits: CAPTION_LINE_LIMITS });
  });

  it("is 404 for someone who isn't the owner, an unknown id, a malformed id and a run that is not a Short", async () => {
    const h = await start();
    h.runs.push(renderRun({ id: '11111111-0000-4000-8000-000000000009', skill_slug: 'make_portrait' }));
    for (const [user, path] of [
      [OTHER, captionsPath()],
      [OWNER, captionsPath('11111111-0000-4000-8000-00000000abcd')],
      [OWNER, captionsPath('not-a-uuid')],
      [OWNER, captionsPath('11111111-0000-4000-8000-000000000009')],
    ] as const) {
      const r = await call(h, 'GET', path, user);
      expect(r.status, path).toBe(404);
      expect(r.body.error.code).toBe('not_found');
    }
  });

  it('needs auth', async () => {
    const h = await start();
    expect((await call(h, 'GET', captionsPath(), null)).status).toBe(401);
  });

  it('is 409 short_not_ready while the render runs', async () => {
    const h = await start();
    h.runs[0] = renderRun({ status: 'running', final_output: null });
    const r = await call(h, 'GET', captionsPath(), OWNER);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('short_not_ready');
  });

  it('is 422 captions_unavailable when the draft has no words', async () => {
    const h = await start();
    h.runs[0] = renderRun({ input: { draft_id: '22222222-0000-4000-8000-00000000ffff' } });
    const r = await call(h, 'GET', captionsPath(), OWNER);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('captions_unavailable');
  });

  it('for a render made with #10’s toggle on, previews over the clean file from before the burn', async () => {
    const h = await start();
    h.runs[0] = renderRun({ final_output: { video_url: 'https://r2.test/captioned.mp4', duration_ms: DURATION_MS, captions: true } });
    h.steps[SHORT] = [
      { primitive_id: 'product_hero_mux', status: 'succeeded', artifacts: [{ kind: 'short', url: 'https://r2.test/mux.mp4' }] },
      { primitive_id: 'music_bed_mix', status: 'succeeded', artifacts: [{ kind: 'short', url: CLEAN }] },
      { primitive_id: 'arabic_captions', status: 'succeeded', artifacts: [{ kind: 'short', url: 'https://r2.test/captioned.mp4' }] },
    ];
    expect((await call(h, 'GET', captionsPath(), OWNER)).body.video_url).toBe(CLEAN);
  });
});

describe('cleanShortUrl', () => {
  it('is the output itself since #22; the mux when a legacy render had no Music Bed; null when none is found', () => {
    expect(cleanShortUrl({ video_url: CLEAN }, [])).toBe(CLEAN);
    const mux: ShortStep = { primitive_id: 'product_hero_mux', status: 'succeeded', artifacts: [{ kind: 'short', url: 'https://r2.test/mux.mp4' }] };
    expect(cleanShortUrl({ video_url: 'x', captions: true }, [mux])).toBe('https://r2.test/mux.mp4');
    expect(cleanShortUrl({ video_url: 'x', captions: true }, [])).toBeNull();
  });
});

// ── Export ───────────────────────────────────────────────────────────────────

describe('POST /v1/shorts/:id/caption-exports', () => {
  it('starts one free export job: the edited lines (texts tidied) and style, burned onto the clean Short', async () => {
    const h = await start();
    const r = await call(h, 'POST', exportPath(), OWNER, { lines: LINES, style: STYLE }, { 'Idempotency-Key': 'exp-1' });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ short_id: SHORT, status: 'submitted' });
    expect(r.body.workflow_id).toBe(`caption_export-${r.body.skill_run_id}`);

    expect(h.started).toHaveLength(1);
    const { workflowId, input } = h.started[0];
    expect(workflowId).toBe(r.body.workflow_id);
    expect(input).toEqual({
      skill_run_id: r.body.skill_run_id,
      user_id: OWNER,
      short_id: SHORT,
      short_url: CLEAN,
      duration_ms: DURATION_MS,
      audio_duration_ms: 6_380,
      preset: 'product_hero',
      aspect_ratio: '9:16',
      lines: [LINES[0], { text: 'فريش وراقية.', start: 2.4, end: 3.9 }, LINES[2]],
      style: STYLE,
    });
    // The run records the Short it belongs to, what was burned, and the key's fingerprint.
    expect(h.exports[0]).toMatchObject({ input: { short_id: SHORT, style: STYLE }, idempotency_key: 'exp-1' });
    expect(h.exports[0].request_fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses #10’s look when no style is sent', async () => {
    const h = await start();
    expect((await call(h, 'POST', exportPath(), OWNER, { lines: LINES })).status).toBe(202);
    expect(h.started[0].input.style).toEqual(DEFAULT_CAPTION_STYLE);
  });

  it("is 404 for someone who isn't the owner, and starts nothing", async () => {
    const h = await start();
    const r = await call(h, 'POST', exportPath(), OTHER, { lines: LINES, style: STYLE });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('not_found');
    expect(h.started).toEqual([]);
    expect(h.exports).toEqual([]);
  });

  it.each([
    ['overlapping lines', [{ text: 'أ', start: 1, end: 3 }, { text: 'ب', start: 2, end: 4 }], ['overlap@1']],
    ['lines out of order', [{ text: 'أ', start: 3, end: 4 }, { text: 'ب', start: 1, end: 2 }], ['out_of_order@1']],
    ['a line past the Short', [{ text: 'أ', start: 6, end: 7 }], ['outside_short@0']],
    ['an empty and an over-long line', [{ text: '  ', start: 0, end: 1 }, { text: 'ب'.repeat(CAPTION_LINE_LIMITS.maxChars + 1), start: 1, end: 2 }], ['empty_text@0', 'text_too_long@1']],
    ['no lines', [], ['no_lines@null']],
    ['too many lines', Array.from({ length: CAPTION_LINE_LIMITS.maxLines + 1 }, (_, i) => ({ text: 'أ', start: i * 0.1, end: i * 0.1 + 0.1 })), ['too_many_lines@null']],
  ])('refuses %s with 422 invalid_caption_lines and actionable codes, before starting anything', async (_label, lines, expected) => {
    const h = await start();
    const r = await call(h, 'POST', exportPath(), OWNER, { lines, style: STYLE });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('invalid_caption_lines');
    const got = (r.body.error.issues as Array<{ code: string; line: number | null; message: string }>).map((i) => `${i.code}@${i.line}`);
    for (const e of expected) expect(got).toContain(e);
    expect(r.body.error.message).toBe(r.body.error.issues[0].message);
    expect(h.started).toEqual([]);
    expect(h.exports).toEqual([]);
  });

  it('refuses a style off the whitelist with style_not_allowed (422)', async () => {
    const h = await start();
    for (const style of [{ ...STYLE, colour: '#FF0000' }, { ...STYLE, position: 'bottom' }, { ...STYLE, size: '{\\fs300}' }]) {
      const r = await call(h, 'POST', exportPath(), OWNER, { lines: LINES, style });
      expect(r.status).toBe(422);
      expect(r.body.error.issues.map((i: { code: string }) => i.code)).toEqual(['style_not_allowed']);
    }
    expect(h.started).toEqual([]);
  });

  it('refuses a body of the wrong shape with 400 INVALID_INPUT (extra fields included)', async () => {
    const h = await start();
    for (const body of [{}, { lines: 'x' }, { lines: [{ text: 'أ', start: '0', end: 1 }] }, { lines: LINES, style: STYLE, font: 'Arial' }]) {
      const r = await call(h, 'POST', exportPath(), OWNER, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error.code).toBe('INVALID_INPUT');
    }
  });

  it('is 409 short_not_ready while the render runs', async () => {
    const h = await start();
    h.runs[0] = renderRun({ status: 'running', final_output: null });
    expect((await call(h, 'POST', exportPath(), OWNER, { lines: LINES })).body.error.code).toBe('short_not_ready');
  });

  it('replays the same Idempotency-Key and body as the original export; the same key with other lines is 409', async () => {
    const h = await start();
    const key = { 'Idempotency-Key': 'exp-replay' };
    const first = await call(h, 'POST', exportPath(), OWNER, { lines: LINES, style: STYLE }, key);
    const again = await call(h, 'POST', exportPath(), OWNER, { lines: LINES, style: STYLE }, key);
    expect(again.status).toBe(202);
    expect(again.body).toMatchObject({ skill_run_id: first.body.skill_run_id, short_id: SHORT, idempotent_replay: true });
    const edited = await call(h, 'POST', exportPath(), OWNER, { lines: LINES.slice(0, 2), style: STYLE }, key);
    expect(edited.status).toBe(409);
    // The same 409 body every run path sends (skills/idempotency.ts).
    expect(edited.body).toEqual({
      error: 'idempotency_key_reused',
      skill: 'caption_export',
      run_id: first.body.skill_run_id,
      detail: expect.stringContaining('Use a new key'),
    });
    expect(h.started).toHaveLength(1);
  });

  it('every export without a key (or with a new one) is a new file', async () => {
    const h = await start();
    await call(h, 'POST', exportPath(), OWNER, { lines: LINES, style: STYLE });
    await call(h, 'POST', exportPath(), OWNER, { lines: LINES, style: STYLE });
    expect(h.started).toHaveLength(2);
    expect(new Set(h.exports.map((e) => e.id)).size).toBe(2);
  });

  it('a dispatch failure fails the export run (502), and 503 without Temporal', async () => {
    const h = await start();
    h.startFails = new Error('temporal down');
    const r = await call(h, 'POST', exportPath(), OWNER, { lines: LINES });
    expect(r.status).toBe(502);
    expect(h.exports[0]).toMatchObject({ status: 'failed', error_code: 'temporal_dispatch_failed' });
    h.startFails = new ExportUnconfiguredError('no TEMPORAL_ADDRESS');
    expect((await call(h, 'POST', exportPath(), OWNER, { lines: LINES })).status).toBe(503);
  });
});

describe('OpenAPI', () => {
  it('describes both routes and every refusal code', () => {
    const spec = shortCaptionOpenApi();
    expect(Object.keys(spec.paths)).toEqual(['/v1/shorts/{id}/captions', '/v1/shorts/{id}/caption-exports']);
    const text = JSON.stringify(spec);
    for (const code of ['not_found', 'short_not_ready', 'invalid_caption_lines', 'style_not_allowed', 'idempotency_key_reused', 'overlap', 'outside_short']) {
      expect(text).toContain(code);
    }
  });
});
