// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * In-use Reference (#31, CONTEXT.md) — the product photo edited into the state
 * the product is used in (a perfume uncapped, a jar open), product only, no
 * person. The product reference of every hands and person shot; product-only
 * shots keep the packshot.
 *
 * Made at DRAFTING time (owner decision), right after the Product Profile,
 * when the Profile says the used state differs from the photo
 * (inUseReferenceNeeded): drafting is free, so it is never priced. It is
 * stored on the draft (short_drafts.in_use_reference, DraftInUseReference),
 * shown next to the photo before the user confirms, and a render REUSES it
 * (renderUsesInUseReference) — never made or charged again. An edit that
 * fails leaves the draft without one, flagged (`status: 'failed'`): the render
 * then uses the original photo.
 */

import { z } from 'zod';
import type { PresetDefinition } from './preset-definition.js';
import { presetShows } from './modesty.js';
import type { ProductProfile } from './product-profile.js';

/** Whether any shot of `preset` could use an In-use Reference: one that shows hands or a person. */
export function presetTakesInUseReference(preset: Pick<PresetDefinition, 'shotKinds'>): boolean {
  return presetShows(preset, 'hands') || presetShows(preset, 'person');
}

/**
 * Whether a draft with `profile` gets an In-use Reference: its Product Profile
 * says the used state differs from the photo. A draft with no Profile never does.
 */
export function inUseReferenceNeeded(profile: Pick<ProductProfile, 'differs_from_photo'> | null | undefined): boolean {
  return profile?.differs_from_photo === true;
}

const httpsUrl = z.string().max(2_000).regex(/^https:\/\//, 'an https URL');
const storageKey = z.string().min(1).max(300);

/**
 * A draft's In-use Reference as stored: `made` (the image, by storage key and
 * public URL, what it shows, and which photo it was edited from) or `failed`
 * (the edit was refused or errored: no image, and the render uses the photo).
 * NULL on the draft = none was needed (or a draft from before it).
 */
export const DraftInUseReferenceSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('made'),
      key: storageKey,
      url: httpsUrl,
      /** The product photo it was edited from (the user's own upload). */
      source_photo_key: storageKey,
      /** What it shows: the Profile's used state and removed parts when it was made. */
      used_state: z.string().max(200),
      removed_parts: z.array(z.string().max(60)).max(8),
      model: z.string().max(100),
      made_at: z.string().max(40),
    })
    .strict(),
  z
    .object({
      status: z.literal('failed'),
      /** The photo it would have been edited from; null when the draft had none. */
      source_photo_key: storageKey.nullable(),
      /** Why, for the operators (never shown to the user as is). */
      reason: z.string().max(300),
      failed_at: z.string().max(40),
    })
    .strict(),
]);
export type DraftInUseReference = z.output<typeof DraftInUseReferenceSchema>;

/** The failed-edit flag as the user reads it (the provider's words stay on the draft row, for the operators). */
export const IN_USE_REFERENCE_FAILED_MESSAGE =
  'We could not make the In-use Reference of your product, so hands and person shots will use your original photo. Re-voice to try again.';

/** A stored In-use Reference, validated; null for none or anything that is not one. */
export function parseDraftInUseReference(value: unknown): DraftInUseReference | null {
  const r = DraftInUseReferenceSchema.safeParse(value);
  return r.success ? r.data : null;
}

/**
 * Whether a render of `preset` uses the draft's In-use Reference: the Preset
 * has a hands or person shot, the draft has one made, and the user did not
 * choose the original photo (`useOriginal`).
 */
export function renderUsesInUseReference(
  preset: Pick<PresetDefinition, 'shotKinds'>,
  stored: DraftInUseReference | null | undefined,
  useOriginal: boolean | null | undefined,
): stored is Extract<DraftInUseReference, { status: 'made' }> {
  return presetTakesInUseReference(preset) && stored?.status === 'made' && useOriginal !== true;
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
