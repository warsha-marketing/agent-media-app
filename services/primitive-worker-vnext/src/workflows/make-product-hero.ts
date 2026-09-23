// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * make_product_hero — the Product Hero render phase: the Product Hero Preset on
 * the shared render pipeline (./render-preset.ts, #16).
 *
 * This is the registered workflow type. Its input names no Preset and carries
 * no prompts; the definition is resolved here from the server-side registry by
 * id (presetRender), so the shot prompts — the quality authority — never come
 * from whoever started the workflow.
 */

import { presetRender } from '../presets/index.js';
import { renderPreset, type PresetRenderInput, type PresetRenderResult } from './render-preset.js';

export type MakeProductHeroWorkflowInput = PresetRenderInput;
export type MakeProductHeroWorkflowResult = PresetRenderResult;

/** make_product_hero: the Product Hero definition on the shared pipeline. */
export async function makeProductHeroWorkflow(
  input: MakeProductHeroWorkflowInput,
): Promise<MakeProductHeroWorkflowResult> {
  return renderPreset(input, presetRender('product_hero'));
}
