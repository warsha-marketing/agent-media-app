// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * A Preset render's plan (#26, #28, #32): the shots, their fields (the user's
 * edits, checked again) and every prompt the render will send, with this
 * worker's own Guardrails — composed from the run input, the Preset's
 * definition and the Playbook the quote priced.
 *
 * DETERMINISM (#32): the Playbook data and the Preset wording change with a
 * deploy (a Playbook's version is bumped on every change, and a stale choice
 * is refused). Workflow code must not depend on them, or a render started
 * before a deploy could replay differently after it (another shot count, or a
 * PlaybookError where the first run had none). So the plan is composed in an
 * ACTIVITY (activities/preset-plan.ts, `presetPlan`): its result is recorded
 * in the history, and a replay reads it back instead of composing it again.
 * renderPreset takes this path behind `patched(PRESET_PLAN_IN_ACTIVITY)`; a
 * history from before the patch still composes inline (it never carried a
 * Playbook choice, so no version can go stale under it).
 *
 * Pure (no activity or workflow APIs): the activity and the legacy inline path
 * share it.
 */

import { shotModelChain, type Modesty, type VideoModelId } from '@agentmedia/schema';
import {
  IMAGE_REFERENCES,
  PLAYBOOK_REGISTRY,
  PlaybookError,
  REFERENCE_TOKENS,
  ShotEditError,
  composeShotPlan,
  resolvePlaybookChoice,
  shotPrompt,
  type PersonWords,
  type PlaybookChoice,
  type PlaybookRegistry,
  type ShotEdit,
  type ShotPlanShot,
  type ShotProductContext,
} from '@agentmedia/shot-prompts';
import type { PresetRenderDefinition } from '../presets/index.js';

/** The patch id of composing the plan in the presetPlan activity (see the header). */
export const PRESET_PLAN_IN_ACTIVITY = 'preset-plan-in-activity';

/** What the plan is composed from: the run input as the render resolved it. */
export interface PresetPlanInput {
  /** The Preset, by id: its definition is resolved server-side (never from the input). */
  preset: string;
  duration_ms: number;
  /** The resolved Modesty Default (renderPreset's modestyFor). */
  modesty: Modesty;
  /** The Preset's own inputs in words (promptVars). */
  vars: Readonly<Record<string, string>>;
  interaction: string | null;
  person: PersonWords;
  product: ShotProductContext;
  /** The Playbook the quote priced ({ id, version, pattern }), or null (runs from before #32). */
  playbook: PlaybookChoice | null;
  shot_edits: Readonly<Record<string, ShotEdit>> | null;
}

/** The plan a render follows: every shot, and every prompt it sends. */
export interface PresetPlan {
  shots: ShotPlanShot[];
  /** The Playbook the shots follow, as recorded on the Short. */
  playbook: PlaybookChoice | null;
  /** Each shot's starting-frame prompt (image stage), or null without a frame. */
  frame_prompts: Array<string | null>;
  /**
   * Each shot's attempts, in the order tried: every model of its chain with
   * its own clip prompt (the face, or the person in words).
   */
  clip_attempts: ClipAttempt[][];
}

/** One model a shot may render on, and the clip prompt it is sent. */
export interface ClipAttempt {
  model: VideoModelId;
  prompt: string;
}

/** A plan that cannot render: its code (the failure's type) and why. Nothing was requested. */
export class PresetPlanRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message.slice(0, 500));
    this.name = 'PresetPlanRefusal';
  }
}

/**
 * The plan of rendering `input` as `preset`, with the Playbook resolved from
 * `registry`. Throws PresetPlanRefusal: a refused edit (its SHOT_EDIT_* code),
 * a Playbook choice that is unknown or stale, or any input the Preset cannot
 * plan (INVALID_INPUT).
 */
export function planPresetRender(
  input: PresetPlanInput,
  preset: PresetRenderDefinition,
  registry: PlaybookRegistry = PLAYBOOK_REGISTRY,
): PresetPlan {
  try {
    const playbook = resolvePlaybookChoice(input.playbook, registry);
    const plan = composeShotPlan(
      preset,
      {
        durationMs: input.duration_ms,
        modesty: input.modesty,
        vars: input.vars,
        interaction: input.interaction,
        person: input.person,
        product: input.product,
        playbook,
      },
      input.shot_edits,
    );
    return {
      shots: plan.shots,
      playbook: plan.playbook,
      // A starting frame is an image edit of the product reference: its one reference image.
      frame_prompts: plan.shots.map((s) => (s.starting_frame ? shotPrompt(s, 'image', IMAGE_REFERENCES) : null)),
      // Each model of the chain gets its own prompt; the provider adapter (presetClip) swaps the tokens for its syntax.
      clip_attempts: plan.shots.map((s) => shotModelChain(s.video).map((model) => ({ model, prompt: shotPrompt(s, 'video', REFERENCE_TOKENS, model) }))),
    };
  } catch (err) {
    if (err instanceof ShotEditError) throw new PresetPlanRefusal(err.code, err.message);
    if (err instanceof PlaybookError) throw new PresetPlanRefusal('INVALID_INPUT', err.message);
    throw new PresetPlanRefusal('INVALID_INPUT', (err as Error).message);
  }
}
