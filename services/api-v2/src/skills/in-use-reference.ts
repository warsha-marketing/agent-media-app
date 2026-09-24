// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * In-use Reference (#31) at the routes: whether a Preset render makes one, and
 * how the quote, the run and the Shot Plan show it.
 *
 * The decision is inUseReferenceNeeded (@agentmedia/schema), the one the
 * worker makes too: the Preset shows hands or a person, the draft's Product
 * Profile says the used state differs from the photo, and the body did not set
 * `use_original_product_photo`. The quote and the run put it on the priced
 * input (`in_use_reference`), which the skill run stores, so the in-flight
 * reservation prices it like the quote did; the worker gets the Profile and
 * the override and decides the same way.
 *
 * Where it lives: an artifact of the render (primitive_artifacts, kind
 * in_use_reference, on its own child run; final_output.in_use_reference on the
 * Short), not on the draft. It is paid for by the render, which is where the
 * quote prices it, and it is made from the product photo the run is given
 * (the draft stores none); a re-render makes (and charges) it again.
 */

import { z } from 'zod';
import {
  IN_USE_REFERENCE_CREDITS,
  inUseReferenceNeeded,
  presetTakesInUseReference,
  removableParts,
  type PresetDefinition,
  type ProductProfile,
} from '@agentmedia/schema';
import type { RenderableDraft } from './product-hero-render.js';

/** The "use original instead" override, on a Preset render with hands or a person (skills/preset-inputs.ts). */
export const useOriginalProductPhotoField = z
  .boolean()
  .default(false)
  .describe(
    'Only when the quote shows an `in_use_reference` (the Product Profile says the product is used in another state than the photo, e.g. uncapped): true renders the hands and person shots from the original product photo instead, and the quote drops the In-use Reference step. Default false.',
  );

/** Whether this render makes an In-use Reference (what the quote prices and the worker makes). */
export function renderMakesInUseReference(
  preset: Pick<PresetDefinition, 'shotKinds'>,
  draft: Pick<RenderableDraft, 'product_profile'>,
  body: Record<string, unknown>,
): boolean {
  return inUseReferenceNeeded(preset, draft.product_profile ?? null, body.use_original_product_photo === true);
}

/**
 * What the quote and the run's 202 say about it (`in_use_reference`): null when
 * the render could never make one (no hands or person shot, no Profile, or
 * the used state is the photo's); else whether it will be made, what it will
 * show, and its price — so the user can choose the original instead.
 */
export function inUseReferenceView(
  preset: Pick<PresetDefinition, 'shotKinds'>,
  draft: Pick<RenderableDraft, 'product_profile'>,
  body: Record<string, unknown>,
) {
  const profile: ProductProfile | null = draft.product_profile ?? null;
  if (!presetTakesInUseReference(preset) || !profile?.differs_from_photo) return null;
  const made = renderMakesInUseReference(preset, draft, body);
  return {
    made,
    use_original_product_photo: !made,
    used_state: profile.used_state,
    removed_parts: removableParts(profile),
    credits: made ? IN_USE_REFERENCE_CREDITS : 0,
  };
}
