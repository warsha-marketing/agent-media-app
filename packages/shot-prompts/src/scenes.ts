// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Each Preset's shot wording (#26, #28) — the editable half of a Shot Prompt,
 * as structured fields per shot kind (./shot-fields.ts).
 *
 * The fields say what happens in the shot, provider-neutral: "the product",
 * "the person", never an image reference (the Guardrails pin those,
 * ./guardrails.ts) and never a rule the render must keep (no speaking, modest
 * styling, simple physics, no text: Guardrails too, so an edit can never drop
 * them). `{name}` placeholders are filled from the Preset's own inputs
 * (Hands-on's `{hands}` and `{setting}`, promptVars). A hands or person shot's
 * `action` is the draft's Product Interaction (#25); every other field is the
 * Preset's. The defaults hold to the video stage's simple_physics Guardrail and
 * to the owner's rules from test M3 (#32): one main hand-and-product action per
 * shot, the product already out of its packaging and in its used state (never
 * unpacked, uncapped or taken apart on camera), never brought to a reacting
 * face (a smell beat is on the skin, after the product is set down). Shots
 * that show hands or a person carry no cinematic wording (shallow depth of
 * field, smooth cinematic motion, golden hour, warm lamps): it makes skin look
 * waxy on Seedance (ADR 0003), and the realism Guardrail (#29) forbids it.
 *
 * A shot kind that starts from a frame (#18, Hands-on's product-in-hands image)
 * also has a frame scene: what the still shows. Not editable; the image-stage
 * prompt is it, the shot's action, and the image-stage Guardrails.
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
  type ProductHeroShotKind,
  type ReactionShotKind,
  type ShotSubject,
} from '@agentmedia/schema';
import type { ShotEnergy, ShotTextField } from './shot-fields.js';

/** The Preset inputs a prompt can be worded from (a subset of the render input). */
export interface PromptVarInput {
  hand_gender?: unknown;
  setting?: unknown;
}

/**
 * One shot kind's default fields: a scene and an energy always, the rest where
 * the Preset has something to say. Never `action` (the Product Interaction).
 */
export type ShotFieldDefaults = { scene: string; energy: ShotEnergy } & Partial<Record<Exclude<ShotTextField, 'scene' | 'action'>, string>>;

/** A Preset's prompt wording: default fields per shot kind, and a frame scene per kind that starts from a frame. */
export interface PresetPrompts<Kind extends string = string> {
  /** The default fields of each kind of shot (provider-neutral; see the header). */
  shots: Readonly<Record<Kind, ShotFieldDefaults>>;
  /**
   * What the starting frame shows, for each kind that declares one
   * (shotKinds[kind].frame, #18). The product photo is the reference image.
   */
  frameScenes?: Readonly<Partial<Record<Kind, string>>>;
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

/**
 * The Product Interaction as a hands or person shot's default `action` (#25);
 * '' for a product shot or a draft with none. The Guardrails after the fields
 * keep it modest, silent and physically simple.
 */
export function productInteractionAction(subject: ShotSubject, interaction: string | null | undefined): string {
  if (subject !== 'hands' && subject !== 'person') return '';
  const text = (tidyProductInteraction(interaction) ?? '').replace(/[.\s]+$/, '');
  return text ? `How the product is used, as a real person uses it: ${text}.` : '';
}

// ── Product Hero ─────────────────────────────────────────────────────────────

/** A hero shot, then a closer on a different move so the hard cut reads as an edit. Nobody on screen. */
export const PRODUCT_HERO_PROMPTS: PresetPrompts<ProductHeroShotKind> = {
  shots: {
    hero: {
      framing: 'Premium product commercial, hero shot of the product.',
      scene: 'The product stands centered on a clean, softly lit surface.',
      energy: 'calm',
      camera_move: 'The camera slowly pushes in and orbits a few degrees, smooth cinematic motion.',
      lens_feel: 'Shallow depth of field.',
      lighting: 'Gentle rim light glides across its surfaces.',
    },
    detail: {
      framing: 'Premium product commercial, closing detail shot of the product.',
      scene: 'Its texture, materials and finish are revealed.',
      blocking: 'The shot settles on a clean three-quarter view of the whole product.',
      energy: 'calm',
      camera_move: 'A slow macro slide along the product, smooth cinematic motion.',
      lighting: 'Soft studio light.',
    },
  },
};

// ── Reaction (#19) ───────────────────────────────────────────────────────────

/**
 * The saved character reacts SILENTLY to the product (the no-speaking
 * Guardrail keeps the mouth closed; a moving mouth under an Arabic voice-over
 * reads as a bad dub), intercut with the product alone.
 */
export const REACTION_PROMPTS: PresetPrompts<ReactionShotKind> = {
  shots: {
    reaction: {
      framing: 'UGC-style reaction shot, medium close-up, filmed on a phone.',
      scene: 'The person reacts to the product.',
      blocking:
        'The product stays at chest height or on the surface in front of them, never near the face and never brought to the face. To smell it, they first set the product down, then smell the skin of the inner wrist.',
      performance:
        'They react silently with ONE natural reaction: a warm genuine smile, a small approving nod or a moment of pleasant surprise.',
      energy: 'natural',
      camera_move: 'Handheld phone camera with a slight natural sway.',
      lens_feel: 'Everyday phone-camera look, the background in focus.',
      lighting: 'Flat, even everyday daylight.',
    },
    product: {
      framing: 'Premium product commercial shot of the product.',
      scene: 'The product stands on a clean, softly lit surface.',
      blocking: 'The shot settles on a clean three-quarter view.',
      energy: 'calm',
      camera_move: 'The camera slowly pushes in and glides a few degrees around it, smooth cinematic motion.',
      lens_feel: 'Shallow depth of field.',
      lighting: 'Gentle light moves across its surfaces.',
    },
  },
};

// ── Hands-on (#18) ───────────────────────────────────────────────────────────

/** Whose hands, as the prompts say it. */
export const HAND_WORDS: Readonly<Record<HandGender, string>> = {
  female: "a woman's hands with neat, natural nails",
  male: "a man's hands",
};

/**
 * Where the hands are, as the prompts say it. The pre-Set wording: once a
 * Short has a Set (#33), shots name the Set by id instead. Everyday daylight,
 * the background in view: no golden hour, warm lamplight or blur (ADR 0003).
 */
export const SETTING_WORDS: Readonly<Record<HandsOnSetting, string>> = {
  dressing_table: 'at an elegant dressing table with a softly lit mirror and a few tasteful accessories',
  car: 'inside a modern car, seen from the driver’s seat, daylight coming through the windscreen',
  majlis: 'in a traditional Arabian majlis with floor cushions and patterned rugs, in bright daylight from the windows',
  kitchen: 'in a clean, modern home kitchen on a marble counter in soft morning light',
  desk: 'at a tidy modern work desk by a window in soft daylight',
  outdoors: 'outdoors in bright, even daylight with a garden behind',
};

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/**
 * Each hands shot starts from a product-in-hands frame (a gpt-image edit of the
 * product photo, frameScenes), then animated silently; the product closer
 * animates the product photo itself. The frame already shows the product out
 * of its packaging and in its used state, so the clip has one continuous
 * action: the hands use it once (the Product Interaction says how).
 */
export const HANDS_ON_PROMPTS: PresetPrompts<HandsOnShotKind> = {
  frameScenes: {
    hands:
      'Photorealistic first-person (POV) photograph, vertical composition: {hands} hold the product toward the camera, {setting}. ' +
      'The product is already out of any packaging and in the state it is used in, sharp and in focus, label facing the camera. ' +
      'Everyday daylight, realistic skin texture, the background in focus.',
  },
  shots: {
    hands: {
      framing: 'First-person POV product video.',
      scene: '{hands} hold the product, already out of its packaging and in the state it is used in, and use it once.',
      blocking: 'The label stays toward the camera.',
      environment_interaction: 'The hands use it {setting}.',
      energy: 'natural',
      camera_move: 'Handheld phone camera with a slight natural sway.',
      lens_feel: 'Everyday phone-camera look, the background in focus.',
      lighting: 'Everyday daylight.',
    },
    product: {
      framing: 'Closing product shot of the product.',
      scene: 'The shot settles on a clean three-quarter view of the whole product.',
      environment_interaction: 'The product stands on a clean surface {setting}.',
      energy: 'calm',
      camera_move: 'A slow push-in, smooth cinematic motion.',
      lens_feel: 'Shallow depth of field.',
      lighting: 'Soft light glides across it.',
    },
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
