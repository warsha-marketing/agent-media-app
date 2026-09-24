// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The Shot Plan (CONTEXT.md, #26, #28): every shot a render will make, each
 * with a stable id, its structured fields (editable, ./shot-fields.ts) and its
 * Guardrails per stage (locked, ./guardrails.ts), under the Short's one Set.
 *
 * The ONE composition, used by both sides:
 *   - api-v2 composes it to show the user (POST /v1/skills/{slug}/shot-plan)
 *     and to validate the edits a quote or run carries (shot_edits);
 *   - the worker composes it again from the same draft, Preset and inputs to
 *     render, with the (re-checked) edits applied by shot id, and builds every
 *     final prompt with its own Guardrails (shotPrompt), per stage.
 * The shots come from planPresetShots (@agentmedia/schema), the same plan the
 * quote prices, so an edit never changes the shots, their lengths or models,
 * or the price.
 *
 * Shot ids: the shot's ROLE, from the Preset data (PresetShotSlot: 'reaction',
 * 'product-closer', …), with an occurrence suffix only when the role repeats
 * because the order cycles to fill a longer speech (`reaction`, then
 * `reaction-2`). Derived, not stored: the worker recomposes the plan from the
 * run input and must arrive at the same ids without a stored plan. Never the
 * position, and never the kind's ordinal: a Preset or Playbook inserting
 * another shot of the same kind, or swapping two of them, leaves each role's
 * id, and an edit keyed by it, on the same shot.
 *
 * Pure: the workflow sandbox imports this.
 */

import {
  modelTakesPersonImage,
  planPresetShots,
  shotFrame,
  shotModelChain,
  shotVideo,
  type Modesty,
  type PersonImageSource,
  type PresetDefinition,
  type ShotSubject,
  type ShotVideo,
  type StartingFrame,
  type VideoModelId,
} from '@agentmedia/schema';
import type { InteractionGuardrail } from './guardrail-check.js';
import { shotGuardrails, stageGuardrails, type Guardrail, type ShotStage, type StageGuardrails } from './guardrails.js';
import { personDescriptionLine, type PersonWords } from './person.js';
import { inUseReferenceLine, scaleAnchorLine, type ShotProductContext } from './product-reference.js';
import { withReferences, type ReferenceWords } from './references.js';
import { fillPrompt, productInteractionAction, type PresetPrompts } from './scenes.js';
import {
  PEOPLE_FIELDS,
  SHOT_FIELDS,
  asSentence,
  composeFields,
  isShotField,
  shotFieldProblem,
  tidyFieldText,
  type ShotEditCode,
  type ShotEditReason,
  type ShotField,
  type ShotFieldProblem,
  type ShotFields,
} from './shot-fields.js';

/** A Preset as the Shot Plan reads it: its definition and its prompt wording. */
export type ShotPlanPreset<Kind extends string = string> = PresetDefinition<Kind> & PresetPrompts<Kind>;

/** The video models by name, as the Shot Plan shows them. */
export const VIDEO_MODEL_LABELS: Readonly<Record<VideoModelId, string>> = {
  'seedance-2.0': 'Seedance 2.0',
  'kling-o3-pro': 'Kling O3 Pro',
  'veo-3.1': 'Veo 3.1',
  'modelark-seedance-2.0-mini': 'Seedance 2.0 Mini (ModelArk)',
};

/**
 * Each shot's id, for shots of these roles in this order: the role, then
 * `<role>-<n>` for its n-th occurrence when it repeats (see the header).
 */
export function shotIds(roles: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return roles.map((role) => {
    const n = (seen.get(role) ?? 0) + 1;
    seen.set(role, n);
    return n === 1 ? role : `${role}-${n}`;
  });
}

/**
 * Whether the person's reference image goes with a shot of `kind` rendering on
 * `model`: a shot that shows a person, of a Preset that takes a character
 * (Reaction), on a model that takes that image as a face (ADR 0003: ModelArk
 * only takes its own account's output, `source` 'modelark_output'; a saved
 * character's re-hosted portrait is 'rehosted', the default). The one answer
 * api-v2 (the person_reference Guardrail it shows) and the worker (the image
 * it sends, and the Guardrail it adds) both use. Without `model`: whether the
 * shot has a person reference at all, on any model.
 */
