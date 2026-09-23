// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * make_hands_on — the Hands-on render phase (#18): the Hands-on Preset on the
 * shared render pipeline (./render-preset.ts).
 *
 * The registered workflow type. Like make_product_hero, its input names no
 * Preset and carries no prompts: the definition (shot and frame prompts, the
 * words for each setting and hand gender) is resolved here, server-side, by id.
 * Its input adds only the user's choices api-v2 resolved: hand_gender, setting
 * and the Modesty Default.
 */

import { presetRender } from '../presets/index.js';
import { renderPreset, type PresetRenderInput, type PresetRenderResult } from './render-preset.js';

export type MakeHandsOnWorkflowInput = PresetRenderInput;
export type MakeHandsOnWorkflowResult = PresetRenderResult;

/** make_hands_on: the Hands-on definition on the shared pipeline. */
export async function makeHandsOnWorkflow(input: MakeHandsOnWorkflowInput): Promise<MakeHandsOnWorkflowResult> {
  return renderPreset(input, presetRender('hands_on'));
}
