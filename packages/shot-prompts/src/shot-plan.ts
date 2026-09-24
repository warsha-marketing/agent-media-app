// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The Shot Plan (CONTEXT.md, #26): every shot a render will make, each with its
 * Shot Prompt — the scene text (editable) and the Guardrails (locked).
 *
 * The ONE composition, used by both sides:
 *   - api-v2 composes it to show the user (POST /v1/skills/{slug}/shot-plan)
 *     and to validate the scene edits a quote or run carries (shot_edits);
 *   - the worker composes it again from the same draft, Preset and inputs to
 *     render, applies the (re-checked) edits by shot id, and builds every final
 *     prompt with its own Guardrails (shotPrompt).
 * The shots come from planPresetShots (@agentmedia/schema), the same plan the
 * quote prices, so an edit never changes the shots or the price.
 *
 * Pure: the workflow sandbox imports this.
 */

import {
  planPresetShots,
  shotFrame,
  shotVideo,
  type Modesty,
  type PresetDefinition,
  type ShotSubject,
  type ShotVideo,
  type StartingFrame,
  type VideoModelId,
} from '@agentmedia/schema';
import { guardrailIssue, type InteractionGuardrail } from './guardrail-check.js';
import { shotGuardrails, type Guardrail } from './guardrails.js';
import { withReferences, type ReferenceWords } from './references.js';
import { fillPrompt, productInteractionScene, type PresetPrompts } from './scenes.js';

/** The longest scene text a shot may carry (the longest default, with a full Product Interaction, is well under it). */
export const SCENE_TEXT_MAX_CHARS = 1000;

/** A Preset as the Shot Plan reads it: its definition and its prompt wording. */
export type ShotPlanPreset<Kind extends string = string> = PresetDefinition<Kind> & PresetPrompts<Kind>;

/** The video models by name, as the Shot Plan shows them. */
export const VIDEO_MODEL_LABELS: Readonly<Record<VideoModelId, string>> = {
  'seedance-2.0': 'Seedance 2.0',
  'kling-o3-pro': 'Kling O3 Pro',
  'veo-3.1': 'Veo 3.1',
};

/** A shot's stable id: its place in the plan and its kind (e.g. `shot-1-reaction`). */
export function shotId(index: number, kind: string): string {
  return `shot-${index + 1}-${kind}`;
}

/** Scene text as it is checked, stored and rendered: whitespace collapsed, trimmed. */
export function tidySceneText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// ── Checking an edited scene ─────────────────────────────────────────────────

export type ShotEditCode = 'SHOT_EDIT_INVALID' | 'SHOT_EDIT_BREAKS_GUARDRAIL';
export type ShotEditReason = 'unknown_shot' | 'not_text' | 'empty' | 'too_long' | 'brackets' | 'reference_syntax' | 'guardrail';

export interface SceneTextProblem {
  code: ShotEditCode;
  reason: ShotEditReason;
  message: string;
  /** SHOT_EDIT_BREAKS_GUARDRAIL: which Guardrail, and the words that broke it. */
  guardrail?: InteractionGuardrail;
  matched?: string;
}

/** Bracketed tags ([softly], {hands}, <b>): a scene is plain words. */
const BRACKETS = /[[\]{}<>]/;
/** Any provider's image reference syntax: the Guardrails name the images, never the scene. */
const REFERENCE_SYNTAX = /@\s*image|\bimage\s*[12]\b|\breference\s+images?\b|\b(?:first|second)\s+(?:reference|image)\b/i;

/** Why `text` cannot be a shot's scene, or null when it can. */
export function sceneTextProblem(text: unknown): SceneTextProblem | null {
  if (typeof text !== 'string') return { code: 'SHOT_EDIT_INVALID', reason: 'not_text', message: 'Scene text must be a string.' };
  const tidy = tidySceneText(text);
  if (!tidy) return { code: 'SHOT_EDIT_INVALID', reason: 'empty', message: 'Scene text is empty. Reset it to the Preset’s scene, or describe the shot.' };
  if (tidy.length > SCENE_TEXT_MAX_CHARS) {
    return { code: 'SHOT_EDIT_INVALID', reason: 'too_long', message: `Scene text is ${tidy.length} characters; the most is ${SCENE_TEXT_MAX_CHARS}.` };
  }
  if (BRACKETS.test(tidy)) {
    return {
      code: 'SHOT_EDIT_INVALID',
      reason: 'brackets',
      message: 'Scene text cannot carry bracketed tags ([ ], { }, < >). Describe the shot in plain words.',
    };
  }
  if (REFERENCE_SYNTAX.test(tidy)) {
    return {
      code: 'SHOT_EDIT_INVALID',
      reason: 'reference_syntax',
      message: 'Scene text cannot name reference images (@image1, "reference image", …). Say "the product" or "the person"; the render pins them to your photos itself.',
    };
  }
  const issue = guardrailIssue(tidy);
  if (issue) {
    return {
      code: 'SHOT_EDIT_BREAKS_GUARDRAIL',
      reason: 'guardrail',
      guardrail: issue.guardrail,
      matched: issue.matched,
      message: `The scene breaks a Guardrail: "${issue.matched}" — ${issue.why}.`,
    };
  }
  return null;
}