export function shotHasPersonReference(
  preset: Pick<PresetDefinition, 'shotKinds' | 'requiredInputs'>,
  kind: string,
  model?: VideoModelId,
  source: PersonImageSource = 'rehosted',
): boolean {
  if (preset.shotKinds[kind]?.shows !== 'person' || !preset.requiredInputs.includes('character')) return false;
  return model === undefined || modelTakesPersonImage(model, source);
}

// ── Edits ────────────────────────────────────────────────────────────────────

/** What a shot's edit may change: any field, never its duration or model. */
export type ShotEdit = Partial<ShotFields>;

/** A field edit that cannot render, for one shot. */
export class ShotEditError extends Error {
  readonly code: ShotEditCode;
  readonly shotId: string;
  readonly reason: ShotEditReason;
  readonly field?: ShotField;
  readonly guardrail?: InteractionGuardrail;
  readonly matched?: string;
  constructor(shot: string, problem: ShotFieldProblem, field?: ShotField) {
    super(`${shot}: ${problem.message}`);
    this.name = 'ShotEditError';
    this.code = problem.code;
    this.shotId = shot;
    this.reason = problem.reason;
    if (field) this.field = field;
    if (problem.guardrail) this.guardrail = problem.guardrail;
    if (problem.matched) this.matched = problem.matched;
  }
}

const invalid = (reason: ShotEditReason, message: string): ShotFieldProblem => ({ code: 'SHOT_EDIT_INVALID', reason, message });
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One shot's edit, checked against the shot it names: its fields, tidied. Throws ShotEditError. */
function checkedEdit(id: string, shows: ShotSubject, raw: unknown): ShotEdit {
  if (!isPlainObject(raw)) {
    throw new ShotEditError(id, invalid('not_object', 'A shot edit is an object of fields, e.g. { "scene": "The person smiles." }.'));
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isShotField(key)) {
      throw new ShotEditError(id, invalid('unknown_field', `A shot has no editable field "${key}"; the fields are ${SHOT_FIELDS.join(', ')}. Its length and model never change.`));
    }
    if (PEOPLE_FIELDS.includes(key) && shows === 'product' && !(typeof value === 'string' && tidyFieldText(value) === '')) {
      throw new ShotEditError(id, invalid('field_not_on_shot', `A product shot shows nobody: it has no ${key}.`), key);
    }
    const problem = shotFieldProblem(key, value);
    if (problem) throw new ShotEditError(id, problem, key);
    out[key] = key === 'energy' ? value : tidyFieldText(value as string);
  }
  return out as ShotEdit;
}

// ── Composing the plan ───────────────────────────────────────────────────────

/** The Short's Set (#27, the Set Library of #33), by id. Shots reference it; they never carry its location text. */
export interface ShotSetRef {
  set_id: string;
}

export interface ShotPlanContext {
  /** The draft's measured speech; the shots are planned (and priced) from it. */
  durationMs: number;
  /** The resolved Modesty Default (#17). */
  modesty: Modesty;
  /** The Preset's own inputs as words (promptVars). */
  vars?: Readonly<Record<string, string>>;
  /** The draft's Product Interaction (#25). */
  interaction?: string | null;
  /** The Short's Set, once there is one (#33). Absent: the Preset's own setting words. */
  set?: ShotSetRef | null;
  /**
   * The person on screen in words (ADR 0003): the saved character's gender and
   * description, said on a person shot whose model does not take the face.
   */
  person?: PersonWords | null;
  /** Where the person's reference image came from; absent = 'rehosted' (every saved character today). */
  personImage?: PersonImageSource;
  /**
   * #31: the Product Profile and whether the render made an In-use Reference —
   * the Scale Anchor and In-use Reference lines of every hands and person shot.
   * Absent: neither line (drafts from before the Product Profile).
   */
  product?: ShotProductContext | null;
}

