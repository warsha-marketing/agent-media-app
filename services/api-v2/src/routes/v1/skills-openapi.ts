// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * OpenAPI entries for POST /v1/skills/{slug}/run and /quote and GET
 * /v1/skills/runs/{skill_run_id}, merged into
 * /openapi.json by server.ts. The error codes come from the tables the routes
 * answer with (RENDER_REFUSALS for make_product_hero), so the spec cannot list
 * a code the server does not send, or miss one it does.
 */

import { RENDER_REFUSALS, type RenderRefusalCode } from '../../skills/product-hero-render.js';
import { RUN_CREDITS_OPENAPI } from '../../skills/run-credits.js';

const skillError = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/SkillError' } } },
});

/** "code: when" lines for the Product Hero refusals answered with `status`. */
function refusalLines(status: number): string[] {
  return (Object.keys(RENDER_REFUSALS) as RenderRefusalCode[])
    .filter((code) => RENDER_REFUSALS[code].status === status)
    .map((code) => `\`${code}\` (make_product_hero): ${RENDER_REFUSALS[code].when}`);
}

const sentences = (...parts: string[]) => parts.join('. ');

const SLUG = { name: 'slug', in: 'path', required: true, schema: { type: 'string' } };

export function skillRouteOpenApi(): { paths: Record<string, unknown>; schemas: Record<string, unknown> } {
  const run = {
    post: {
      operationId: 'runVnextSkill',
      summary:
        'Run a vNext skill (e.g. make_portrait, make_podcast, make_product_hero). make_product_hero renders an approved Product Hero draft; the draft is refused while a render of it is in flight or after one succeeded, and is renderable again after a failed or canceled render.',
      tags: ['vnext-skills'],
      security: [{ bearerAuth: [] }],
      parameters: [
        SLUG,
        {
          name: 'Idempotency-Key',
          in: 'header',
          required: false,
          schema: { type: 'string', maxLength: 200 },
          description: 'A replay with the same key returns the original run (202, idempotent_replay: true) instead of starting or refusing a second one.',
        },
      ],
      responses: {
        '202': { description: 'Workflow submitted, or the original run on an Idempotency-Key replay (idempotent_replay: true)' },
        '400': skillError(sentences('`invalid_input`: the body fails the skill schema', '`image_upload_failed`: the photo could not be re-hosted')),
        '402': skillError('`insufficient_credits`: the balance, minus credits reserved by runs in flight, does not cover the quote'),
        '404': skillError(sentences('`unknown_skill`', ...refusalLines(404))),
        '409': skillError(sentences(...refusalLines(409))),
        '422': skillError(sentences(...refusalLines(422), '`unsafe_content`: the photo failed moderation')),
        '502': skillError('`temporal_dispatch_failed`: the workflow could not be started; nothing was charged and a Product Hero draft stays renderable'),
        '503': skillError('`temporal_unconfigured`'),
      },
    },
  };
  const quote = {
    post: {
      operationId: 'quoteVnextSkill',
      summary: 'Price a skill run without running it: the same schema and pricing function as the run. make_product_hero is priced from its draft and refuses what the run would refuse.',
      tags: ['vnext-skills'],
      security: [{ bearerAuth: [] }],
      parameters: [SLUG],
      responses: {
        '200': { description: 'The quote: credits, available (after reservations), committed, sufficient' },
        '400': skillError('`invalid_input`: the body fails the skill schema'),
        '404': skillError(sentences('`unknown_skill`', ...refusalLines(404))),
        '409': skillError(sentences(...refusalLines(409))),
        '422': skillError(sentences(...refusalLines(422), '`unpriceable_input`: pricing fails closed on an input it cannot price')),
      },
    },
  };
  const runStatus = {
    get: {
      operationId: 'getSkillRun',
      summary: 'Get composed-skill run status, per-step artifacts, and what the run charged and refunded',
      tags: ['vnext-skills'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'skill_run_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': {
          description: 'Composed skill run',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  skill_run_id: { type: 'string', format: 'uuid' },
                  skill: { type: 'string' },
                  skill_version: { type: 'string' },
                  status: { type: 'string', enum: ['submitted', 'running', 'succeeded', 'failed', 'canceled'] },
                  current_step: { type: ['string', 'null'] },
                  started_at: { type: ['string', 'null'], format: 'date-time' },
                  finished_at: { type: ['string', 'null'], format: 'date-time' },
                  created_at: { type: 'string', format: 'date-time' },
                  error: { type: ['object', 'null'], properties: { code: { type: 'string' }, message: { type: ['string', 'null'] } } },
                  final_output: { type: ['object', 'null'] },
                  credits: RUN_CREDITS_OPENAPI,
                  steps: { type: 'array', items: { type: 'object' } },
                },
              },
            },
          },
        },
        '400': skillError('`invalid_skill_run_id`'),
        '404': skillError('`not_found`: no such run on this account'),
      },
    },
  };
  return {
    paths: { '/v1/skills/{slug}/run': run, '/v1/skills/{slug}/quote': quote, '/v1/skills/runs/{skill_run_id}': runStatus },
    schemas: {
      SkillError: {
        type: 'object',
        properties: {
          error: { type: 'string', description: 'Machine-readable code' },
          skill: { type: 'string' },
          detail: { description: 'Human-readable explanation, or validation detail for invalid_input' },
        },
        required: ['error'],
      },
    },
  };
}
