// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Preset-specific render inputs — what a Preset needs beyond the approved draft
 * and the product photo, resolved at the route by the Preset's skill:
 *   Hands-on (#18): hand gender and setting (defaulted from the Product
 *     Details) and the Modesty Default;
 *   Reaction (#19): a saved character (its reference re-hosted for the worker)
 *     and the Modesty Default.
 * Product Hero has none.
 *
 * One shape for every Preset:
 *   presetRenderInputSchema(preset, extra) — the skill input of a Preset render:
 *       draft_id, the product photo (exactly one), aspect_ratio, music, the
 *       Modesty choice `modesty`, plus the Preset's own fields. A `captions`
 *       field is refused (#22, refuseCaptionsField).
 *   PresetInputResolver — SkillEntry.presetInputs. The quote and the run both
 *       call the SAME resolver after the draft is resolved and gated, so a quote
 *       refuses exactly what the run would refuse and shows exactly what the run
 *       renders. Only the run may do work with a side effect (re-hosting an
 *       image); the quote only reads.
 *   resolvePresetModesty — resolveModesty for the draft's Dialect, with a
 *       ModestyError turned into the 400 the routes send (its code:
 *       LESS_MODEST_THAN_PRESET | HIJAB_NOT_OFFERED; MODESTY_REFUSALS).
 *
 * A resolver refuses with a RenderRefusal (status + code); a re-host blocked by
 * moderation throws the ModerationError the route already answers.
 */

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ModestyError,
  modestyChoiceSchema,
  resolveModesty,
  type Dialect,
  type Modesty,
  type ModestyChoice,
  type ModestyErrorCode,
  type PersonGender,
  type PresetDefinition,
} from '@agentmedia/schema';
import { RenderRefusal, refuseCaptionsField, type RenderableDraft } from './product-hero-render.js';

// ── The resolver ─────────────────────────────────────────────────────────────

export interface PresetInputContext {
  userId: string;
  /** The validated skill input (defaults applied). */
  body: Record<string, unknown>;
  /** The draft being rendered, already resolved and gated (owner, band, Voice, Qualified Preset). */
  draft: RenderableDraft;
  preset: PresetDefinition;
  /** 'quote' reads only; 'run' may re-host references for the worker. */
  stage: 'quote' | 'run';
  /** Service-role client: ownership is enforced by the resolver's own filters. */
  db: SupabaseClient;
  /** Re-host (and moderate) an image onto our storage, for the worker's SSRF guard. */
  rehostImage: (userId: string, url: string) => Promise<{ url: string }>;
}

export interface PresetInputs {
  /** Stored on the skill run's input (never a private key). */
  run: Record<string, unknown>;
  /** Added to the workflow input. Only on the run stage. */
  workflow: Record<string, unknown>;
  /**
   * Added to the quote and the run's 202: `preset_inputs`, what will render
   * (the resolved Modesty Default, Hands-on's hand gender and setting and where
   * each came from, …).
   */
  quote: { preset_inputs?: Record<string, unknown> };
}

export type PresetInputResolver = (ctx: PresetInputContext) => Promise<PresetInputs>;

// ── Modesty ──────────────────────────────────────────────────────────────────

/** Every Modesty refusal, by code: the table the routes and the OpenAPI entry read. */
export const MODESTY_REFUSALS: Readonly<Record<ModestyErrorCode, { status: 400; when: string }>> = {
  LESS_MODEST_THAN_PRESET: {
    status: 400,
    when: 'the `modesty` choice is less modest than the Preset allows (arms under its floor, or a required hijab turned off)',
  },
  HIJAB_NOT_OFFERED: {
    status: 400,
    when: 'a hijab was asked for where none can be worn (a man, or a Preset that shows no person, e.g. Hands-on)',
  },
};

/**
 * The Modesty Default for this render: the Preset's defaults for the draft's
 * Dialect, the on-screen gender (Reaction's person, Hands-on's hands), and the
 * user's choice. A choice the Preset does not allow is a 400 with its code.
 */
export function resolvePresetModesty(
  preset: Pick<PresetDefinition, 'name' | 'shotKinds' | 'modesty'>,
  draft: Pick<RenderableDraft, 'dialect'>,
  gender: PersonGender | undefined,
  choice: ModestyChoice | undefined,
): Modesty {
  try {
    return resolveModesty(preset, { dialect: draft.dialect as Dialect, gender, choice });
  } catch (err) {
    if (err instanceof ModestyError) throw new RenderRefusal(MODESTY_REFUSALS[err.code].status, err.code, err.message);
    throw err;
  }
}

// ── The skill input ──────────────────────────────────────────────────────────

/** The Modesty choice as a skill input field (strict: arms and hijab only). */
export const modestyField = modestyChoiceSchema
  .optional()
  .describe(
    'Modest by default: arms covered (long sleeves), and for a woman on screen a hijab where the Preset shows a person (on by default for Gulf drafts). Only to change a default: { arms: "covered" | "sleeved", hijab: true | false }. Never less modest than the Preset allows; a hijab is refused for a man, or where nobody is on screen.',
  );

/** The fields every Preset render takes. */
const renderFields = (preset: Pick<PresetDefinition, 'aspectRatio'>) => ({
  draft_id: z
    .string()
    .uuid()
    .describe(
      'The approved draft to render: its id from the draft step. Show the user the Script and let them hear the voice preview first, and get their OK — the Short speaks exactly that audio. A draft becomes one Short; if its render fails, the same draft can be rendered again.',
    ),
  product_image_url: z
    .string()
    .url()
    .regex(/^https:\/\//, 'product_image_url must use https')
    .describe('The product photo, an https URL. If you only hold bytes, call `upload_image` first and pass the URL it returns.')
    .optional(),
  product_image_base64: z.string().min(64).describe('The product photo as base64 (prefer product_image_url).').optional(),
  aspect_ratio: z.literal(preset.aspectRatio).default(preset.aspectRatio),
  music: z
    .boolean()
    .default(true)
    .describe(
      'Music Bed under the voice, on by default. Set false for a voice-only Short, e.g. when the user will add a sound in TikTok (trending sounds are licensed only inside TikTok, so they can never be baked in). The quote says whether a bed will be mixed.',
    ),
  modesty: modestyField,
});

/**
 * The skill input of a Preset render with its own `extra` fields (the shared
 * fields, exactly one product photo, the Modesty choice, then `extra`). A
 * `captions` field is refused with the Caption editor pointer (#22).
 */
export function presetRenderInputSchema<Extra extends z.ZodRawShape>(
  preset: Pick<PresetDefinition, 'aspectRatio'>,
  extra: Extra,
) {
  return refuseCaptionsField(
    z
      .object({ ...renderFields(preset), ...extra })
      .refine((d) => Boolean(d.product_image_url) !== Boolean(d.product_image_base64), {
        message: 'provide exactly one of product_image_url (any https URL) or product_image_base64 (data URL or raw base64)',
        path: ['product_image_url'],
      }),
  );
}
