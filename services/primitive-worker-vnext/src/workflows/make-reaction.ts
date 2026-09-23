// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * make_reaction — the Reaction render phase (#19): the Reaction Preset on the
 * shared render pipeline (./render-preset.ts).
 *
 * The registered workflow type. Like make_product_hero, its input names no
 * Preset and carries no prompts: the definition is resolved here from the
 * server-side registry by id, so the shot prompts (closed mouth, no speaking, a
 * reaction only) never come from whoever started the workflow. api-v2 hands it
 * the saved character's re-hosted reference (character_image_url) and the
 * resolved Modesty Default.
 */

import { presetRender } from '../presets/index.js';
import { renderPreset, type PresetRenderInput, type PresetRenderResult } from './render-preset.js';

export type MakeReactionWorkflowInput = PresetRenderInput;
export type MakeReactionWorkflowResult = PresetRenderResult;

/** make_reaction: the Reaction definition on the shared pipeline. */
export async function makeReactionWorkflow(input: MakeReactionWorkflowInput): Promise<MakeReactionWorkflowResult> {
  return renderPreset(input, presetRender('reaction'));
}
