// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Preset picker and Qualified Preset routes (#8). The logic lives in
 * presets/qualification.ts; this file is only HTTP: validate, gate operators,
 * call, map PresetError to a status.
 *
 * Users (any signed-in caller):
 *   GET  /v1/presets                                         → 200 { presets, operator }
 *        each Preset with every Dialect marked available or coming_soon;
 *        users see only Presets with an available Dialect
 *
 * Operators (ADMIN_EMAILS; everyone else gets 403 OPERATOR_ONLY):
 *   GET  /v1/operator/presets                                → 200 { qualifications }  every Preset × Script Dialect + trail
 *   POST /v1/operator/presets/:preset/dialects/:dialect/qualify   { notes? } → 200 { qualification }  records qualified_by/at
 *   POST /v1/operator/presets/:preset/dialects/:dialect/withdraw  { notes? } → 200 { qualification }  records withdrawn_by/at
 *
 * Qualify a pair only after native speakers of its Dialect accepted its sample
 * Shorts (operators can draft and render an unqualified pair to make them):
 *
 *   curl -X POST $API/v1/operator/presets/product_hero/dialects/gulf/qualify \
 *     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
 *     -d '{"notes":"3 samples accepted by 2 Saudi reviewers"}'
 *
 * presetOpenApi() describes these routes for /openapi.json (server.ts merges it).
 */

import type express from 'express';
import type { RequestHandler, Response } from 'express';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { operatorOnly as operatorOnlyFor, sendInvalidInput, userOf } from './route-helpers.js';
import { DIALECTS, SCRIPT_DIALECTS } from '@agentmedia/schema';
import {
  PRESET_SLUGS,
  PresetError,
  QUALIFICATION_STATES,
  QualificationBodySchema,
  QualificationPathSchema,
  listPresetsFor,
  operatorQualifications,
  qualifyPreset,
  withdrawPreset,
  type PresetDeps,
} from '../../presets/qualification.js';

interface PresetRouteMiddleware {
  generateLimiter: RequestHandler;
  readLimiter: RequestHandler;
  authMiddleware: RequestHandler;
}

function sendPresetError(res: Response, err: unknown, tag: string): void {
  if (err instanceof PresetError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.details } });
    return;
  }
  console.error(`[v1 presets/${tag}] ${(err as Error)?.message ?? 'unknown error'}`);
  res.status(502).json({ error: { code: 'PRESETS_UNAVAILABLE', message: 'The Preset list is unavailable. Try again in a moment.' } });
}

export function registerPresetRoutes(app: express.Express, middleware: PresetRouteMiddleware, deps: PresetDeps): void {
  const { generateLimiter, readLimiter, authMiddleware } = middleware;

  /** After auth: only operators pass. Fails closed if the check itself fails. */
  const operatorOnly = operatorOnlyFor(deps.isOperator, 'presets', 'Only operators can qualify or withdraw Presets.');

  app.get('/v1/presets', readLimiter, authMiddleware, async (req, res) => {
    try {
      res.status(200).json(await listPresetsFor(deps, userOf(req)));
    } catch (err) {
      sendPresetError(res, err, 'list');
    }
  });

  app.get('/v1/operator/presets', readLimiter, authMiddleware, operatorOnly, async (_req, res) => {
    try {
      res.status(200).json({ qualifications: await operatorQualifications(deps) });
    } catch (err) {
      sendPresetError(res, err, 'operator-list');
    }
  });

  for (const [action, apply] of [['qualify', qualifyPreset], ['withdraw', withdrawPreset]] as const) {
    app.post(`/v1/operator/presets/:preset/dialects/:dialect/${action}`, generateLimiter, authMiddleware, operatorOnly, async (req, res) => {
      const path = QualificationPathSchema.safeParse({ preset: String(req.params.preset ?? ''), dialect: String(req.params.dialect ?? '') });
      if (!path.success) return sendInvalidInput(res, path.error.issues);
      const body = QualificationBodySchema.safeParse(req.body ?? {});
      if (!body.success) return sendInvalidInput(res, body.error.issues);
      try {
        const qualification = await apply(deps, userOf(req), path.data.preset, path.data.dialect, body.data);
        res.status(200).json({ qualification });
      } catch (err) {
        sendPresetError(res, err, action);
      }
    });
  }
}

// ── OpenAPI ──────────────────────────────────────────────────────────────────

function schemaOf(schema: unknown, name: string): Record<string, unknown> {
  const js = zodToJsonSchema(schema as Parameters<typeof zodToJsonSchema>[0], { name, $refStrategy: 'none' });
  return ((js as { definitions?: Record<string, Record<string, unknown>> }).definitions?.[name] ?? js) as Record<string, unknown>;
}

const json = (ref: string) => ({ content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } } });
const presetError = (description: string) => ({ description, ...json('PresetError') });

const COMMON = {
  '401': presetError('Unauthorized'),
  '429': presetError('RATE_LIMITED'),
  '502': presetError('PRESETS_UNAVAILABLE'),
};
const OPERATOR = { ...COMMON, '403': presetError('OPERATOR_ONLY: the caller is not an operator') };

