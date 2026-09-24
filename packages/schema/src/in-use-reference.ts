// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * In-use Reference (#31, CONTEXT.md) — the product photo edited into the state
 * the product is used in (a perfume uncapped, a jar open), product only, no
 * person. It is made once per render, before any starting frame or clip, and
 * is the product reference of every hands and person shot; product-only shots
 * keep the packshot.
 *
 * The ONE decision (inUseReferenceNeeded), read by api-v2 (the quote, the run
 * reservation, the Shot Plan) and the worker (whether it makes one), so the
 * quote prices exactly the step the render charges:
 *   - the Preset shows hands or a person (else no shot would use it),
 *   - the draft's Product Profile says the used state differs from the photo,
 *   - and the user did not ask for the original photo instead.
 *
 * Priced like a starting frame: one gpt-image edit (the same table the worker
 * charges from).
 */

import type { PresetDefinition } from './preset-definition.js';
import { presetShows } from './modesty.js';
import type { ProductProfile } from './product-profile.js';

/** Credits charged for the In-use Reference (one image edit, like a starting frame). */
export const IN_USE_REFERENCE_CREDITS = 35;

/** Our provider-cost ESTIMATE for it (USD): one gpt-image edit, 1024×1536. */
export const IN_USE_REFERENCE_USD = 0.25;

/** Whether any shot of `preset` could use an In-use Reference: one that shows hands or a person. */
export function presetTakesInUseReference(preset: Pick<PresetDefinition, 'shotKinds'>): boolean {
  return presetShows(preset, 'hands') || presetShows(preset, 'person');
}

/**
 * Whether this render makes (and charges) an In-use Reference: the Preset has a
 * hands or person shot, the Profile's used state differs from the photo, and
 * the user did not choose the original photo (`useOriginal`). A draft with no
 * Profile (from before #30) never gets one.
 */
export function inUseReferenceNeeded(
  preset: Pick<PresetDefinition, 'shotKinds'>,
  profile: Pick<ProductProfile, 'differs_from_photo'> | null | undefined,
  useOriginal: boolean | null | undefined,
): boolean {
  return presetTakesInUseReference(preset) && profile?.differs_from_photo === true && useOriginal !== true;
}

/** The parts the product is used without (profile.parts with removable: true), by name, de-duplicated. */
export function removableParts(profile: Pick<ProductProfile, 'parts'> | null | undefined): string[] {
  const out: string[] = [];
  for (const p of profile?.parts ?? []) {
    const name = p.name.trim();
    if (p.removable && name && !out.some((n) => n.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}
