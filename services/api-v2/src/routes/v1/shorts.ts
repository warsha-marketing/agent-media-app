// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Captions after the render (#22). The logic lives in captions/short-captions.ts;
 * this file is only HTTP.
 *
 *   GET  /v1/shorts/:id/captions         → 200 { short_id, video_url, duration_ms,
 *                                                lines, style, options }
 *   POST /v1/shorts/:id/caption-exports  { lines, style }  (Idempotency-Key)
 *                                        → 202 { skill_run_id, workflow_id, short_id, status }
 *
 * `:id` is the Short's render run id. Owner only (404 otherwise). The export is
 * polled at GET /v1/skills/runs/:skill_run_id; its final_output carries the new
 * file (video_url) and the Short it belongs to (short_id). Free.
 *
 * Errors are `{ error: { code, message, … } }`; the codes are SHORT_CAPTION_REFUSALS
 * plus INVALID_INPUT (400, body shape). idempotency_key_reused (409) is the
 * body every run path sends (sendIdempotencyKeyReused).
 */

import type express from 'express';
import type { RequestHandler, Response } from 'express';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  CAPTION_EXPORT_SLUG,
  CaptionExportBodySchema,
  ExportUnconfiguredError,
  SHORT_CAPTION_REFUSALS,
  ShortCaptionError,
  checkExportRequest,
  resolveFinishedShort,
  suggestedCaptions,
  type ShortCaptionDeps,
  type StoredExport,
} from '../../captions/short-captions.js';
import {
  IDEMPOTENCY_KEY_REUSED,
  readIdempotencyKey,
  replayMatches,
  requestFingerprint,
  sendIdempotencyKeyReused,
} from '../../skills/idempotency.js';
import { isUuid } from '../../lib/uuid.js';
import { sendInvalidInput, userOf } from './route-helpers.js';
import { CAPTION_COLOURS, CAPTION_POSITIONS, CAPTION_SIZES } from '@agentmedia/schema';

interface ShortRouteMiddleware {
  generateLimiter: RequestHandler;
  readLimiter: RequestHandler;
  authMiddleware: RequestHandler;
}

function sendError(res: Response, err: unknown, tag: string): void {
  if (err instanceof ShortCaptionError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.details } });
    return;
  }
  console.error(`[v1 shorts/${tag}] ${(err as Error)?.message ?? 'unknown error'}`);
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong. Try again in a moment.' } });
}

const workflowIdOf = (runId: string) => `${CAPTION_EXPORT_SLUG}-${runId}`;

export function registerShortCaptionRoutes(app: express.Express, middleware: ShortRouteMiddleware, deps: ShortCaptionDeps): void {
  const { generateLimiter, readLimiter, authMiddleware } = middleware;
  const notFound = (res: Response) => sendError(res, new ShortCaptionError('not_found', 'No such Short on this account.'), 'id');

  app.get('/v1/shorts/:id/captions', readLimiter, authMiddleware, async (req, res) => {
    const id = String(req.params.id ?? '');
    if (!isUuid(id)) return notFound(res);
    try {
      res.status(200).json(await suggestedCaptions(deps, userOf(req), id));
    } catch (err) {
      sendError(res, err, 'captions');
    }
  });

  app.post('/v1/shorts/:id/caption-exports', generateLimiter, authMiddleware, async (req, res) => {
    const userId = userOf(req);
    const shortId = String(req.params.id ?? '');
    if (!isUuid(shortId)) return notFound(res);
    const parsed = CaptionExportBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendInvalidInput(res, parsed.error.issues, 'body');

    // The key names THIS request: the Short plus the body as sent (defaults applied).
    const key = readIdempotencyKey(req);
    const fingerprint = requestFingerprint(CAPTION_EXPORT_SLUG, { short_id: shortId, ...parsed.data });
    const replay = (run: StoredExport) => {
      if (!replayMatches(run.request_fingerprint, fingerprint)) return sendIdempotencyKeyReused(res, CAPTION_EXPORT_SLUG, run.id);
      res.status(202).json({
        skill_run_id: run.id,
        workflow_id: workflowIdOf(run.id),
        short_id: (run.input?.short_id as string | undefined) ?? shortId,
        status: run.status,
        idempotent_replay: true,
      });
    };

    try {
      if (key) {
        const existing = await deps.exports.findByKey(userId, key);
        if (existing) return replay(existing);
      }

      const short = await resolveFinishedShort(deps, userId, shortId);
      const { lines, style } = checkExportRequest(parsed.data, short.duration_ms);

      const inserted = await deps.exports.insert({
        user_id: userId,
        input: { short_id: short.id, lines, style },
        idempotency_key: key,
        request_fingerprint: key ? fingerprint : null,
      });
      if (inserted === 'conflict') {
        // A concurrent same-key request won the unique index: that export is the answer.
        const dup = key ? await deps.exports.findByKey(userId, key) : null;
        if (dup) return replay(dup);
        throw new Error('export insert conflicted without a key to replay');
      }

      const workflowId = workflowIdOf(inserted.id);
      try {
        await deps.startExport(workflowId, {
          skill_run_id: inserted.id,
          user_id: userId,
          short_id: short.id,
          short_url: short.clean_url,
          duration_ms: short.duration_ms,
          audio_duration_ms: short.audio_duration_ms,
          preset: short.preset,
          aspect_ratio: short.aspect_ratio,
          lines,
          style,
        });
      } catch (err) {
        const unconfigured = err instanceof ExportUnconfiguredError;
        const code = unconfigured ? 'temporal_unconfigured' : 'temporal_dispatch_failed';
        const message = (err as Error)?.message ?? 'dispatch failed';
        await deps.exports.fail(inserted.id, code, message).catch(() => undefined);
        res.status(unconfigured ? 503 : 502).json({ error: { code, message: 'The export could not be started. Try again in a moment.' } });
        return;
      }

      res.status(202).json({ skill_run_id: inserted.id, workflow_id: workflowId, short_id: short.id, status: 'submitted' });
    } catch (err) {
      sendError(res, err, 'caption-exports');
    }
  });
}

