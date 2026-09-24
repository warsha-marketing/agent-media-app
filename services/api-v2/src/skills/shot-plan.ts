// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Shot Plan review (#26) — the Preset render's shots, composed at the API so
 * the user can see (and edit the scene text of) each Shot Prompt before the
 * render.
 *
 *   POST /v1/skills/{slug}/shot-plan  — the plan for a draft + Preset + inputs
 *       (the quote's body; owner-only, and operators may preview an unqualified
 *       Preset–Dialect pair, like drafting): every shot with its stable id,
 *       kind, on-screen length, model and fallback, its scene text and its
 *       locked Guardrail lines.
 *   `shot_edits` on the quote and the run — { shot_id: scene text }: checked
 *       here against the same plan (ids, length cap, no bracketed tags or
 *       reference syntax, the guardrail check) → 422 SHOT_EDIT_INVALID /
 *       SHOT_EDIT_BREAKS_GUARDRAIL. Edits never change the shots, so never the
 *       price; they are in the Idempotency-Key fingerprint (the validated body).
 *       The run hands the worker only the edits that change a scene; the worker
 *       re-checks them and always adds its own Guardrails.
 *
 * The composition is @agentmedia/shot-prompts' (server-only, shared with the
 * worker), from the same draft duration, Modesty Default, Preset inputs and
 * Product Interaction the render gets.
 */

import { z } from 'zod';
import { presetShows, type Modesty, type PresetDefinition } from '@agentmedia/schema';
import {
  SCENE_TEXT_MAX_CHARS,
  ShotEditError,
  VIDEO_MODEL_LABELS,
  composeShotPlan,
  displayReferences,
  effectiveEdits,
  presetPrompts,
  shotPrompt,
  withReferences,
  type ShotPlanPreset,
  type ShotPlanShot,
} from '@agentmedia/shot-prompts';
import { RenderRefusal, type RenderableDraft } from './product-hero-render.js';
import type { PresetInputs } from './preset-inputs.js';

/** The `shot_edits` skill input field: loose here (a DoS bound only); the real checks answer 422 with a code. */
export const shotEditsField = z
  .record(z.string().max(100), z.string().max(SCENE_TEXT_MAX_CHARS * 4))
  .refine((edits) => Object.keys(edits).length <= 16, { message: 'at most 16 shot edits' })
  .optional()
  .describe(
    `Optional, from Shot Plan review: your own scene text for some shots, by shot_id from POST /v1/skills/{slug}/shot-plan, e.g. { "shot-1-reaction": "The person sniffs the inner wrist and nods." }. Only the scene: the Guardrails (references, nobody speaks, modest styling, no text, audio off) are always added by the server. At most ${SCENE_TEXT_MAX_CHARS} characters each, plain words (say "the product", "the person"; no [tags] or @image references). Never changes the price.`,
  );

/** The Modesty Default the render will apply: the resolver's, else the Preset's default arms (a Preset with no one on screen). */
function renderModesty(preset: PresetDefinition, own: PresetInputs): Modesty {
  const m = own.run.modesty as Modesty | undefined;
  return m ?? { arms: preset.modesty.arms.default, hijab: false };
}

/**
 * The Shot Plan of rendering `draft` as `preset` with the Preset inputs the
 * route resolved (`own`), and `edits` applied. A refused edit is a 422
 * RenderRefusal carrying its shot_id and reason (and the Guardrail it broke).
 */
export function composeRenderShotPlan(
  preset: PresetDefinition,
  draft: Pick<RenderableDraft, 'duration_ms' | 'product_interaction'>,
  own: PresetInputs,
  edits: unknown,
): ShotPlanShot[] {
  const prompts = presetPrompts(preset.id);
  const plannable = { ...preset, ...prompts } as ShotPlanPreset;
  try {
    return composeShotPlan(
      plannable,
      {
        durationMs: Number(draft.duration_ms),
        modesty: renderModesty(preset, own),
        vars: prompts.promptVars ? prompts.promptVars(own.run) : {},
        interaction: draft.product_interaction ?? null,
        // The person's reference goes with every person shot of a Preset that takes a character (Reaction).
        personReference: presetShows(preset, 'person') && preset.requiredInputs.includes('character'),
      },
      (edits ?? null) as Record<string, unknown> | null,
    );
  } catch (err) {
    if (err instanceof ShotEditError) {
      throw new RenderRefusal(422, err.code, err.message, {
        shot_id: err.shotId,
        reason: err.reason,
        ...(err.guardrail ? { guardrail: err.guardrail, matched: err.matched } : {}),
      });
    }
    throw err;
  }
}

/** The edits a run stores and hands the worker: only those that change a scene. */
export const runShotEdits = (plan: readonly ShotPlanShot[]): Record<string, string> => effectiveEdits(plan);

/** One shot as the API shows it: plain words for the reference images, never a provider's syntax. */
export function shotView(shot: ShotPlanShot) {
  const words = displayReferences(shot.starting_frame !== null);
  return {
    shot_id: shot.shot_id,
    number: shot.index + 1,
    kind: shot.kind,
    shows: shot.shows,
    clip_seconds: shot.clip_seconds,
    on_screen_ms: shot.on_screen_ms,
    starting_frame: shot.starting_frame,
    model: { id: shot.video.model, name: VIDEO_MODEL_LABELS[shot.video.model] },
    fallback: shot.video.fallback ? { id: shot.video.fallback, name: VIDEO_MODEL_LABELS[shot.video.fallback] } : null,
    scene_text: shot.scene,
    default_scene_text: shot.default_scene,
    edited: shot.edited,
    guardrails: shot.guardrails.map((g) => ({
      id: g.id,
      label: g.label,
      text: withReferences(g.text, words),
      enforced_by: g.at === 'request' ? 'request' : 'prompt',
    })),
    prompt_preview: shotPrompt(shot, words),
  };
}

/** The shot-plan response body. */
export function shotPlanView(slug: string, preset: PresetDefinition, draft: Pick<RenderableDraft, 'id' | 'duration_ms'>, plan: readonly ShotPlanShot[]) {
  return {
    skill: slug,
    preset: preset.id,
    draft_id: draft.id,
    duration_ms: Number(draft.duration_ms),
    scene_text_max_chars: SCENE_TEXT_MAX_CHARS,
    shots: plan.map(shotView),
  };
}