export interface ShotPlanShot {
  shot_id: string;
  /** 0-based place in the plan. */
  index: number;
  kind: string;
  shows: ShotSubject;
  /** The clip the model renders, in s (the duration field: priced, never edited). */
  clip_seconds: 5 | 10;
  /** How long the shot stays on screen in the cut. */
  on_screen_ms: number;
  /** The plan's own on-screen share (PlannedShot.onScreenMs), or null when the cut plays the clips back to back. */
  planned_on_screen_ms: number | null;
  /** The shot is animated from this generated starting frame (#18), else from the product photo. */
  starting_frame: StartingFrame | null;
  /** What the starting frame shows (not editable); null without a frame. */
  frame_scene: string | null;
  /** The model it renders on, and the one it falls back to (#25) — the model field: priced, never edited. */
  video: ShotVideo;
  /** The Short's Set, by id (#33); null until Shorts have one. */
  set_id: string | null;
  /** The Preset's fields for this shot. */
  default_fields: ShotFields;
  /** The fields that render: the user's edits over the defaults. */
  fields: ShotFields;
  /** The fields the user's edits changed, in SHOT_FIELDS order. */
  edited_fields: ShotField[];
  edited: boolean;
  /** The locked lines per stage, each in prompt order (./guardrails.ts), for the shot's model (video.model). */
  guardrails: StageGuardrails;
  /**
   * The video stage's locked lines on every model of the shot's chain, the
   * model first (its entry equals guardrails.video). They differ where one
   * model takes the person's face and another gets the person in words
   * (ADR 0003): the worker sends each attempt its own model's prompt.
   */
  video_guardrails_by_model: Partial<Record<VideoModelId, Guardrail[]>>;
}

export interface ShotPlan {
  /** The Short's Set (#33), or null. */
  set: ShotSetRef | null;
  shots: ShotPlanShot[];
}

function defaultFields(preset: ShotPlanPreset, kind: string, shows: ShotSubject, ctx: ShotPlanContext): ShotFields {
  const d = preset.shots[kind];
  if (!d) throw new Error(`${preset.name} has no shot wording for ${kind} shots`);
  const vars = ctx.vars ?? {};
  const text = (v: string | undefined) => (v ? fillPrompt(v, vars) : '');
  const out = {} as Record<ShotField, string>;
  for (const f of SHOT_FIELDS) {
    out[f] = f === 'energy' ? d.energy : f === 'action' ? productInteractionAction(shows, ctx.interaction) : text(d[f]);
  }
  return out as ShotFields;
}

/**
 * The Shot Plan for `ctx.durationMs` of speech under `preset`, with `edits`
 * (shot id → { field: value }) applied. A field edited to its default is no
 * edit. Throws ShotEditError on an edit for a shot the plan does not have, a
 * field it does not have, or a value that cannot render; RangeError outside
 * the Preset's speech band; Error on a template placeholder the Preset's
 * inputs do not fill.
 */
