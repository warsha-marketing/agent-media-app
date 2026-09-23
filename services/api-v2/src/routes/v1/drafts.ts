// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Product Hero draft routes (#4). The logic lives in drafts/product-hero-draft.ts;
 * this file is only HTTP: validate, call, map DraftError to a status.
 *
 *   POST /v1/drafts/product-hero          { brief, dialect, voice_id }   → 201 { draft }
 *   POST /v1/drafts/product-hero/revoice  { script, dialect, voice_id?,
 *                                           parent_draft_id?, brief? }   → 201 { draft }
 *
 * voice_id is an Approved Voice of the Dialect (GET /v1/voices, #7); anything
 * else is refused with 422 VOICE_NOT_APPROVED before a provider is called.
 *   GET  /v1/drafts/:id                                                   → 200 { draft } | 404
 *
 * Free (no credits) — see the module header. `draftLimiter` runs AFTER auth so
 * it buckets per user. Every draft response carries a freshly signed, short-lived
 * `audio_url`; it is minted only after the ownership check.
 *
 * draftOpenApi() describes these routes for /openapi.json (server.ts merges it),
 * from the same zod schemas the routes validate with.
 */

import type express from 'express';
import type { Request, RequestHandler, Response } from 'express';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  CreateDraftInputSchema,
  DIALECTS,
  DraftError,
  MAX_SPEECH_MS,
  MIN_SPEECH_MS,
  RevoiceDraftInputSchema,
  createDraftFromBrief,
  revoiceDraft,
  toDraftView,
  type DraftDeps,
  type DraftRow,
} from '../../drafts/product-hero-draft.js';
import { isUuid } from '../../lib/uuid.js';

interface DraftRouteMiddleware {
  generateLimiter: RequestHandler;
  readLimiter: RequestHandler;
  authMiddleware: RequestHandler;
  draftLimiter: RequestHandler;
}

function sendDraftError(res: Response, err: unknown, tag: string): void {
  if (err instanceof DraftError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.details } });
    return;
  }
  const message = (err as Error)?.message ?? 'unknown error';
  console.error(`[v1 drafts/${tag}] ${message}`);
  // Provider-side failures (Claude, ElevenLabs, storage) are retryable by the caller.
  res.status(502).json({ error: { code: 'DRAFT_FAILED', message: 'Drafting failed upstream. Try again in a moment.' } });
}

function userOf(req: Request): string {
  return (req as { userId?: string }).userId as string;
}

function sendInvalidInput(res: Response, issues: { path: (string | number)[]; message: string }[]): void {
  const first = issues[0];
  res.status(400).json({
    error: {
      code: 'INVALID_INPUT',
      message: first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid input',
      issues,
    },
  });
}

export function registerDraftRoutes(app: express.Express, middleware: DraftRouteMiddleware, deps: DraftDeps): void {
  const { generateLimiter, readLimiter, authMiddleware, draftLimiter } = middleware;

  /** The owner's view of a draft, with a signed audio URL minted now. */
  const sendDraft = async (res: Response, status: number, row: DraftRow) => {
    res.status(status).json({ draft: toDraftView(row, await deps.signAudioUrl(row.audio_key)) });
  };

  app.post('/v1/drafts/product-hero', generateLimiter, authMiddleware, draftLimiter, async (req, res) => {
    const parsed = CreateDraftInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendInvalidInput(res, parsed.error.issues);
    try {
      await sendDraft(res, 201, await createDraftFromBrief(deps, userOf(req), parsed.data));
    } catch (err) {
      sendDraftError(res, err, 'create');
    }
  });

  app.post('/v1/drafts/product-hero/revoice', generateLimiter, authMiddleware, draftLimiter, async (req, res) => {
    const parsed = RevoiceDraftInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendInvalidInput(res, parsed.error.issues);
    try {
      await sendDraft(res, 201, await revoiceDraft(deps, userOf(req), parsed.data));
    } catch (err) {
      sendDraftError(res, err, 'revoice');
    }
  });

  app.get('/v1/drafts/:id', readLimiter, authMiddleware, async (req, res) => {
    const id = String(req.params.id ?? '');
    const notFound = () => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Draft not found.' } });
    if (!isUuid(id)) return void notFound();
    try {
      // Owner-scoped lookup: another user's draft is indistinguishable from none.
      const row = await deps.repo.getOwned(id, userOf(req));
      if (!row) return void notFound();
      await sendDraft(res, 200, row);
    } catch (err) {
      sendDraftError(res, err, 'get');
    }
  });
}

// ── OpenAPI ──────────────────────────────────────────────────────────────────

function bodySchema(schema: unknown, name: string): Record<string, unknown> {
  const js = zodToJsonSchema(schema as Parameters<typeof zodToJsonSchema>[0], { name, $refStrategy: 'none' });
  return ((js as { definitions?: Record<string, Record<string, unknown>> }).definitions?.[name] ?? js) as Record<string, unknown>;
}

const json = (ref: string) => ({ content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } } });
const draftError = (description: string) => ({ description, ...json('DraftError') });

const DRAFT_ERRORS = {
  '401': draftError('Unauthorized'),
  '404': draftError('NOT_FOUND: no such draft on this account'),
  '429': draftError('RATE_LIMITED: per-user draft ceiling'),
  '502': draftError('DRAFT_FAILED / SCRIPT_GENERATION_FAILED: an upstream provider failed; retryable'),
  '503': draftError(
    'DRAFTING_UNCONFIGURED: this server lacks a provider key / DRAFT_STORAGE_UNCONFIGURED: no private bucket (R2_PRIVATE_BUCKET) for draft audio',
  ),
};

