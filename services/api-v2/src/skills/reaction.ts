// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * make_reaction (#19) — render an APPROVED draft as a Reaction Short: one of the
 * user's saved characters reacts silently to the product, intercut with product
 * shots, under the draft's voice-over (ADR 0001; the Preset is REACTION in
 * @agentmedia/schema, its prompts are in the worker).
 *
 * Beyond Product Hero's inputs it takes:
 *   - character_id — a saved character of the caller (its char_… id from
 *     list_characters, or its row id). Anyone else's, or an archived one, is
 *     refused as if it did not exist (404 character_not_found).
 *   - character_gender — saved characters do not record a gender, so the caller
 *     says it. It decides whether a hijab can be worn (a woman only).
 *   - modesty — the Modesty Default choice (#17: arms, hijab), resolved with
 *     resolveModesty for the draft's Dialect: a Gulf woman wears a hijab unless
 *     she turns it off; a less modest choice (400 LESS_MODEST_THAN_PRESET) or a
 *     hijab for a man (400 HIJAB_NOT_OFFERED) is refused.
 *
 * The saved character costs nothing extra (no portrait or sheet step), so the
 * price is the Preset's planned clips, from the same plan the worker renders.
 *
 * #20 adds a short description instead of a saved character: it joins as
 * `character_description`, exactly one of the two.
 */

import { z } from 'zod';
import {
  REACTION,
  ModestyError,
  modestyChoiceSchema,
  resolveModesty,
  type Dialect,
  type Modesty,
  type ModestyErrorCode,
} from '@agentmedia/schema';
import { RenderRefusal, refuseCaptionsField } from './product-hero-render.js';
import type { PresetInputResolver } from './preset-inputs.js';

export const CHARACTER_GENDERS = ['female', 'male'] as const;

export const MakeReactionSkillInputSchema = refuseCaptionsField(
  z
    .object({
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
      character_id: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .describe('The saved character who reacts: its character_id (char_…) from list_characters. Must be one of the user’s own characters.'),
      character_gender: z
        .enum(CHARACTER_GENDERS)
        .describe('The saved character’s gender, "female" or "male" (saved characters do not record it). A hijab is offered only for a woman.'),
      modesty: modestyChoiceSchema
        .optional()
        .describe(
          'Modest by default: arms covered (long sleeves), and for a woman a hijab, on by default for Gulf drafts. Only to change a default: { arms: "covered" | "sleeved", hijab: true | false }. Never less modest than the Preset allows; a hijab for a man is refused.',
        ),
      aspect_ratio: z.literal(REACTION.aspectRatio).default(REACTION.aspectRatio),
      music: z
        .boolean()
        .default(true)
        .describe(
          'Music Bed under the voice, on by default. Set false for a voice-only Short, e.g. when the user will add a sound in TikTok. The quote says whether a bed will be mixed.',
        ),
    })
    .refine((d) => Boolean(d.product_image_url) !== Boolean(d.product_image_base64), {
      message: 'provide exactly one of product_image_url (any https URL) or product_image_base64 (data URL or raw base64)',
      path: ['product_image_url'],
    }),
);

/** The refusals make_reaction adds to a Preset render's (RENDER_REFUSALS), by code. */
export const REACTION_REFUSALS = {
  character_not_found: {
    status: 404,
    when: 'no such saved character on this account (someone else’s, or an archived one, is indistinguishable from none)',
  },
  LESS_MODEST_THAN_PRESET: {
    status: 400,
    when: 'the modesty choice is less modest than the Preset allows (arms under "sleeved", or a required hijab turned off)',
  },
  HIJAB_NOT_OFFERED: { status: 400, when: 'a hijab was asked for a man; it is offered only for a woman on screen' },
} as const satisfies Record<string, { status: number; when: string }> & Record<ModestyErrorCode, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SavedCharacterRow {
  id: string;
  public_id: string | null;
  portrait_url: string | null;
  character_sheet_url: string | null;
}

/**
 * Resolve make_reaction's own inputs, for the quote and the run alike: the
 * caller's saved character, and the Modesty Default for the draft's Dialect.
 * On the run it also re-hosts (and moderates) the character's reference — the
 * clean portrait if it has one (a face, not a pose grid of outfits), else its
 * sheet — for the worker, which passes it on reaction shots only.
 */
export const resolveReactionInputs: PresetInputResolver = async ({ userId, body, draft, preset, stage, db, rehostImage }) => {
  let modesty: Modesty;
  try {
    modesty = resolveModesty(preset, {
      dialect: draft.dialect as Dialect,
      gender: body.character_gender as (typeof CHARACTER_GENDERS)[number],
      choice: body.modesty as z.infer<typeof modestyChoiceSchema> | undefined,
    });
  } catch (err) {
    if (err instanceof ModestyError) throw new RenderRefusal(REACTION_REFUSALS[err.code].status, err.code, err.message);
    throw err;
  }

  const ref = String(body.character_id ?? '').trim();
  const { data, error } = await db
    .from('user_characters')
    .select('id, public_id, portrait_url, character_sheet_url')
    .eq('user_id', userId)
    .eq(UUID.test(ref) ? 'id' : 'public_id', ref)
    .is('archived_at', null)
    .maybeSingle();
  if (error) throw new Error(`user_characters read: ${error.message}`);
  const character = data as SavedCharacterRow | null;
  const source = character?.portrait_url || character?.character_sheet_url;
  if (!character || !source) {
    throw new RenderRefusal(
      REACTION_REFUSALS.character_not_found.status,
      'character_not_found',
      'No such saved character on this account. Pick one of your characters (list_characters).',
    );
  }

  const run = {
    character_id: character.public_id ?? character.id,
    character_gender: body.character_gender,
    modesty,
  };
  if (stage === 'quote') return { run, workflow: {}, quote: { modesty } };
  const hosted = await rehostImage(userId, source);
  return { run, workflow: { character_image_url: hosted.url, modesty }, quote: { modesty } };
};