// ── OpenAPI ──────────────────────────────────────────────────────────────────

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ShortCaptionError' } } },
});

const refusals = (status: number) =>
  (Object.keys(SHORT_CAPTION_REFUSALS) as Array<keyof typeof SHORT_CAPTION_REFUSALS>)
    .filter((c) => SHORT_CAPTION_REFUSALS[c].status === status)
    .map((c) => `\`${c}\`: ${SHORT_CAPTION_REFUSALS[c].when}`)
    .join('. ');

const LINE = {
  type: 'object',
  properties: { text: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' } },
  required: ['text', 'start', 'end'],
};

/** Paths and component schemas for the Caption editor routes, merged into /openapi.json by server.ts. */
export function shortCaptionOpenApi(): { paths: Record<string, unknown>; schemas: Record<string, unknown> } {
  const id = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: "The Short: its render's skill_run_id." };
  const body = zodToJsonSchema(CaptionExportBodySchema, { name: 'caption_export_body', $refStrategy: 'none' }) as {
    definitions?: Record<string, unknown>;
  };
  return {
    paths: {
      '/v1/shorts/{id}/captions': {
        get: {
          operationId: 'getShortCaptions',
          summary:
            "Suggested caption lines for a finished Short: its draft's voice alignment cut line by line (no Delivery Tags, no diacritics), the clean Short to preview them over, the default style and the allowed styles and limits. Owner only.",
          tags: ['captions'],
          security: [{ bearerAuth: [] }],
          parameters: [id],
          responses: {
            '200': {
              description: 'The suggested lines',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      short_id: { type: 'string', format: 'uuid' },
                      video_url: { type: 'string', format: 'uri', description: 'The clean Short (no Captions).' },
                      duration_ms: { type: 'integer' },
                      lines: { type: 'array', items: LINE },
                      style: { $ref: '#/components/schemas/CaptionStyle' },
                      options: { type: 'object', description: 'positions, sizes, colours (name → #RRGGBB) and limits (maxLines, maxChars, minSeconds).' },
                    },
                  },
                },
              },
            },
            '401': errorResponse('Unauthorized'),
            '404': errorResponse(refusals(404)),
            '409': errorResponse(refusals(409)),
            '422': errorResponse(`${SHORT_CAPTION_REFUSALS.clean_short_unavailable.when}; ${SHORT_CAPTION_REFUSALS.captions_unavailable.when}`),
          },
        },
      },
      '/v1/shorts/{id}/caption-exports': {
        post: {
          operationId: 'exportShortCaptions',
          summary:
            'Burn edited caption lines onto the clean Short (right-to-left Arabic, Noto Sans Arabic, audio untouched). Each export is a new file; poll GET /v1/skills/runs/{skill_run_id} — final_output.video_url is the captioned Short, final_output.short_id the Short. Free: no credits. Owner only.',
          tags: ['captions'],
          security: [{ bearerAuth: [] }],
          parameters: [
            id,
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: false,
              schema: { type: 'string', maxLength: 200 },
              description: 'A replay with the same key and body returns the original export (202, idempotent_replay: true); the same key with a different body is refused (409 idempotency_key_reused).',
            },
          ],
          requestBody: { required: true, content: { 'application/json': { schema: body.definitions?.caption_export_body ?? body } } },
          responses: {
            '202': { description: 'Export submitted (or the original export on a replay): { skill_run_id, workflow_id, short_id, status }' },
            '400': errorResponse('`INVALID_INPUT`: the body is not { lines: [{ text, start, end }], style: { position, size, colour } }'),
            '401': errorResponse('Unauthorized'),
            '404': errorResponse(refusals(404)),
            '409': {
              description: `${refusals(409)}. ${IDEMPOTENCY_KEY_REUSED} (sent with the run-wide SkillError body, like POST /v1/skills/{slug}/run)`,
              content: {
                'application/json': {
                  schema: { oneOf: [{ $ref: '#/components/schemas/ShortCaptionError' }, { $ref: '#/components/schemas/SkillError' }] },
                },
              },
            },
            '422': errorResponse(refusals(422)),
            '502': errorResponse('`temporal_dispatch_failed`: the export could not be started'),
            '503': errorResponse('`temporal_unconfigured`'),
          },
        },
      },
    },
    schemas: {
      CaptionStyle: {
        type: 'object',
        properties: {
          position: { type: 'string', enum: [...CAPTION_POSITIONS] },
          size: { type: 'string', enum: [...CAPTION_SIZES] },
          colour: { type: 'string', enum: Object.keys(CAPTION_COLOURS) },
        },
        required: ['position', 'size', 'colour'],
      },
      ShortCaptionError: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              issues: {
                type: 'array',
                description: 'On invalid_caption_lines: every problem, { code, line (0-based, or null for the whole request), message }.',
                items: { type: 'object', properties: { code: { type: 'string' }, line: { type: ['integer', 'null'] }, message: { type: 'string' } } },
              },
            },
            required: ['code', 'message'],
          },
        },
        required: ['error'],
      },
    },
  };
}