/** Paths and component schemas for the draft routes, merged into /openapi.json by server.ts. */
export function draftOpenApi(): { paths: Record<string, unknown>; schemas: Record<string, unknown> } {
  const post = (operationId: string, summary: string, body: Record<string, unknown>, unprocessable: string) => ({
    post: {
      operationId,
      summary,
      tags: ['drafts'],
      security: [{ bearerAuth: [] }],
      requestBody: { required: true, content: { 'application/json': { schema: body } } },
      responses: {
        '201': { description: 'A new draft', ...json('DraftResponse') },
        '400': draftError('INVALID_INPUT; VOICE_REQUIRED (re-voice of a draft that has no catalog Voice, without voice_id)'),
        '422': draftError(unprocessable),
        ...DRAFT_ERRORS,
      },
    },
  });
  const voiceRefused = 'VOICE_NOT_APPROVED: voice_id is not an Approved Voice of the Dialect (unknown, pending, revoked or another Dialect)';
  const outOfBand = `SCRIPT_TOO_SHORT / SCRIPT_TOO_LONG: voiced speech outside ${MIN_SPEECH_MS / 1000}–${MAX_SPEECH_MS / 1000} s (carries action, duration_ms and the Script)`;
  return {
    paths: {
      '/v1/drafts/product-hero': post(
        'createProductHeroDraft',
        'Product Hero draft: write a diacritized Script for a Brief in a Dialect and voice it. Free (no credits).',
        bodySchema(CreateDraftInputSchema, 'create_draft_input'),
        `${outOfBand}; DIALECT_NOT_AVAILABLE; BRIEF_REFUSED; ${voiceRefused}`,
      ),
      '/v1/drafts/product-hero/revoice': post(
        'revoiceProductHeroDraft',
        "Voice an edited Script verbatim as a NEW draft. With parent_draft_id, the parent's Brief and Dialect carry over.",
        bodySchema(RevoiceDraftInputSchema, 'revoice_draft_input'),
        `${outOfBand}; DIALECT_MISMATCH (dialect differs from the parent's); DIALECT_NOT_AVAILABLE; ${voiceRefused}`,
      ),
      '/v1/drafts/{id}': {
        get: {
          operationId: 'getDraft',
          summary: 'Read one of your drafts, with a freshly signed audio URL.',
          tags: ['drafts'],
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: 'The draft', ...json('DraftResponse') }, ...DRAFT_ERRORS },
        },
      },
    },
    schemas: {
      Draft: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          preset: { type: 'string', enum: ['product_hero'] },
          dialect: { type: 'string', enum: [...DIALECTS] },
          brief: { type: ['string', 'null'] },
          script: { type: 'string', description: 'The diacritized Script that was voiced.' },
          script_source: { type: 'string', enum: ['generated', 'edited'] },
          parent_draft_id: { type: ['string', 'null'], format: 'uuid' },
          voice: {
            type: 'object',
            description: 'The Voice that spoke the Script.',
            properties: {
              id: { type: ['string', 'null'], format: 'uuid', description: 'The catalog Voice (GET /v1/voices); null on drafts made before the catalog.' },
              provider: { type: 'string' },
              provider_voice_id: { type: 'string' },
              model: { type: 'string' },
            },
            required: ['id', 'provider', 'provider_voice_id', 'model'],
          },
          audio_url: { type: 'string', format: 'uri', description: 'Short-lived signed URL for the private audio; re-read the draft for a fresh one.' },
          audio_url_expires_at: { type: 'string', format: 'date-time' },
          audio_mime: { type: 'string' },
          duration_ms: { type: 'integer', minimum: MIN_SPEECH_MS, maximum: MAX_SPEECH_MS, description: 'Measured from the audio.' },
          alignment: {
            type: 'object',
            properties: {
              characters: { type: 'array', items: { type: 'string' } },
              character_start_times_seconds: { type: 'array', items: { type: 'number' } },
              character_end_times_seconds: { type: 'array', items: { type: 'number' } },
            },
            required: ['characters', 'character_start_times_seconds', 'character_end_times_seconds'],
          },
          created_at: { type: 'string', format: 'date-time' },
          render_started_at: { type: ['string', 'null'], format: 'date-time', description: 'When a render of this draft first started.' },
          render_run_id: {
            type: ['string', 'null'],
            format: 'uuid',
            description: 'The make_product_hero run rendering (or that rendered) this draft; null when it is free to render. Released if that run fails or is canceled.',
          },
        },
        required: ['id', 'preset', 'dialect', 'script', 'script_source', 'voice', 'audio_url', 'audio_url_expires_at', 'audio_mime', 'duration_ms', 'alignment', 'created_at'],
      },
      DraftResponse: { type: 'object', properties: { draft: { $ref: '#/components/schemas/Draft' } }, required: ['draft'] },
      DraftError: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              action: { type: 'string', enum: ['shorten', 'lengthen'] },
              duration_ms: { type: 'integer' },
              min_ms: { type: 'integer' },
              max_ms: { type: 'integer' },
              script: { type: 'string', description: 'On SCRIPT_TOO_SHORT / SCRIPT_TOO_LONG: the Script, to edit and re-voice.' },
              dialect: { type: 'string' },
              parent_dialect: { type: 'string' },
              voice_id: { type: 'string', description: 'On VOICE_NOT_APPROVED: the refused Voice.' },
              available: { type: 'array', items: { type: 'string' } },
              issues: { type: 'array', items: { type: 'object' } },
            },
            required: ['code', 'message'],
          },
        },
        required: ['error'],
      },
    },
  };
}