/** Paths and component schemas for the preset routes, merged into /openapi.json by server.ts. */
export function presetOpenApi(): { paths: Record<string, unknown>; schemas: Record<string, unknown> } {
  const pairParams = [
    { name: 'preset', in: 'path', required: true, schema: { type: 'string', enum: [...PRESET_SLUGS] } },
    { name: 'dialect', in: 'path', required: true, schema: { type: 'string', enum: [...SCRIPT_DIALECTS] } },
  ];
  const transition = (operationId: string, summary: string, conflict: string) => ({
    post: {
      operationId,
      summary,
      tags: ['presets'],
      security: [{ bearerAuth: [] }],
      parameters: pairParams,
      requestBody: { required: false, content: { 'application/json': { schema: schemaOf(QualificationBodySchema, 'qualification_body') } } },
      responses: {
        '200': { description: 'The pair after the change', ...json('QualificationResponse') },
        '400': presetError('INVALID_INPUT: not a Preset slug, a Dialect no Script can be written in yet, or unknown fields'),
        '404': presetError('PRESET_NOT_FOUND'),
        '409': presetError(conflict),
        ...OPERATOR,
      },
    },
  });
  const qualificationProps = {
    preset: { type: 'string' },
    dialect: { type: 'string', enum: [...SCRIPT_DIALECTS] },
    state: { type: 'string', enum: [...QUALIFICATION_STATES, 'not_reviewed'] },
    qualified_by: { type: ['string', 'null'], description: 'The operator who last qualified it; null on a migration seed (its notes say who reviewed it).' },
    qualified_at: { type: ['string', 'null'], format: 'date-time' },
    withdrawn_by: { type: ['string', 'null'] },
    withdrawn_at: { type: ['string', 'null'], format: 'date-time' },
    notes: { type: ['string', 'null'] },
  };
  return {
    paths: {
      '/v1/presets': {
        get: {
          operationId: 'listPresets',
          summary:
            'The Preset picker: the Presets you can make, each with every Dialect marked available (a Qualified Preset: native speakers accepted its samples) or coming_soon. ' +
            'Draft and render only an available pair; any other is refused with PRESET_NOT_QUALIFIED.',
          tags: ['presets'],
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'The picker', ...json('PresetList') }, ...COMMON },
        },
      },
      '/v1/operator/presets': {
        get: {
          operationId: 'operatorListQualifications',
          summary: "Operator: every Preset × Script Dialect with its qualification state ('not_reviewed' if never qualified) and review trail.",
          tags: ['presets'],
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'The qualifications', ...json('QualificationList') }, ...OPERATOR },
        },
      },
      '/v1/operator/presets/{preset}/dialects/{dialect}/qualify': transition(
        'operatorQualifyPreset',
        'Operator: qualify a Preset for a Dialect after native speakers of that Dialect accepted its sample Shorts. Users are offered it at once. Records qualified_by and qualified_at.',
        'QUALIFICATION_STATE_CONFLICT: already qualified',
      ),
      '/v1/operator/presets/{preset}/dialects/{dialect}/withdraw': transition(
        'operatorWithdrawPreset',
        'Operator: withdraw a Qualified Preset. It stops being offered, drafted and rendered at once. Records withdrawn_by and withdrawn_at.',
        'QUALIFICATION_STATE_CONFLICT: not qualified',
      ),
    },
    schemas: {
      PresetList: {
        type: 'object',
        properties: {
          operator: { type: 'boolean', description: 'True for operators, who also see unqualified Presets and may draft sampleable Dialects.' },
          presets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                slug: { type: 'string', enum: [...PRESET_SLUGS] },
                name: { type: 'string' },
                summary: { type: 'string' },
                skill: { type: 'string', description: 'The skill that renders it (POST /v1/skills/{skill}/quote and /run).' },
                dialects: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      dialect: { type: 'string', enum: [...DIALECTS] },
                      name: { type: 'string' },
                      status: { type: 'string', enum: ['available', 'coming_soon'] },
                      sample: { type: 'boolean', description: 'Operators only: an unqualified Dialect they can draft to make reviewer samples.' },
                    },
                    required: ['dialect', 'name', 'status'],
                  },
                },
              },
              required: ['slug', 'name', 'summary', 'skill', 'dialects'],
            },
          },
        },
        required: ['presets', 'operator'],
      },
      Qualification: { type: 'object', properties: qualificationProps, required: ['preset', 'dialect', 'state'] },
      QualificationResponse: {
        type: 'object',
        properties: { qualification: { $ref: '#/components/schemas/Qualification' } },
        required: ['qualification'],
      },
      QualificationList: {
        type: 'object',
        properties: { qualifications: { type: 'array', items: { $ref: '#/components/schemas/Qualification' } } },
        required: ['qualifications'],
      },
      PresetError: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              preset: { type: 'string' },
              dialect: { type: 'string' },
              state: { type: 'string', enum: [...QUALIFICATION_STATES, 'not_reviewed'] },
              available: { type: 'array', items: { type: 'string' }, description: 'On PRESET_NOT_QUALIFIED: the Dialects the Preset is qualified for.' },
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
