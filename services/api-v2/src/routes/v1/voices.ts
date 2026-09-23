// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Voice catalog routes (#7). The logic lives in voices/catalog.ts; this file is
 * only HTTP: validate, gate operators, call, map VoiceError to a status.
 *
 * Users (any signed-in caller):
 *   GET  /v1/voices?dialect=&gender=&style=      → 200 { voices, styles }   Approved Voices only
 *
 * Operators (ADMIN_EMAILS; everyone else gets 403 OPERATOR_ONLY):
 *   GET  /v1/operator/voices?state=&dialect=     → 200 { voices }           every Voice + review trail
 *   POST /v1/operator/voices                     → 201 { voice }            add a candidate (pending)
 *   POST /v1/operator/voices/:id/approve         → 200 { voice }            records approved_by/at
 *   POST /v1/operator/voices/:id/revoke          → 200 { voice }            records revoked_by/at
 *   GET  /v1/operator/voice-candidates?page=&dialect=&accent=&gender=&age=&use_case=&sort=&search=
 *                                                → 200 { candidates, has_more, page }  ElevenLabs shared library
 *
 * Approve a Voice only after a native speaker of its Dialect accepted its sample:
 *
 *   curl -X POST $API/v1/operator/voices -H "Authorization: Bearer $TOKEN" \
 *     -H 'Content-Type: application/json' -d '{"provider_voice_id":"…","display_name":"Layla",
 *     "dialect":"levantine","gender":"female","style":"warm","sample_url":"https://…"}'
 *   curl -X POST $API/v1/operator/voices/<id>/approve -H "Authorization: Bearer $TOKEN"
 *   curl -X POST $API/v1/operator/voices/<id>/revoke  -H "Authorization: Bearer $TOKEN"
 *
 * voiceOpenApi() describes these routes for /openapi.json (server.ts merges it).
 */

import type express from 'express';
import type { RequestHandler, Response } from 'express';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { DIALECTS } from '@agentmedia/schema';
import {
  AddVoiceInputSchema,
  CandidatesQuerySchema,
  ListVoicesQuerySchema,
  OperatorListQuerySchema,
  VOICE_GENDERS,
  VOICE_STATES,
  VoiceError,
  addCandidateVoice,
  approveVoice,
  listApprovedVoices,
  revokeVoice,
  toOperatorVoiceView,
  type VoiceDeps,
} from '../../voices/catalog.js';
import { isUuid } from '../../lib/uuid.js';
import { operatorOnly as operatorOnlyFor, sendInvalidInput, userOf } from './route-helpers.js';

interface VoiceRouteMiddleware {
  generateLimiter: RequestHandler;
  readLimiter: RequestHandler;
  authMiddleware: RequestHandler;
}

function sendVoiceError(res: Response, err: unknown, tag: string): void {
  if (err instanceof VoiceError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.details } });
    return;
  }
  console.error(`[v1 voices/${tag}] ${(err as Error)?.message ?? 'unknown error'}`);
  res.status(502).json({ error: { code: 'VOICE_CATALOG_FAILED', message: 'The Voice catalog is unavailable. Try again in a moment.' } });
}

export function registerVoiceRoutes(app: express.Express, middleware: VoiceRouteMiddleware, deps: VoiceDeps): void {
  const { generateLimiter, readLimiter, authMiddleware } = middleware;

  /** After auth: only operators pass. Fails closed if the check itself fails. */
  const operatorOnly = operatorOnlyFor(deps.isOperator, 'voices', 'Only operators can manage the Voice catalog.');

  app.get('/v1/voices', readLimiter, authMiddleware, async (req, res) => {
    const parsed = ListVoicesQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return sendInvalidInput(res, parsed.error.issues);
    try {
      res.status(200).json(await listApprovedVoices(deps, parsed.data));
    } catch (err) {
      sendVoiceError(res, err, 'list');
    }
  });

  app.get('/v1/operator/voices', readLimiter, authMiddleware, operatorOnly, async (req, res) => {
    const parsed = OperatorListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return sendInvalidInput(res, parsed.error.issues);
    try {
      const voices = await deps.repo.list(parsed.data);
      res.status(200).json({ voices: voices.map(toOperatorVoiceView) });
    } catch (err) {
      sendVoiceError(res, err, 'operator-list');
    }
  });

  app.post('/v1/operator/voices', generateLimiter, authMiddleware, operatorOnly, async (req, res) => {
    const parsed = AddVoiceInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendInvalidInput(res, parsed.error.issues);
    try {
      res.status(201).json({ voice: toOperatorVoiceView(await addCandidateVoice(deps, userOf(req), parsed.data)) });
    } catch (err) {
      sendVoiceError(res, err, 'add');
    }
  });

  for (const [action, apply] of [['approve', approveVoice], ['revoke', revokeVoice]] as const) {
    app.post(`/v1/operator/voices/:id/${action}`, generateLimiter, authMiddleware, operatorOnly, async (req, res) => {
      const id = String(req.params.id ?? '');
      if (!isUuid(id)) {
        res.status(404).json({ error: { code: 'VOICE_NOT_FOUND', message: 'Voice not found.' } });
        return;
      }
      try {
        res.status(200).json({ voice: toOperatorVoiceView(await apply(deps, userOf(req), id)) });
      } catch (err) {
        sendVoiceError(res, err, action);
      }
    });
  }

  app.get('/v1/operator/voice-candidates', readLimiter, authMiddleware, operatorOnly, async (req, res) => {
    const parsed = CandidatesQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return sendInvalidInput(res, parsed.error.issues);
    try {
      const [found, catalog] = await Promise.all([deps.findCandidates(parsed.data), deps.repo.list({})]);
      const byProviderId = new Map(catalog.map((v) => [`${v.provider}:${v.provider_voice_id}`, v]));
      res.status(200).json({
        ...found,
        candidates: found.candidates.map((c) => {
          const v = byProviderId.get(`${c.provider}:${c.provider_voice_id}`);
          return { ...c, catalog: v ? { id: v.id, state: v.state, dialect: v.dialect } : null };
        }),
      });
    } catch (err) {
      sendVoiceError(res, err, 'candidates');
    }
  });
}

