// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * In-use Reference (#31) at the render routes: whether a Preset render uses
 * the draft's, and how the quote, the run and the Shot Plan show it.
 *
 * The In-use Reference is made at DRAFTING time (drafts/product-hero-draft.ts:
 * free, right after the Product Profile) and stored on the draft
 * (short_drafts.in_use_reference). A render REUSES it — nothing is made or
 * charged at render, so the quote never prices it. The decision is made ONCE
 * per request (renderInUseReference, @agentmedia/schema
 * renderUsesInUseReference): the Preset shows hands or a person, the draft has
 * one made, and the body did not set `use_original_product_photo`. The run
 * hands the worker its URL only then; a draft whose edit failed renders from
 * the original photo.
 */

import { z } from 'zod';
import {
  IN_USE_REFERENCE_FAILED_MESSAGE,
  presetTakesInUseReference,
  renderUsesInUseReference,
  type DraftInUseReference,
  type PresetDefinition,
} from '@agentmedia/schema';
import type { RenderableDraft } from './product-hero-render.js';

/** The "use original instead" override, on a Preset render with hands or a person (skills/preset-inputs.ts). */
export const useOriginalProductPhotoField = z
  .boolean()
  .default(false)
  .describe(
    'Only when the draft has an In-use Reference (its `in_use_reference`, made when drafting because the Product Profile says the product is used in another state than the photo, e.g. uncapped): true renders the hands and person shots from the original product photo instead. Never changes the price. Default false.',
  );

/** The body field the decision reads. */
const InUseChoiceSchema = z.object({ use_original_product_photo: z.boolean().optional() }).passthrough();

/** One render's In-use Reference decision, made once per request. */
export interface RenderInUseReference {
  /** The draft's, as stored (validated when the draft was resolved); null: none. */
  stored: DraftInUseReference | null;
  /** The body asked for the original photo. */
  useOriginal: boolean;
  /** The image the hands and person shots are made from, when the render uses it; else null. */
  url: string | null;
}

/** Whether (and which) In-use Reference this render uses: decided once, read by the Shot Plan, the quote and the run. */
export function renderInUseReference(
  preset: Pick<PresetDefinition, 'shotKinds'>,
  draft: Pick<RenderableDraft, 'in_use_reference'>,
  body: Record<string, unknown>,
): RenderInUseReference {
  const parsed = InUseChoiceSchema.safeParse(body);
  const useOriginal = parsed.success && parsed.data.use_original_product_photo === true;
  const stored = draft.in_use_reference ?? null;
  return { stored, useOriginal, url: renderUsesInUseReference(preset, stored, useOriginal) ? stored.url : null };
}

/**
 * What the quote and the run's 202 say about it (`in_use_reference`): null
 * when the Preset shows nobody to use it or the draft has none; else whether
 * this render uses it and what it shows (so the user can choose the original
 * instead), or the flag that the edit failed at drafting.
 */
export function inUseReferenceView(preset: Pick<PresetDefinition, 'shotKinds'>, inUse: RenderInUseReference) {
  const { stored } = inUse;
  if (!stored || !presetTakesInUseReference(preset)) return null;
  if (stored.status === 'failed') return { status: 'failed' as const, used: false, message: IN_USE_REFERENCE_FAILED_MESSAGE };
  return {
    status: 'made' as const,
    used: inUse.url !== null,
    use_original_product_photo: inUse.useOriginal,
    image_url: stored.url,
    used_state: stored.used_state,
    removed_parts: stored.removed_parts,
  };
}
