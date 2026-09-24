// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * OpenAPI entries for POST /v1/skills/{slug}/run and /quote and GET
 * /v1/skills/runs/{skill_run_id}, merged into
 * /openapi.json by server.ts. The error codes come from the tables the routes
 * answer with — RENDER_REFUSALS for every Preset render skill in the registry,
 * plus each one's own (SkillEntry.presetRefusals) — so the spec cannot list a
 * code the server does not send, or miss one it does.
 */

import { RENDER_REFUSALS } from '../../skills/product-hero-render.js';
import { RUN_CREDITS_OPENAPI } from '../../skills/run-credits.js';
import { IDEMPOTENCY_KEY_REUSED } from '../../skills/idempotency.js';
import { PRESET_NOT_QUALIFIED as PRESET_NOT_QUALIFIED_CODE } from '../../presets/qualification.js';
import { SKILLS } from '../../skills/registry.js';

const skillError = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/SkillError' } } },
});

/** Every Preset render skill (SkillEntry.preset), read from the registry. */
const presetSkills = () => Object.values(SKILLS).filter((s) => s.preset);

/**
 * "`code` (skills): when" lines for the Preset render refusals answered with
 * `status`: the shared ones (RENDER_REFUSALS) for every Preset render skill,
 * plus each skill's own (SkillEntry.presetRefusals), each naming the skills
 * that can answer it.
 */
function refusalLines(status: number): string[] {
  const byCode = new Map<string, { when: string; slugs: string[] }>();
  for (const skill of presetSkills()) {
    const refusals: Record<string, { status: number; when: string }> = { ...RENDER_REFUSALS, ...(skill.presetRefusals ?? {}) };
    for (const [code, r] of Object.entries(refusals)) {
      if (r.status !== status) continue;
      const line = byCode.get(code) ?? { when: r.when, slugs: [] };
      line.slugs.push(skill.slug);
      byCode.set(code, line);
    }
  }
  return [...byCode].map(([code, { when, slugs }]) => `\`${code}\` (${slugs.sort().join(', ')}): ${when}`);
}

const sentences = (...parts: string[]) => parts.join('. ');

/** The Qualified Preset gate (#8, presets/qualification.ts), checked after the draft refusals, for every
 *  Preset render skill. The same code string the drafts routes send (upper snake, the domain's own). */
const presetNotQualified = () =>
  `\`${PRESET_NOT_QUALIFIED_CODE}\` (${presetSkills().map((s) => s.slug).sort().join(', ')}): the skill's Preset is not a Qualified Preset in the draft's Dialect (carries preset, dialect and available; see GET /v1/presets)`;

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
          description:
            'A replay with the same key and the same body returns the original run (202, idempotent_replay: true) instead of starting or refusing a second one. The same key with a different body is refused (409 idempotency_key_reused).',
        },
      ],
      responses: {
        '202': {
          description:
            'Workflow submitted, or the original run on an Idempotency-Key replay (idempotent_replay: true). For make_product_hero also music_bed (as in the quote). A render never burns Captions: its Short is clean, and Captions are added afterwards (GET /v1/shorts/{short_id}/captions, POST /v1/shorts/{short_id}/caption-exports).',
        },
        '400': skillError(
          sentences('`invalid_input`: the body fails the skill schema', '`image_upload_failed`: the photo could not be re-hosted', ...refusalLines(400)),
        ),
        '402': skillError('`insufficient_credits`: the balance, minus credits reserved by runs in flight, does not cover the quote'),
        '404': skillError(sentences('`unknown_skill`', ...refusalLines(404))),
        '409': skillError(sentences(IDEMPOTENCY_KEY_REUSED, ...refusalLines(409))),
        '422': skillError(sentences(...refusalLines(422), presetNotQualified(), '`unsafe_content`: the photo failed moderation')),
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
        '200': { description: 'The quote: credits, available (after reservations), committed, sufficient; for a Preset render also music_bed (on, track_id, mood, reason off|no_tracks, detail) and, for a Preset with its own inputs, preset_inputs (what renders: the resolved modesty; make_hands_on: hand_gender, setting and source user|product_details for each; make_reaction: character_id, character_gender)' },
        '400': skillError(sentences('`invalid_input`: the body fails the skill schema', ...refusalLines(400))),
        '404': skillError(sentences('`unknown_skill`', ...refusalLines(404))),
        '409': skillError(sentences(...refusalLines(409))),
        '422': skillError(sentences(...refusalLines(422), presetNotQualified(), '`unpriceable_input`: pricing fails closed on an input it cannot price')),
      },
    },
  };
  const shotPlan = {
    post: {
      operationId: 'shotPlanVnextSkill',
      summary:
        'Shot Plan review (Preset render skills only): the shots the render will make, before confirming. Takes the quote’s body (optionally with shot_edits) and answers the same refusals. Read-only and free. Edit a shot’s fields by sending shot_edits { shot_id: { scene?, framing?, blocking?, environment_interaction?, performance?, action?, energy?, camera_move?, lens_feel?, lighting? } } to the quote and the run (a shot’s length and model never change); the Guardrails are locked and always added by the server, per stage; the price never changes.',
      tags: ['vnext-skills'],
      security: [{ bearerAuth: [] }],
      parameters: [SLUG],
      responses: {
        '200': {
          description:
            'skill, preset, draft_id, duration_ms, set (the Short’s Set { set_id } or null), fields[] (the editable fields in composition order: id, label, max_chars or choices, required, people_only), and shots[]: shot_id (stable, independent of position: the kind and its ordinal within the kind, e.g. reaction-1), number, kind, shows (product | hands | person), clip_seconds, on_screen_ms, starting_frame, model { id, name }, fallback { id, name } | null, set_id, fields { framing, scene, blocking, environment_interaction, performance, action, energy (calm | natural | lively), camera_move, lens_feel, lighting } (editable), default_fields (the Preset’s, for "reset"), edited_fields[], edited, guardrails { image[], video[] } of { id, label, text, enforced_by prompt | request } (locked, per stage: image is the starting frame’s, empty without one), prompt_preview { image | null, video } (the final prompts with the images named in plain words)',
        },
        '400': skillError(sentences('`invalid_input`: the body fails the skill schema', ...refusalLines(400))),
        '404': skillError(sentences('`unknown_skill`', '`not_a_preset_skill`: only a Preset render skill has a Shot Plan', ...refusalLines(404))),
        '409': skillError(sentences(...refusalLines(409))),
        '422': skillError(sentences(...refusalLines(422), presetNotQualified())),
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
    paths: {
      '/v1/skills/{slug}/run': run,
      '/v1/skills/{slug}/quote': quote,
      '/v1/skills/{slug}/shot-plan': shotPlan,
      '/v1/skills/runs/{skill_run_id}': runStatus,
    },
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
