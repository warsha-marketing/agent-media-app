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

import { PRODUCT_HERO, type Modesty, type PresetDefinition, type ProductHeroShotKind } from '@agentmedia/schema';
import { modestyPrompt } from './modesty.js';

/** A Preset as the render pipeline reads it: its definition plus a prompt per shot kind. */
export interface PresetRenderDefinition<Kind extends string = string> extends PresetDefinition<Kind> {
  /**
   * The video prompt for each kind of shot. `@image1` is the product photo.
   * Every prompt keeps the visuals silent (nothing that implies speech) — the
   * draft audio is the only voice (ADR 0001).
   */
  shotPrompts: Readonly<Record<Kind, string>>;
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
 * The full prompt for one shot of `kind`: the Preset's shot prompt, plus the
 * Modesty Default (#17) when that kind shows a person or hands. Product shots
 * get the shot prompt unchanged. The pipeline builds every clip prompt here.
 */
export function presetShotPrompt<Kind extends string>(
  preset: PresetRenderDefinition<Kind>,
  kind: Kind,
  modesty: Modesty,
): string {
  const base = preset.shotPrompts[kind];
  const extra = modestyPrompt(preset.shotKinds[kind].shows, modesty);
  return extra ? `${base} ${extra}` : base;
}

/** Every Preset the worker can render, by id. Server-side only. */
export const PRESET_RENDERS: Readonly<Record<string, PresetRenderDefinition>> = {
  [PRODUCT_HERO_RENDER.id]: PRODUCT_HERO_RENDER,
};

/** The render definition of Preset `id`; throws on an id the worker does not know. */
export function presetRender(id: string): PresetRenderDefinition {
  if (!Object.hasOwn(PRESET_RENDERS, id)) throw new Error(`unknown Preset: ${id}`);
  return PRESET_RENDERS[id];
}