/** A scene edit that cannot render, for one shot. */
export class ShotEditError extends Error {
  readonly code: ShotEditCode;
  readonly shotId: string;
  readonly reason: ShotEditReason;
  readonly guardrail?: InteractionGuardrail;
  readonly matched?: string;
  constructor(shot: string, problem: SceneTextProblem) {
    super(`${shot}: ${problem.message}`);
    this.name = 'ShotEditError';
    this.code = problem.code;
    this.shotId = shot;
    this.reason = problem.reason;
    if (problem.guardrail) this.guardrail = problem.guardrail;
    if (problem.matched) this.matched = problem.matched;
  }
}

// ── Composing the plan ───────────────────────────────────────────────────────

export interface ShotPlanContext {
  /** The draft's measured speech; the shots are planned (and priced) from it. */
  durationMs: number;
  /** The resolved Modesty Default (#17). */
  modesty: Modesty;
  /** The Preset's own inputs as words (promptVars). */
  vars?: Readonly<Record<string, string>>;
  /** The draft's Product Interaction (#25). */
  interaction?: string | null;
  /** A person's reference image goes with the shots that show a person (Reaction's saved character). */
  personReference: boolean;
}

export interface ShotPlanShot {
  shot_id: string;
  /** 0-based place in the plan. */
  index: number;
  kind: string;
  shows: ShotSubject;
  /** The clip the model renders, in s. */
  clip_seconds: 5 | 10;
  /** How long the shot stays on screen in the cut. */
  on_screen_ms: number;
  /** The shot is animated from this generated starting frame (#18), else from the product photo. */
  starting_frame: StartingFrame | null;
  /** The model it renders on, and the one it falls back to (#25). */
  video: ShotVideo;
  /** The Preset's scene for this shot. */
  default_scene: string;
  /** The scene that renders: the user's edit, else the default. */
  scene: string;
  edited: boolean;
  /** The locked lines, in prompt order (./guardrails.ts). */
  guardrails: Guardrail[];
}

/**
 * The Shot Plan for `ctx.durationMs` of speech under `preset`, with `edits`
 * (shot id → scene text) applied. An edit equal to the default is no edit.
 * Throws ShotEditError on an edit for a shot the plan does not have or scene
 * text that cannot render; RangeError outside the Preset's speech band; Error
 * on a template placeholder the Preset's inputs do not fill.
 */
export function composeShotPlan(
  preset: ShotPlanPreset,
  ctx: ShotPlanContext,
  edits?: Readonly<Record<string, unknown>> | null,
): ShotPlanShot[] {
  const planned = planPresetShots(preset, ctx.durationMs);
  const ids = planned.map((s, i) => shotId(i, s.kind));
  for (const id of Object.keys(edits ?? {})) {
    if (!ids.includes(id)) {
      throw new ShotEditError(id, {
        code: 'SHOT_EDIT_INVALID',
        reason: 'unknown_shot',
        message: `This render has no shot "${id}"; its shots are ${ids.join(', ')}. Ask for the Shot Plan again.`,
      });
    }
  }
  let elapsed = 0;
  return planned.map((s, index) => {
    const kind = s.kind;
    const shows = preset.shotKinds[kind].shows;
    const frame = shotFrame(preset, kind) ?? null;
    const onScreen = s.onScreenMs ?? Math.min(s.seconds * 1000, Math.max(0, ctx.durationMs - elapsed));
    elapsed += onScreen;
    const defaultScene = [fillPrompt(preset.scenes[kind], ctx.vars ?? {}), productInteractionScene(shows, ctx.interaction)]
      .filter(Boolean)
      .join(' ');
    const id = ids[index];
    const raw = edits && Object.hasOwn(edits, id) ? edits[id] : undefined;
    let scene = defaultScene;
    if (raw !== undefined) {
      const problem = sceneTextProblem(raw);
      if (problem) throw new ShotEditError(id, problem);
      scene = tidySceneText(raw as string);
    }
    return {
      shot_id: id,
      index,
      kind,
      shows,
      clip_seconds: s.seconds,
      on_screen_ms: onScreen,
      starting_frame: frame,
      video: shotVideo(preset, kind),
      default_scene: defaultScene,
      scene,
      edited: scene !== defaultScene,
      guardrails: shotGuardrails({
        shows,
        startingFrame: frame !== null,
        personReference: shows === 'person' && ctx.personReference,
        modesty: ctx.modesty,
      }),
    };
  });
}

/**
 * A shot's final prompt: the reference Guardrails, the scene, then the rule
 * Guardrails — with the reference images named in `words` (a provider's
 * syntax, or plain words for the Shot Plan view). The `request` Guardrails
 * (audio off) are not prompt text.
 */
export function shotPrompt(shot: Pick<ShotPlanShot, 'scene' | 'guardrails'>, words: ReferenceWords): string {
  const lines = (at: Guardrail['at']) => shot.guardrails.filter((g) => g.at === at).map((g) => g.text);
  return withReferences([...lines('before_scene'), shot.scene, ...lines('after_scene')].join(' '), words);
}

/** Only the edits that change a shot's scene, tidied (what a run stores and hands the worker). */
export function effectiveEdits(plan: readonly ShotPlanShot[]): Record<string, string> {
  return Object.fromEntries(plan.filter((s) => s.edited).map((s) => [s.shot_id, s.scene]));
}
