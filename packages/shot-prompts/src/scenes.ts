// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Each Preset's scene wording (#26) — the editable half of a Shot Prompt.
 *
 * A scene says what happens in the shot, provider-neutral: "the product", "the
 * person", never an image reference (the Guardrails pin those, ./guardrails.ts)
 * and never a rule the render must keep (no speaking, modest styling, no text:
 * Guardrails too, so an edit can never drop them). `{name}` placeholders are
 * filled from the Preset's own inputs (Hands-on's `{hands}` and `{setting}`,
 * promptVars). On a hands or person shot the draft's Product Interaction (#25)
 * is part of the default scene.
 *
 * The starting-frame prompts (Hands-on's product-in-hands image, #18) are not
 * editable: they are composed whole here, with the Modesty Default and the
 * Product Interaction, as before.
 *
 * Server-side by design (CONTRIBUTING.md, "the spine"): this package is private,
 * never published with @agentmedia/schema. Pure data: the workflow sandbox
 * imports this.
 */

import {
  HAND_GENDERS,
  HANDS_ON_SETTINGS,
  tidyProductInteraction,
  type HandGender,
  type HandsOnSetting,
  type HandsOnShotKind,
  type Modesty,
  type ProductHeroShotKind,
  type ReactionShotKind,
  type ShotSubject,
} from '@agentmedia/schema';
import { modestyPrompt } from './modesty.js';

/** The Preset inputs a prompt can be worded from (a subset of the render input). */
export interface PromptVarInput {
  hand_gender?: unknown;
  setting?: unknown;
}

/** A Preset's prompt wording: a scene per shot kind, and a frame prompt per kind that starts from a frame. */
export interface PresetPrompts<Kind extends string = string> {
  /** The scene template for each kind of shot (provider-neutral; see the header). */
  scenes: Readonly<Record<Kind, string>>;
  /**
   * The image prompt for each kind that declares a starting frame
   * (shotKinds[kind].frame, #18). The product photo is the reference image.
   */
  framePrompts?: Readonly<Partial<Record<Kind, string>>>;
  /**
   * The Preset's own inputs as words for its templates' `{name}` placeholders.
   * Throws on an input it cannot word; the render refuses to start then.
   * Absent: the templates have no placeholders.
   */
  promptVars?: (input: PromptVarInput) => Readonly<Record<string, string>>;
}

/** `template` with every `{name}` filled from `vars`; throws on a placeholder `vars` does not fill. */
export function fillPrompt(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-z_]+)\}/g, (_m, name: string) => {
    if (!Object.hasOwn(vars, name)) throw new Error(`prompt placeholder {${name}} has no value`);
    return vars[name];
  });
}

/** A Product Interaction, tidied as api-v2 stored it, without its closing stop; '' for none. */
function interactionText(interaction: string | null | undefined): string {
  return (tidyProductInteraction(interaction) ?? '').replace(/[.\s]+$/, '');
}

/**
 * The Product Interaction as part of a hands or person shot's default scene
 * (#25); '' for a product shot or a draft with none. The Guardrails after the
 * scene keep it modest and silent.
 */
export function productInteractionScene(subject: ShotSubject, interaction: string | null | undefined): string {
  if (subject !== 'hands' && subject !== 'person') return '';
  const text = interactionText(interaction);
  return text ? `How the product is used, as a real person uses it: ${text}.` : '';
}

/**
 * The Product Interaction's words in a starting-frame prompt (#25): after the
 * Modesty Default, saying it keeps it (frame prompts are not split into scene
 * and Guardrails). Empty for a product shot, or a draft with none.
 */
export function productInteractionPrompt(subject: ShotSubject, interaction: string | null | undefined): string {
  if (subject !== 'hands' && subject !== 'person') return '';
  const text = interactionText(interaction);
  if (!text) return '';
  return (
    `How the product is used, as a real person uses it: ${text}. ` +
    'This only adds the action: every instruction above still holds — nobody speaks or mouths words, and the clothing stays exactly as modest as described.'
  );
}

/**
 * The full image prompt for the starting frame of a shot showing `subject`
 * (#18): the frame template, plus the Modesty Default and then the Product
 * Interaction when it shows a person or hands — the frame is what the clip
 * animates, so it must be modest too, and already mid-use.
 */
export function composeFramePrompt(
  template: string,
  subject: ShotSubject,
  modesty: Modesty,
  vars: Readonly<Record<string, string>> = {},
  interaction: string | null = null,
): string {
  return [fillPrompt(template, vars), modestyPrompt(subject, modesty), productInteractionPrompt(subject, interaction)].filter(Boolean).join(' ');
}

// ── Product Hero ─────────────────────────────────────────────────────────────

