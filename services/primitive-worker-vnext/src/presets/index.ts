// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Preset render definitions — the server-side half of a Preset (#16).
 *
 * A Preset is data on the shared render pipeline (workflows/render-preset.ts,
 * renderPreset). Each Preset's registered workflow resolves its definition here
 * by id (presetRender): definitions never travel in a workflow's input. Its public half — shot plan, speech band, required
 * inputs, cost budget — is a PresetDefinition in @agentmedia/schema, so api-v2
 * quotes from exactly what the worker renders. The shot prompts per kind are the
 * quality authority and stay here, server-side: that package is published.
 *
 * Pure data: the workflow sandbox imports this.
 */

import {
  PRODUCT_HERO,
  tidyProductInteraction,
  type Modesty,
  type PresetDefinition,
  type ProductHeroShotKind,
  type ShotSubject,
} from '@agentmedia/schema';
import { modestyPrompt } from './modesty.js';
import { REACTION_RENDER } from './reaction.js';
import type { PresetRenderInput } from '../workflows/render-preset.js';
import { HANDS_ON_RENDER } from './hands-on.js';

/** A Preset as the render pipeline reads it: its definition plus a prompt per shot kind. */
export interface PresetRenderDefinition<Kind extends string = string> extends PresetDefinition<Kind> {
  /**
   * The video prompt for each kind of shot. `@image1` is the product photo.
   * Every prompt keeps the visuals silent (nothing that implies speech) — the
   * draft audio is the only voice (ADR 0001).
   */
  shotPrompts: Readonly<Record<Kind, string>>;
  /**
   * The image prompt for each kind that declares a starting frame
   * (shotKinds[kind].frame, #18). The product photo is the reference image.
   */
  framePrompts?: Readonly<Partial<Record<Kind, string>>>;
  /**
   * The Preset's own inputs as words for its prompts' `{name}` placeholders
   * (e.g. Hands-on's `{hands}` and `{setting}`). Throws on an input it cannot
   * word; the render refuses to start then. Absent: prompts have no placeholders.
   */
  promptVars?: (input: PresetRenderInput) => Readonly<Record<string, string>>;
}

/** `template` with every `{name}` filled from `vars`; throws on a placeholder `vars` does not fill. */
export function fillPrompt(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-z_]+)\}/g, (_m, name: string) => {
    if (!Object.hasOwn(vars, name)) throw new Error(`prompt placeholder {${name}} has no value`);
    return vars[name];
  });
}

/**
 * Product Hero: a hero shot, then a closer on a different move so the hard cut
 * reads as an edit. Nobody on screen.
 */
export const PRODUCT_HERO_RENDER: PresetRenderDefinition<ProductHeroShotKind> = {
  ...PRODUCT_HERO,
  shotPrompts: {
    hero: 'Premium product commercial, hero shot of the exact product in @image1: the product stands centered on a clean, softly lit surface, the camera slowly pushes in and orbits a few degrees, gentle rim light glides across its surfaces. The product keeps its exact shape, colours, logo and label text. No people, no hands, no text overlays, no captions. Vertical 9:16, shallow depth of field, smooth cinematic motion.',
    detail: 'Premium product commercial, closing detail shot of the exact product in @image1: a slow macro slide along the product revealing texture, materials and finish, then settling on a clean three-quarter view of the whole product. The product keeps its exact shape, colours, logo and label text. No people, no hands, no text overlays, no captions. Vertical 9:16, soft studio light, smooth cinematic motion.',
  },
};

/**
 * The Product Interaction's words for one shot showing `subject` (#25): how a
 * real person uses the product, for hands and person shots only (empty for a
 * product shot, or when the draft has none). It comes after the shot prompt's
 * no-speaking wording and the Modesty Default, and says it keeps both: it adds
 * the action, never a less modest look or speech.
 */
export function productInteractionPrompt(subject: ShotSubject, interaction: string | null | undefined): string {
  if (subject !== 'hands' && subject !== 'person') return '';
  // Tidied exactly as api-v2 stored it (@agentmedia/schema), then its closing stop dropped.
  const text = (tidyProductInteraction(interaction) ?? '').replace(/[.\s]+$/, '');
  if (!text) return '';
  return (
    `How the product is used, as a real person uses it: ${text}. ` +
    'This only adds the action: every instruction above still holds — nobody speaks or mouths words, and the clothing stays exactly as modest as described.'
  );
}

/** `base` + the Modesty Default + the Product Interaction, for a shot showing `subject`. */
function withPersonWords(base: string, subject: ShotSubject, modesty: Modesty, interaction: string | null | undefined): string {
  return [base, modestyPrompt(subject, modesty), productInteractionPrompt(subject, interaction)].filter(Boolean).join(' ');
}

/**
 * The full prompt for one shot of `kind`: the Preset's shot prompt, plus the
 * Modesty Default (#17) and then the draft's Product Interaction (#25) when
 * that kind shows a person or hands. Product shots get the shot prompt
 * unchanged. The pipeline builds every clip prompt here.
 */
export function presetShotPrompt<Kind extends string>(
  preset: PresetRenderDefinition<Kind>,
  kind: Kind,
  modesty: Modesty,
  vars: Readonly<Record<string, string>> = {},
  interaction: string | null = null,
): string {
  return withPersonWords(fillPrompt(preset.shotPrompts[kind], vars), preset.shotKinds[kind].shows, modesty, interaction);
}

/**
 * The full image prompt for the starting frame of a shot of `kind` (#18): the
 * Preset's frame prompt, plus the Modesty Default and then the Product
 * Interaction (#25) when that kind shows a person or hands — the frame is what
 * the clip animates, so it must be modest too, and already mid-use.
 */
export function presetFramePrompt<Kind extends string>(
  preset: PresetRenderDefinition<Kind>,
  kind: Kind,
  modesty: Modesty,
  vars: Readonly<Record<string, string>> = {},
  interaction: string | null = null,
): string {
  const template = preset.framePrompts?.[kind];
  if (!template) throw new Error(`${preset.name} has no frame prompt for ${kind} shots`);
  return withPersonWords(fillPrompt(template, vars), preset.shotKinds[kind].shows, modesty, interaction);
}

/** Every Preset the worker can render, by id. Server-side only. */
export const PRESET_RENDERS: Readonly<Record<string, PresetRenderDefinition>> = {
  [PRODUCT_HERO_RENDER.id]: PRODUCT_HERO_RENDER,
  [REACTION_RENDER.id]: REACTION_RENDER,
  [HANDS_ON_RENDER.id]: HANDS_ON_RENDER,
};

/** The render definition of Preset `id`; throws on an id the worker does not know. */
export function presetRender(id: string): PresetRenderDefinition {
  if (!Object.hasOwn(PRESET_RENDERS, id)) throw new Error(`unknown Preset: ${id}`);
  return PRESET_RENDERS[id];
}
