// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * presetPlan — a Preset render's plan, composed in an activity so workflow
 * replay never depends on Playbook or Preset data that a deploy may change
 * (workflows/preset-plan.ts has the why). Free and side-effect free: no
 * primitive run, no charge. A plan that cannot render (a refused edit, a stale
 * or unknown Playbook choice) fails non-retryably with its code, before
 * anything is requested.
 */

import { ApplicationFailure } from '@temporalio/activity';
import { PLAYBOOK_REGISTRY, type PlaybookRegistry } from '@agentmedia/shot-prompts';
import { presetRender, type PresetRenderDefinition } from '../presets/index.js';
import { PresetPlanRefusal, planPresetRender, type PresetPlan, type PresetPlanInput } from '../workflows/preset-plan.js';

export type { PresetPlan, PresetPlanInput } from '../workflows/preset-plan.js';

/**
 * The activity. `registry` is the Playbooks this worker renders with and
 * `resolve` finds a Preset's definition by id (both injectable for tests; a
 * definition never comes from the input).
 */
export function makePresetPlanActivity(
  registry: PlaybookRegistry = PLAYBOOK_REGISTRY,
  resolve: (id: string) => PresetRenderDefinition = presetRender,
) {
  return async function presetPlan(input: PresetPlanInput): Promise<PresetPlan> {
    try {
      return planPresetRender(input, resolve(input.preset), registry);
    } catch (err) {
      if (err instanceof PresetPlanRefusal) throw ApplicationFailure.nonRetryable(err.message, err.code);
      throw ApplicationFailure.nonRetryable((err as Error).message.slice(0, 500), 'INVALID_INPUT');
    }
  };
}
