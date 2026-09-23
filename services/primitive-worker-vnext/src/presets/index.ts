// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Preset render definitions — the server-side half of a Preset (#16).
 *
 * A Preset is data on the shared render pipeline (workflows/make-product-hero.ts,
 * renderPresetWorkflow). Its public half — shot plan, speech band, required
 * inputs, cost budget — is a PresetDefinition in @agentmedia/schema, so api-v2
 * quotes from exactly what the worker renders. The shot prompts per kind are the
 * quality authority and stay here, server-side: that package is published.
 *
 * Pure data: the workflow sandbox imports this.
 */

import { PRODUCT_HERO, type PresetDefinition, type ProductHeroShotKind } from '@agentmedia/schema';

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