export function composeShotPlan(preset: ShotPlanPreset, ctx: ShotPlanContext, edits?: Readonly<Record<string, unknown>> | null): ShotPlan {
  const planned = planPresetShots(preset, ctx.durationMs);
  const ids = shotIds(planned.map((s) => s.role));
  for (const id of Object.keys(edits ?? {})) {
    if (!ids.includes(id)) {
      throw new ShotEditError(id, invalid('unknown_shot', `This render has no shot "${id}"; its shots are ${ids.join(', ')}. Ask for the Shot Plan again.`));
    }
  }
  const set = ctx.set ?? null;
  const personLine = personDescriptionLine(ctx.person);
  const profile = ctx.product?.profile ?? null;
  const inUseLine = ctx.product?.inUseReference && profile ? inUseReferenceLine(profile) : null;
  let elapsed = 0;
  const shots = planned.map((s, index): ShotPlanShot => {
    const { kind } = s;
    const shows = preset.shotKinds[kind].shows;
    const frame = shotFrame(preset, kind) ?? null;
    const onScreen = s.onScreenMs ?? Math.min(s.seconds * 1000, Math.max(0, ctx.durationMs - elapsed));
    elapsed += onScreen;
    const id = ids[index];
    const defaults = defaultFields(preset, kind, shows, ctx);
    const edit = edits && Object.hasOwn(edits, id) ? checkedEdit(id, shows, edits[id]) : {};
    const fields = { ...defaults, ...edit } as ShotFields;
    const edited_fields = SHOT_FIELDS.filter((f) => fields[f] !== defaults[f]);
    const frameScene = frame ? preset.frameScenes?.[kind] : undefined;
    if (frame && !frameScene) throw new Error(`${preset.name} has no frame scene for ${kind} shots`);
    const video = shotVideo(preset, kind);
    const guardrailCtx = (model: VideoModelId) => ({
      shows,
      startingFrame: frame !== null,
      personReference: shotHasPersonReference(preset, kind, model, ctx.personImage),
      personDescription: personLine,
      modesty: ctx.modesty,
      inUseReference: inUseLine,
      scaleAnchor: scaleAnchorLine(profile, shows === 'person' ? ctx.person?.gender : ctx.product?.handGender),
    });
    const video_guardrails_by_model: Partial<Record<VideoModelId, Guardrail[]>> = {};
    for (const m of shotModelChain(video)) video_guardrails_by_model[m] = stageGuardrails('video', guardrailCtx(m));
    return {
      shot_id: id,
      index,
      kind,
      shows,
      clip_seconds: s.seconds,
      on_screen_ms: onScreen,
      planned_on_screen_ms: s.onScreenMs ?? null,
      starting_frame: frame,
      frame_scene: frameScene ? fillPrompt(frameScene, ctx.vars ?? {}) : null,
      video,
      set_id: set?.set_id ?? null,
      default_fields: defaults,
      fields,
      edited_fields,
      edited: edited_fields.length > 0,
      guardrails: shotGuardrails(guardrailCtx(video.model)),
      video_guardrails_by_model,
    };
  });
  return { set, shots };
}

/**
 * A shot's final prompt for one stage: the stage's reference Guardrails, the
 * shot's content, then the stage's rule Guardrails — with the reference images
 * named in `words` (a provider's syntax, or plain words for the Shot Plan
 * view). The video stage's content is the fields (composeFields); the image
 * stage's is the frame scene and the shot's action (the frame is already
 * mid-use). The `request` Guardrails (audio off) are not prompt text. Throws
 * for the image stage of a shot with no starting frame.
 */
export function shotPrompt(
  shot: Pick<ShotPlanShot, 'fields' | 'guardrails' | 'frame_scene' | 'shot_id'> & Partial<Pick<ShotPlanShot, 'video_guardrails_by_model'>>,
  stage: ShotStage,
  words: ReferenceWords,
  /** The video stage on this model of the shot's chain (its own Guardrails); absent = the shot's model. */
  model?: VideoModelId,
): string {
  let content: string;
  if (stage === 'image') {
    if (shot.frame_scene === null) throw new Error(`${shot.shot_id} has no starting frame, so no image-stage prompt`);
    content = [shot.frame_scene, asSentence(shot.fields.action)].filter(Boolean).join(' ');
  } else {
    content = composeFields(shot.fields);
  }
  let list = shot.guardrails[stage];
  if (stage === 'video' && model !== undefined) {
    const own = shot.video_guardrails_by_model?.[model];
    if (!own) throw new Error(`${shot.shot_id} does not render on ${model}`);
    list = own;
  }
  const lines = (at: Guardrail['at']) => list.filter((g) => g.at === at).map((g) => g.text);
  return withReferences([...lines('before_scene'), content, ...lines('after_scene')].join(' '), words);
}

/** Only the field edits that change a shot, tidied (what a run stores and hands the worker). */
export function effectiveEdits(plan: ShotPlan): Record<string, ShotEdit> {
  return Object.fromEntries(
    plan.shots
      .filter((s) => s.edited)
      .map((s) => [s.shot_id, Object.fromEntries(s.edited_fields.map((f) => [f, s.fields[f]])) as ShotEdit]),
  );
}
