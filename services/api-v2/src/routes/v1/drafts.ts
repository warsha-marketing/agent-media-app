// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Product Hero draft routes (#4). The logic lives in drafts/product-hero-draft.ts;
 * this file is only HTTP: validate, call, map DraftError to a status.
 *
 *   POST /v1/drafts/product-hero          { brief, product_details?,
 *                                           dialect, voice_id,
 *                                           product_image_url? }        → 201 { draft }
 *   POST /v1/drafts/product-hero/revoice  { script, dialect, voice_id?,
 *                                           parent_draft_id?, brief?,
 *                                           product_details?,
 *                                           product_interaction?,
 *                                           product_profile?,
 *                                           product_image_url? }        → 201 { draft }
 *
 * product_image_url (#30) is the user's own uploaded product photo; Claude
 * (vision) reads it into the draft's Product Profile. An edited
 * product_profile on re-voice makes a new draft like a Script edit.
 *
 * voice_id is an Approved Voice of the Dialect (GET /v1/voices, #7); anything
 * else is refused with 422 VOICE_NOT_APPROVED before a provider is called. The
 * Dialect must be one at least one Preset is qualified for (GET /v1/presets,
 * #8): the draft is Preset-agnostic, and each render checks its own Preset. Else
 * the draft is refused with 422 PRESET_NOT_QUALIFIED (operators excepted).
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
import type { RequestHandler, Response } from 'express';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  CreateDraftInputSchema,
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
import { sendInvalidInput, userOf } from './route-helpers.js';
import { PRESET_NOT_QUALIFIED } from '../../presets/qualification.js';
import { ProductProfileSchema, SCRIPT_DIALECTS, formatDeliveryTags } from '@agentmedia/schema';

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

export function registerDraftRoutes(app: express.Express, middleware: DraftRouteMiddleware, deps: DraftDeps): void {
  const { generateLimiter, readLimiter, authMiddleware, draftLimiter } = middleware;

  /** The owner's view of a draft, with a signed audio URL minted now. */
  const sendDraft = async (res: Response, status: number, row: DraftRow) => {
    res.status(status).json({ draft: toDraftView(row, await deps.signAudioUrl(row.audio_key)) });
  };

  app.post('/v1/drafts/product-hero', generateLimiter, authMiddleware, draftLimiter, async (req, res) => {
    const parsed = CreateDraftInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendInvalidInput(res, parsed.error.issues, 'body');
    try {
      await sendDraft(res, 201, await createDraftFromBrief(deps, userOf(req), parsed.data));
    } catch (err) {
      sendDraftError(res, err, 'create');
    }
  });

  app.post('/v1/drafts/product-hero/revoice', generateLimiter, authMiddleware, draftLimiter, async (req, res) => {
    const parsed = RevoiceDraftInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendInvalidInput(res, parsed.error.issues, 'body');
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
  '502': draftError(
    'DRAFT_FAILED / SCRIPT_GENERATION_FAILED: an upstream provider failed; retryable. PRODUCT_PROFILE_FAILED: the product photo could not be read into a Product Profile after one rewrite (carries issues) — retry, or use a clear photo of the product alone and add Product Details',
  ),
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
  const tagList = formatDeliveryTags();
  const guardrail =
    'PRODUCT_INTERACTION_BREAKS_GUARDRAIL: the Product Interaction contradicts a Guardrail — speech, removing the hijab/headscarf/abaya, bare arms/shoulders/skin, undressing (carries guardrail, matched and product_interaction)';
  const photo =
    'PRODUCT_IMAGE_NOT_HOSTED: product_image_url is not a photo this account uploaded to agent-media (upload it first; carries product_image_url); PRODUCT_PHOTO_REFUSED: the photo cannot be used for an ad';
  const usedState =
    'PRODUCT_INTERACTION_NOT_IN_USED_STATE: the Product Interaction written from the Product Profile still takes a part off or opens the product on camera after one rewrite (carries matched and product_interaction, to edit)';
  const outOfBand = `SCRIPT_TOO_SHORT / SCRIPT_TOO_LONG: voiced speech outside ${MIN_SPEECH_MS / 1000}–${MAX_SPEECH_MS / 1000} s (carries action, duration_ms and the Script)`;
  return {
    paths: {
      '/v1/drafts/product-hero': post(
        'createProductHeroDraft',
        'Product Hero draft: read the product photo (product_image_url, recommended) into a Product Profile, write a Script (plain dialect spelling, Targeted Diacritics, Delivery Tags) that sells the Product Details and a Product Interaction from the Profile, in a Dialect, and voice it. Free (no credits).',
        bodySchema(CreateDraftInputSchema, 'create_draft_input'),
        `${outOfBand}; SCRIPT_CHECK_FAILED: the written Script failed the Script check twice (unmarked product nouns, unknown tags, stray brackets, Latin letters) — carries the Script and issues, to fix in the editor and re-voice; ${guardrail}, after one rewrite; ${usedState}; ${photo}; ${PRESET_NOT_QUALIFIED}: no Preset is a Qualified Preset in this Dialect yet (carries dialect and available; see GET /v1/presets); BRIEF_REFUSED; ${voiceRefused}`,
      ),
      '/v1/drafts/product-hero/revoice': post(
        'revoiceProductHeroDraft',
        `Voice an edited Script verbatim as a NEW draft. With parent_draft_id, the parent's Brief, Product Details, Product Profile and Dialect carry over. An edited product_profile replaces the parent's and, unless product_interaction is also given, the Product Interaction is re-written from it. The Script may carry Delivery Tags: ${tagList}.`,
        bodySchema(RevoiceDraftInputSchema, 'revoice_draft_input'),
        `${outOfBand}; UNKNOWN_DELIVERY_TAG: a bracketed tag that is not an allowed Delivery Tag (carries tags and allowed); SCRIPT_STRAY_BRACKETS: a [ or ] outside a Delivery Tag (carries found); SCRIPT_NO_ARABIC: no Arabic text to speak (Latin words such as a brand name are allowed in an edit); DIALECT_MISMATCH (dialect differs from the parent's); ${guardrail}; PRODUCT_PROFILE_BREAKS_GUARDRAIL: the edited Product Profile's words contradict a Guardrail (carries guardrail and matched); ${usedState}; ${photo}; ${PRESET_NOT_QUALIFIED}; ${voiceRefused}`,
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
          dialect: { type: 'string', enum: [...SCRIPT_DIALECTS] },
          brief: { type: ['string', 'null'] },
          product_details: { type: ['string', 'null'], description: 'The facts the Script sells (name, notes or ingredients, benefits); carried over on re-voice.' },
          product_interaction: {
            type: ['string', 'null'],
            description:
              'Product Interaction: how a real person uses the product, in English (e.g. perfume: "holds the uncapped bottle, sprays once on the inner wrist, sets the bottle down, then raises the wrist to the nose and smiles"). Written with the Script; the render adds it to every hands and person shot. Edit it by re-voicing with product_interaction (a new draft); carried over on re-voice otherwise.',
          },
          product_profile: {
            anyOf: [
              {
                ...bodySchema(ProductProfileSchema, 'product_profile'),
                description:
                  'Product Profile: what the system understands about the product from its photo and Product Details — category, real size (dimensions, size_class), parts and the state it is in while used (used_state; differs_from_photo when the photo shows another state), how it is used (interaction_verbs, grip), physics_risks for video, and confidence (0–1). Edit it by re-voicing with product_profile (a new draft).',
              },
              { type: 'null', description: 'No Product Profile: the draft was made without a product photo (or before #30).' },
            ],
          },
          script: {
            type: 'string',
            description:
              `The Script exactly as voiced: plain dialect spelling with Targeted Diacritics and optional Delivery Tags (${tagList}). ` +
              'Strip the tags before showing it to viewers or burning Captions (stripDeliveryTags in @agentmedia/schema); the alignment includes the tag characters.',
          },
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
              script: { type: 'string', description: 'On SCRIPT_TOO_SHORT / SCRIPT_TOO_LONG / SCRIPT_CHECK_FAILED: the Script, to edit and re-voice.' },
              dialect: { type: 'string' },
              parent_dialect: { type: 'string' },
              voice_id: { type: 'string', description: 'On VOICE_NOT_APPROVED: the refused Voice.' },
              tags: { type: 'array', items: { type: 'string' }, description: 'On UNKNOWN_DELIVERY_TAG: the refused tags, as written (e.g. "[wisper]").' },
              allowed: { type: 'array', items: { type: 'string' }, description: 'On UNKNOWN_DELIVERY_TAG: the allowed Delivery Tags.' },
              found: { type: 'array', items: { type: 'string' }, description: 'On SCRIPT_STRAY_BRACKETS: the stray brackets found.' },
              guardrail: { type: 'string', enum: ['speech', 'hijab', 'exposed', 'undress'], description: 'On PRODUCT_INTERACTION_BREAKS_GUARDRAIL / PRODUCT_PROFILE_BREAKS_GUARDRAIL: which Guardrail it contradicts.' },
              matched: { type: 'string', description: 'On PRODUCT_INTERACTION_BREAKS_GUARDRAIL / PRODUCT_PROFILE_BREAKS_GUARDRAIL: the words that matched.' },
              product_interaction: {
                type: 'string',
                description: 'On PRODUCT_INTERACTION_BREAKS_GUARDRAIL / PRODUCT_INTERACTION_NOT_IN_USED_STATE: the refused Product Interaction, to edit.',
              },
              product_image_url: { type: 'string', description: 'On PRODUCT_IMAGE_NOT_HOSTED: the refused photo URL.' },
              preset: { type: 'string', description: 'The Preset refused, where one is named (skill routes).' },
              available: { type: 'array', items: { type: 'string' }, description: 'On PRESET_NOT_QUALIFIED: the Dialects some Preset is qualified for.' },
              issues: {
                type: 'array',
                description: 'INVALID_INPUT: zod issues. PRODUCT_PROFILE_FAILED: why the vision reply was not a Product Profile (strings). SCRIPT_CHECK_FAILED / UNKNOWN_DELIVERY_TAG / SCRIPT_STRAY_BRACKETS / SCRIPT_NO_ARABIC: Script check issues ({ code, message, found }).',
                items: { type: 'object' },
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