/** A hero shot, then a closer on a different move so the hard cut reads as an edit. Nobody on screen. */
export const PRODUCT_HERO_PROMPTS: PresetPrompts<ProductHeroShotKind> = {
  scenes: {
    hero: 'Premium product commercial, hero shot of the product: it stands centered on a clean, softly lit surface, the camera slowly pushes in and orbits a few degrees, gentle rim light glides across its surfaces. Shallow depth of field, smooth cinematic motion.',
    detail:
      'Premium product commercial, closing detail shot of the product: a slow macro slide along it revealing texture, materials and finish, then settling on a clean three-quarter view of the whole product. Soft studio light, smooth cinematic motion.',
  },
};

// ── Reaction (#19) ───────────────────────────────────────────────────────────

/**
 * The saved character reacts SILENTLY to the product (the no-speaking
 * Guardrail keeps the mouth closed; a moving mouth under an Arabic voice-over
 * reads as a bad dub), intercut with the product alone.
 */
export const REACTION_PROMPTS: PresetPrompts<ReactionShotKind> = {
  scenes: {
    reaction:
      'UGC-style reaction shot, medium close-up. The person holds the product near their face and reacts to it silently with ONE natural reaction: a warm genuine smile, a small approving nod, a moment of pleasant surprise, or eyes closing briefly while enjoying the scent. Soft natural light, gentle handheld feel, shallow depth of field.',
    product:
      'Premium product commercial shot of the product: it stands on a clean, softly lit surface, the camera slowly pushes in and glides a few degrees around it, gentle light moving across its surfaces, settling on a clean three-quarter view. Shallow depth of field, smooth cinematic motion.',
  },
};

// ── Hands-on (#18) ───────────────────────────────────────────────────────────

/** Whose hands, as the prompts say it. */
export const HAND_WORDS: Readonly<Record<HandGender, string>> = {
  female: "a woman's hands with neat, natural nails",
  male: "a man's hands",
};

/** Where the hands are, as the prompts say it. */
export const SETTING_WORDS: Readonly<Record<HandsOnSetting, string>> = {
  dressing_table: 'at an elegant dressing table with a softly lit mirror and a few tasteful accessories',
  car: 'inside a modern car, seen from the driver’s seat, daylight coming through the windscreen',
  majlis: 'in a traditional Arabian majlis with floor cushions, patterned rugs and warm lamplight',
  kitchen: 'in a clean, modern home kitchen on a marble counter in soft morning light',
  desk: 'at a tidy modern work desk by a window in soft daylight',
  outdoors: 'outdoors in soft golden-hour daylight with a softly blurred garden behind',
};

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/**
 * Each hands shot starts from a product-in-hands frame (a gpt-image edit of the
 * product photo, framePrompts), then animated silently; the product closer
 * animates the product photo itself.
 */
export const HANDS_ON_PROMPTS: PresetPrompts<HandsOnShotKind> = {
  framePrompts: {
    hands:
      'Photorealistic first-person (POV) photograph, vertical composition: {hands} have just lifted the exact product from the reference image out of its open packaging and hold it toward the camera, {setting}. ' +
      'The product keeps its exact shape, colours, logo and label text, sharp and in focus, label facing the camera. ' +
      'Only the hands and forearms are in frame: no face, no other person. Natural, flattering light, realistic skin texture, shallow depth of field. No text overlays, no captions, no watermark.',
  },
  scenes: {
    hands:
      'First-person POV product video: {hands} lift the product clear of its packaging, turn it slowly to show it from a few angles and use it naturally, {setting}; the shot ends with the product held up toward the camera, label facing the lens. Natural light, smooth gentle handheld motion.',
    product:
      'Closing product shot of the product, standing on a clean surface {setting}: a slow push-in that settles on a clean three-quarter view of the whole product, soft light gliding across it. Shallow depth of field, smooth cinematic motion.',
  },
  promptVars(input) {
    if (!oneOf(HAND_GENDERS, input.hand_gender)) throw new Error(`Hands-on needs hand_gender male or female; got ${String(input.hand_gender)}`);
    if (!oneOf(HANDS_ON_SETTINGS, input.setting)) throw new Error(`Hands-on needs a setting from the list; got ${String(input.setting)}`);
    return { hands: HAND_WORDS[input.hand_gender], setting: SETTING_WORDS[input.setting] };
  },
};

/** Every Preset's prompt wording, by Preset id (PresetDefinition.id). */
export const PRESET_PROMPTS: Readonly<Record<string, PresetPrompts>> = {
  product_hero: PRODUCT_HERO_PROMPTS as PresetPrompts,
  reaction: REACTION_PROMPTS as PresetPrompts,
  hands_on: HANDS_ON_PROMPTS as PresetPrompts,
};

/** The prompt wording of Preset `id`; throws on an id with none. */
export function presetPrompts(id: string): PresetPrompts {
  if (!Object.hasOwn(PRESET_PROMPTS, id)) throw new Error(`no prompts for Preset: ${id}`);
  return PRESET_PROMPTS[id];
}
