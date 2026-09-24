// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The Product Profile (#30) in the web Product Hero flow: what the system
 * understood about the product from its photo and Product Details. The page
 * shows its key fields (category, size, used state, how it is used) and lets
 * the user correct them; an edit re-voices into a new draft, like a Script
 * edit, and the server re-writes the Product Interaction from the edited
 * Profile (services/api-v2/src/drafts/product-hero-draft.ts).
 *
 * No imports: scripts/tests loads this file directly. The lists and limits
 * mirror @agentmedia/schema (product-profile.ts), held equal by
 * scripts/tests/delivery-tags-parity.test.ts.
 */

/** PRODUCT_CATEGORIES in @agentmedia/schema, with the label the page shows. */
export const PROFILE_CATEGORIES = [
  { id: 'fragrance_oud', label: 'Fragrance & oud' },
  { id: 'skincare_beauty', label: 'Skincare & beauty' },
  { id: 'food_cafe', label: 'Food & café' },
  { id: 'electronics', label: 'Electronics' },
  { id: 'fashion_modest', label: 'Modest fashion' },
  { id: 'home', label: 'Home' },
  { id: 'other', label: 'Other' },
] as const;

/** SIZE_CLASSES in @agentmedia/schema: how big it is next to a hand. */
export const PROFILE_SIZE_CLASSES = [
  { id: 'tiny', label: 'Smaller than a finger' },
  { id: 'palm', label: 'Fits in a palm' },
  { id: 'hand', label: 'Fills a hand' },
  { id: 'two_hands', label: 'Held with both hands' },
  { id: 'large', label: 'Too big to hold' },
] as const;

/** The schema's limits on the fields the page edits. */
export const USED_STATE_MAX = 160;
export const VERB_MAX = 30;
export const VERBS_MAX = 6;

/** A Product Profile as the API returns it (validated server-side). */
export interface ProductProfile {
  category: string;
  dimensions: { height_cm: number | null; width_cm: number | null; volume_ml: number | null };
  size_class: string;
  parts: Array<{ name: string; removable: boolean }>;
  used_state: string;
  differs_from_photo: boolean;
  interaction_verbs: string[];
  grip: string;
  physics_risks: string[];
  confidence: number;
}

/** The fields the page edits; how_used is the interaction verbs, comma-separated. */
export interface ProfileFields {
  category: string;
  size_class: string;
  used_state: string;
  how_used: string;
}

export function profileFieldsOf(profile: ProductProfile | null | undefined): ProfileFields | null {
  if (!profile) return null;
  return {
    category: profile.category,
    size_class: profile.size_class,
    used_state: profile.used_state,
    how_used: profile.interaction_verbs.join(', '),
  };
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

function verbsOf(howUsed: string): string[] {
  const out: string[] = [];
  for (const v of howUsed.split(',')) {
    const verb = tidy(v).toLowerCase().slice(0, VERB_MAX).trim();
    if (verb && !out.includes(verb)) out.push(verb);
  }
  return out.slice(0, VERBS_MAX);
}

/**
 * The Profile with the page's fields applied, tidied as the server stores them.
 * An emptied used state or "how it is used" keeps the draft's value (the
 * server needs one), so clearing a field never makes an edit it would refuse.
 */
export function applyProfileFields(profile: ProductProfile, fields: ProfileFields): ProductProfile {
  const usedState = tidy(fields.used_state).slice(0, USED_STATE_MAX).trim();
  const verbs = verbsOf(fields.how_used);
  return {
    ...profile,
    category: fields.category,
    size_class: fields.size_class,
    used_state: usedState || profile.used_state,
    interaction_verbs: verbs.length ? verbs : profile.interaction_verbs,
  };
}

/** Whether the fields on screen change the draft's Profile. */
export function isProfileEdited(profile: ProductProfile | null | undefined, fields: ProfileFields | null): boolean {
  if (!profile || !fields) return false;
  return JSON.stringify(applyProfileFields(profile, fields)) !== JSON.stringify(profile);
}

/**
 * The Product Profile field of a re-voice request: the whole edited Profile,
 * sent only when the user changed it; otherwise omitted, so the parent's
 * carries over.
 */
export function profileEdit(profile: ProductProfile | null | undefined, fields: ProfileFields | null): { product_profile?: ProductProfile } {
  if (!profile || !fields || !isProfileEdited(profile, fields)) return {};
  return { product_profile: applyProfileFields(profile, fields) };
}

/** The size as the page says it: the class, with the real dimensions when known. */
export function sizeLabel(profile: ProductProfile): string {
  const cls = PROFILE_SIZE_CLASSES.find((s) => s.id === profile.size_class)?.label ?? profile.size_class;
  const d = profile.dimensions;
  const parts = [cls];
  if (d.height_cm) parts.push(`${d.height_cm} cm tall`);
  if (d.volume_ml) parts.push(`${d.volume_ml} ml`);
  return parts.join(' · ');
}
