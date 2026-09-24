// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Preset render definitions — the server-side half of a Preset (#16).
 *
 * A Preset is data on the shared render pipeline (workflows/render-preset.ts,
 * renderPreset). Each Preset's registered workflow resolves its definition here
 * by id (presetRender): definitions never travel in a workflow's input. Its
 * public half — shot plan, speech band, required inputs, cost budget — is a
 * PresetDefinition in @agentmedia/schema, so api-v2 quotes from exactly what the
 * worker renders. Its prompt wording — a scene per shot kind, and the
 * Guardrails every shot keeps (#26) — is in @agentmedia/shot-prompts, a
 * private workspace package api-v2 also reads to show the Shot Plan: the
 * quality authority stays server-side (@agentmedia/schema is published).
 *
 * Pure data: the workflow sandbox imports this.
 */

import {
  composeFramePrompt,
  HANDS_ON_PROMPTS,
  PRODUCT_HERO_PROMPTS,
  REACTION_PROMPTS,
  type PresetPrompts,
} from '@agentmedia/shot-prompts';
import { HANDS_ON, PRODUCT_HERO, REACTION, type Modesty, type PresetDefinition, type ProductHeroShotKind } from '@agentmedia/schema';
import type { HandsOnShotKind, ReactionShotKind } from '@agentmedia/schema';

export { fillPrompt, productInteractionPrompt } from '@agentmedia/shot-prompts';

/**
 * A Preset as the render pipeline reads it: its definition plus its prompt
 * wording (scenes per shot kind, frame prompts, the words for its own inputs).
 * Every clip prompt is a Shot Prompt: the shot's scene plus its Guardrails
 * (composeShotPlan / shotPrompt in @agentmedia/shot-prompts).
 */
export type PresetRenderDefinition<Kind extends string = string> = PresetDefinition<Kind> & PresetPrompts<Kind>;

/** Product Hero: a hero shot, then a closer on a different move. Nobody on screen. */
export const PRODUCT_HERO_RENDER: PresetRenderDefinition<ProductHeroShotKind> = { ...PRODUCT_HERO, ...PRODUCT_HERO_PROMPTS };

/** Reaction (#19): the saved character reacting silently, intercut with the product. */
export const REACTION_RENDER: PresetRenderDefinition<ReactionShotKind> = { ...REACTION, ...REACTION_PROMPTS };

/** Hands-on (#18): first-person hands from a product-in-hands frame, closing on the product. */
export const HANDS_ON_RENDER: PresetRenderDefinition<HandsOnShotKind> = { ...HANDS_ON, ...HANDS_ON_PROMPTS };

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
  return composeFramePrompt(template, preset.shotKinds[kind].shows, modesty, vars, interaction);
}

/** Every Preset the worker can render, by id. Server-side only. */
export const PRESET_RENDERS: Readonly<Record<string, PresetRenderDefinition>> = {
  [PRODUCT_HERO_RENDER.id]: PRODUCT_HERO_RENDER as PresetRenderDefinition,
  [REACTION_RENDER.id]: REACTION_RENDER as PresetRenderDefinition,
  [HANDS_ON_RENDER.id]: HANDS_ON_RENDER as PresetRenderDefinition,
};

/** The render definition of Preset `id`; throws on an id the worker does not know. */
export function presetRender(id: string): PresetRenderDefinition {
  if (!Object.hasOwn(PRESET_RENDERS, id)) throw new Error(`unknown Preset: ${id}`);
  return PRESET_RENDERS[id];
}