// ── OpenAPI ──────────────────────────────────────────────────────────────────

function schemaOf(schema: unknown, name: string): Record<string, unknown> {
  const js = zodToJsonSchema(schema as Parameters<typeof zodToJsonSchema>[0], { name, $refStrategy: 'none' });
  return ((js as { definitions?: Record<string, Record<string, unknown>> }).definitions?.[name] ?? js) as Record<string, unknown>;
}

/** Query parameters from a zod object schema, so the spec lists exactly what the route accepts. */
function queryParams(schema: unknown, name: string, required: string[] = []) {
  const props = (schemaOf(schema, name).properties ?? {}) as Record<string, Record<string, unknown>>;
  return Object.entries(props).map(([key, s]) => ({ name: key, in: 'query', required: required.includes(key), schema: s }));
}

const json = (ref: string) => ({ content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } } });
const voiceError = (description: string) => ({ description, ...json('VoiceError') });

const COMMON = {
  '401': voiceError('Unauthorized'),
  '429': voiceError('RATE_LIMITED'),
  '502': voiceError('VOICE_CATALOG_FAILED'),
};
const OPERATOR = { ...COMMON, '403': voiceError('OPERATOR_ONLY: the caller is not an operator') };

/** Paths and component schemas for the voice routes, merged into /openapi.json by server.ts. */
export function voiceOpenApi(): { paths: Record<string, unknown>; schemas: Record<string, unknown> } {
  const idParam = [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }];
  const transition = (operationId: string, summary: string, conflict: string) => ({
    post: {
      operationId,
      summary,
      tags: ['voices'],
      security: [{ bearerAuth: [] }],
      parameters: idParam,
      responses: {
        '200': { description: 'The Voice after the change', ...json('OperatorVoiceResponse') },
        '404': voiceError('VOICE_NOT_FOUND'),
        '409': voiceError(conflict),
        ...OPERATOR,
      },
    },
  });
  return {
    paths: {
      '/v1/voices': {
        get: {
          operationId: 'listApprovedVoices',
          summary: 'Approved Voices for a Dialect, each with a playable sample, filterable by gender and delivery style.',
          tags: ['voices'],
          security: [{ bearerAuth: [] }],
          parameters: queryParams(ListVoicesQuerySchema, 'list_voices_query', ['dialect']),
          responses: {
            '200': { description: 'Approved Voices', ...json('VoiceList') },
            '400': voiceError('INVALID_INPUT'),
            ...COMMON,
          },
        },
      },
      '/v1/operator/voices': {
        get: {
          operationId: 'operatorListVoices',
          summary: 'Operator: every Voice in the catalog with its review trail.',
          tags: ['voices'],
          security: [{ bearerAuth: [] }],
          parameters: queryParams(OperatorListQuerySchema, 'operator_list_query'),
          responses: {
            '200': { description: 'The catalog', ...json('OperatorVoiceList') },
            '400': voiceError('INVALID_INPUT'),
            ...OPERATOR,
          },
        },
        post: {
          operationId: 'operatorAddVoice',
          summary: 'Operator: add a candidate Voice (pending) tagged with exactly one Dialect.',
          tags: ['voices'],
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: schemaOf(AddVoiceInputSchema, 'add_voice_input') } } },
          responses: {
            '201': { description: 'The new pending Voice', ...json('OperatorVoiceResponse') },
            '400': voiceError('INVALID_INPUT'),
            '409': voiceError('VOICE_EXISTS: this provider voice is already in the catalog'),
            ...OPERATOR,
          },
        },
      },
      '/v1/operator/voices/{id}/approve': transition(
        'operatorApproveVoice',
        'Operator: approve a Voice for its Dialect after native review. Records approved_by and approved_at.',
        'VOICE_STATE_CONFLICT: already approved',
      ),
      '/v1/operator/voices/{id}/revoke': transition(
        'operatorRevokeVoice',
        'Operator: revoke a Voice. It leaves the picker and drafting at once. Records revoked_by and revoked_at.',
        'VOICE_STATE_CONFLICT: already revoked',
      ),
      '/v1/operator/voice-candidates': {
        get: {
          operationId: 'operatorFindVoiceCandidates',
          summary:
            "Operator: browse the provider's shared Arabic voices to find candidates for review. Filter by Dialect (or one provider accent), " +
            'gender (male or female), age, use case and a search text; sort; page through with page until has_more is false.',
          tags: ['voices'],
          security: [{ bearerAuth: [] }],
          parameters: queryParams(CandidatesQuerySchema, 'candidates_query'),
          responses: {
            '200': { description: 'A page of candidates', ...json('VoiceCandidateList') },
            '400': voiceError('INVALID_INPUT'),
            '503': voiceError('VOICE_PROVIDER_UNCONFIGURED / VOICE_READ_PERMISSION_REQUIRED'),
            ...OPERATOR,
          },
        },
      },
    },
    schemas: {
      Voice: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Pass as voice_id when drafting.' },
          display_name: { type: 'string' },
          dialect: { type: 'string', enum: [...DIALECTS] },
          gender: { type: 'string', enum: [...VOICE_GENDERS] },
          style: { type: 'string', description: 'Delivery style, e.g. warm or energetic.' },
          sample_url: { type: 'string', format: 'uri', description: 'A playable sample of the Voice.' },
        },
        required: ['id', 'display_name', 'dialect', 'gender', 'style', 'sample_url'],
      },
      VoiceList: {
        type: 'object',
        properties: {
          voices: { type: 'array', items: { $ref: '#/components/schemas/Voice' } },
          styles: { type: 'array', items: { type: 'string' }, description: 'Every style on offer in the Dialect.' },
        },
        required: ['voices', 'styles'],
      },
      OperatorVoice: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          provider: { type: 'string' },
          provider_voice_id: { type: 'string' },
          display_name: { type: 'string' },
          dialect: { type: 'string', enum: [...DIALECTS] },
          gender: { type: 'string', enum: [...VOICE_GENDERS] },
          style: { type: 'string' },
          sample_url: { type: 'string', format: 'uri' },
          state: { type: 'string', enum: [...VOICE_STATES] },
          added_by: { type: ['string', 'null'], format: 'uuid' },
          created_at: { type: 'string', format: 'date-time' },
          approved_by: { type: ['string', 'null'], format: 'uuid' },
          approved_at: { type: ['string', 'null'], format: 'date-time' },
          revoked_by: { type: ['string', 'null'], format: 'uuid' },
          revoked_at: { type: ['string', 'null'], format: 'date-time' },
        },
        required: ['id', 'provider', 'provider_voice_id', 'display_name', 'dialect', 'gender', 'style', 'sample_url', 'state', 'created_at'],
      },
      OperatorVoiceResponse: { type: 'object', properties: { voice: { $ref: '#/components/schemas/OperatorVoice' } }, required: ['voice'] },
      OperatorVoiceList: {
        type: 'object',
        properties: { voices: { type: 'array', items: { $ref: '#/components/schemas/OperatorVoice' } } },
        required: ['voices'],
      },
      VoiceCandidateList: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          has_more: { type: 'boolean' },
          candidates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                provider: { type: 'string' },
                provider_voice_id: { type: 'string' },
                display_name: { type: 'string' },
                description: { type: 'string' },
                gender: { type: ['string', 'null'] },
                accent: { type: 'string' },
                suggested_dialect: { type: ['string', 'null'], enum: [...DIALECTS, null] },
                style: { type: ['string', 'null'] },
                sample_url: { type: ['string', 'null'], format: 'uri' },
                catalog: {
                  type: ['object', 'null'],
                  properties: { id: { type: 'string' }, state: { type: 'string' }, dialect: { type: 'string' } },
                },
              },
            },
          },
        },
        required: ['page', 'has_more', 'candidates'],
      },
      VoiceError: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              state: { type: 'string', enum: [...VOICE_STATES] },
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
