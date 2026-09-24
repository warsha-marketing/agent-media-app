// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The product's used state and real size in a Shot Prompt (#31, CONTEXT.md):
 *
 *   In-use Reference — the product photo edited into the state it is used in
 *       (a perfume uncapped), product only. inUseReferencePrompt is the edit's
 *       prompt; inUseReferenceLine is the Guardrail every hands and person
 *       shot carries (both stages) when the render uses the draft's (made at
 *       drafting, api-v2): the product looks
 *       exactly as in its reference, and the parts it is used without are
 *       nowhere in the scene (owner test M1b, 2026-09-24: the uncapped
 *       reference plus "no cap anywhere in the scene" ended the duplicate cap).
 *   Scale Anchor — the Product Profile's size class (and dimensions, when
 *       known) as a physical comparison, so the product renders at its real
 *       size: every hands and person shot, both stages, never a product shot.
 *
 * The words come from the Product Profile, which the user may edit: part
 * names and the used state are stripped of anything that reads as prompt
 * syntax before they go into a prompt.
 *
 * Pure: the workflow sandbox imports this.
 */

import { removableParts, type PersonGender, type ProductProfile, type SizeClass } from '@agentmedia/schema';
import { REFERENCE_TOKENS } from './references.js';

/** What a Shot Prompt reads from the Product Profile. */
export type ProfileWords = Pick<ProductProfile, 'size_class' | 'dimensions' | 'parts'>;

/** The product side of a Shot Plan (#31): the Profile, and whether the render uses the draft's In-use Reference. */
export interface ShotProductContext {
  profile: ProfileWords | null;
  /** The render uses the draft's In-use Reference (renderUsesInUseReference): the product reference of every hands and person shot. */
  inUseReference: boolean;
  /** Hands-on: whose hands (the Scale Anchor says "her palm" / "his palm"). */
  handGender?: PersonGender | null;
}

/** User text as a prompt may carry it: no brackets, braces, @references or tags; one line. */
function cleanWords(text: string): string {
  return text
    .replace(/[[\]{}<>@#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?…;,:\s]+$/, '');
}

/** "cap", "cap and seal", "cap, seal and wrapper". */
function listWords(xs: readonly string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** The removable parts, cleaned, for a prompt. */
function removedParts(profile: Pick<ProductProfile, 'parts'> | null | undefined): string[] {
  return removableParts(profile).map(cleanWords).filter(Boolean);
}

// ── Scale Anchor ─────────────────────────────────────────────────────────────

/** The comparison per size class, with `{p}` for whose hand ("her", "his", "the"). */
export const SCALE_ANCHOR_WORDS: Readonly<Record<SizeClass, string>> = {
  tiny: 'tiny, about the size of {p} thumb, held between the fingertips',
  palm: 'small, about the height of {p} palm, fits easily in one hand',
  hand: 'about as tall as {p} whole hand, held comfortably in one hand',
  two_hands: 'large, wider than {p} hand, held with both hands',
  large: 'large, far bigger than {p} hands, resting on a surface rather than held up',
};

const POSSESSIVE: Readonly<Record<PersonGender, string>> = { female: 'her', male: 'his' };

/** A dimension as a prompt says it: at most one decimal, no trailing ".0". */
const num = (n: number) => String(Math.round(n * 10) / 10);

/** The known dimensions in words ("about 12 cm tall, about 5 cm wide, 100 ml"), or '' when none is known. */
export function dimensionWords(d: ProductProfile['dimensions'] | null | undefined): string {
  if (!d) return '';
  const out: string[] = [];
  if (d.height_cm) out.push(`about ${num(d.height_cm)} cm tall`);
  if (d.width_cm) out.push(`about ${num(d.width_cm)} cm wide`);
  if (d.volume_ml) out.push(`${num(d.volume_ml)} ml`);
  return out.join(', ');
}

/**
 * The Scale Anchor Guardrail line for a hands or person shot, from the size
 * class (and the dimensions, when known); `gender` names whose hand. Null
 * without a Profile.
 */
export function scaleAnchorLine(profile: Pick<ProfileWords, 'size_class' | 'dimensions'> | null | undefined, gender?: PersonGender | null): string | null {
  if (!profile) return null;
  const words = SCALE_ANCHOR_WORDS[profile.size_class].split('{p}').join(gender ? POSSESSIVE[gender] : 'the');
  const dims = dimensionWords(profile.dimensions);
  return `Real size: the product is ${words}${dims ? ` (${dims})` : ''}; it keeps exactly this size next to the hands and body in every frame.`;
}

// ── In-use Reference ─────────────────────────────────────────────────────────

/**
 * The In-use Reference Guardrail line for a hands or person shot, when the
 * render uses one: the product exactly as in its reference image, and every
 * removable part nowhere in the scene.
 */
export function inUseReferenceLine(profile: Pick<ProductProfile, 'parts'> | null | undefined): string {
  const parts = removedParts(profile);
  const base = `The product is already in the state it is used in, exactly as in ${REFERENCE_TOKENS.start}`;
  if (parts.length === 0) return `${base}: nothing is added to it or taken off it.`;
  const list = listWords(parts);
  const verb = parts.length === 1 ? 'is' : 'are';
  return `${base}: the ${list} ${verb} removed and nowhere in the scene (not in a hand, not on a surface, not in the background), and no second ${list} appears.`;
}

/**
 * The prompt of the In-use Reference itself: a gpt-image edit of the product
 * photo into its used state, product only, everything else identical. Its one
 * reference image is the product photo.
 */
export function inUseReferencePrompt(profile: Pick<ProductProfile, 'used_state' | 'parts'>): string {
  const state = cleanWords(profile.used_state);
  const parts = removedParts(profile);
  const lines = [`Edit this product photo to show the exact same product in the state it is used in${state ? `: ${state}` : ''}.`];
  if (parts.length > 0) {
    const list = listWords(parts);
    lines.push(`The ${list} ${parts.length === 1 ? 'is' : 'are'} REMOVED and nowhere in the image: not beside the product, not in the background.`);
  }
  lines.push(
    'Keep everything else exactly the same: the product’s shape, proportions, colours, materials, logo and label text, and the photo’s background, light and camera angle.',
    'The product only: no people, no hands, no text added, no watermark.',
  );
  return lines.join(' ');
}
