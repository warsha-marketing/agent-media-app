// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * TEST-ONLY: drive the shared Preset render pipeline (renderPreset) with a
 * definition supplied by the test, e.g. a second Preset that exists nowhere
 * else. The production worker never registers anything like this: its Preset
 * workflows resolve their definition server-side by id.
 */

import { renderPreset, type PresetRenderInput, type PresetRenderResult } from '../../workflows/render-preset.js';
import type { PresetRenderDefinition } from '../../presets/index.js';

export interface TestPresetRenderInput extends PresetRenderInput {
  preset: PresetRenderDefinition;
}

export async function renderTestPresetWorkflow(input: TestPresetRenderInput): Promise<PresetRenderResult> {
  const { preset, ...rest } = input;
  return renderPreset(rest, preset);
}
