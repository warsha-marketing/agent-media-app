// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Shot Plan review (#26, #28) — the Preset
 * render's shots, composed at the API so the user can see (and edit the fields
 * of) each Shot Prompt before the render.
 *
 *   POST /v1/skills/{slug}/shot-plan  — the plan for a draft + Preset + inputs
 *       (the quote's body; owner-only, and operators may preview an unqualified
 *       Preset–Dialect pair, like drafting): the Short's Set (null until #33),
 *       and every shot with its stable id (its role in the Preset: `reaction`,
 *       `product-closer`; never its position), kind, on-screen length, model and
 *       fallback, its structured fields (and the Preset's defaults) and its
 *       locked Guardrail lines per stage (image: the starting frame; video).
 *   `shot_edits` on the quote and the run — { shot_id: { scene?, framing?,
 *       blocking?, environment_interaction?, performance?, action?, energy?,
 *       camera_move?, lens_feel?, lighting? } }: checked here against the same
 *       plan (ids, fields, length caps, no bracketed tags or reference syntax,
 *       the guardrail check) → 422 SHOT_EDIT_INVALID / SHOT_EDIT_BREAKS_GUARDRAIL.
 *       Edits never change the shots, so never the price; they are in the
 *       Idempotency-Key fingerprint (the validated body). The run hands the
 *       worker only the fields that change a shot; the worker re-checks them
 *       and always adds its own Guardrails.
 *   Playbooks (#32) — the draft's Product Profile category picks one
 *       (renderPlaybook): its shot pattern and defaults shape the plan, its
 *       negatives are a locked line on the video stage, and a field asking
 *       for one of its banned motions is refused (422 SHOT_EDIT_BANNED_MOTION,
 *       with playbook, rule and matched). The plan says which one
 *       (`playbook`: id, version, pattern); the quote prices that plan and the
 *       run hands the choice to the worker, which renders the same one.
 *
 * The composition is @agentmedia/shot-prompts' (server-only, shared with the
 * worker), from the same draft duration, Modesty Default, Preset inputs and
 * Product Interaction the render gets.
 */

import { z } from 'zod';
import { shotFallbacks, type Modesty, type PersonGender, type PresetDefinition } from '@agentmedia/schema';
import {
  PEOPLE_FIELDS,
  SHOT_ENERGIES,
  SHOT_FIELDS,
  SHOT_FIELD_LABELS,
  SHOT_FIELD_MAX_CHARS,
  SHOT_TEXT_FIELDS,
  ShotEditError,
  VIDEO_MODEL_LABELS,
  choosePlaybook,
  composeShotPlan,
  displayReferences,
  presetPrompts,
  shotPrompt,
  withReferences,
  type Guardrail,
  type ReferenceWords,
  type ResolvedPlaybook,
  type ShotPlan,
  type ShotPlanPreset,
  type ShotPlanShot,
} from '@agentmedia/shot-prompts';
import { RenderRefusal, type RenderableDraft } from './product-hero-render.js';
import type { PresetInputs } from './preset-inputs.js';

/**
 * One shot's edit: loose here (types and a DoS bound only; an unknown field
 * passes through), so the real checks answer 422 with a code.
 */
const shotEditField = z
  .object({
    ...Object.fromEntries(
      SHOT_TEXT_FIELDS.map((f) => [f, z.string().max(SHOT_FIELD_MAX_CHARS[f] * 4).optional().describe(SHOT_FIELD_LABELS[f])]),
    ),
    energy: z.string().max(40).optional().describe(`Energy: ${SHOT_ENERGIES.join(' | ')}`),
  })
  .passthrough();

/** The `shot_edits` skill input field. */
export const shotEditsField = z
  .record(z.string().max(100), shotEditField)
  .refine((edits) => Object.keys(edits).length <= 16, { message: 'at most 16 shot edits' })
  .optional()
  .describe(
    `Optional, from Shot Plan review: your own fields for some shots, by shot_id from POST /v1/skills/{slug}/shot-plan, e.g. { "reaction": { "scene": "The person smells the skin of the inner wrist and nods.", "energy": "lively" } }. ` +
      `Fields: ${SHOT_FIELDS.join(', ')} (energy is ${SHOT_ENERGIES.join(' | ')}; performance and action only on shots that show hands or a person; any field but the scene may be cleared with ""). ` +
      `A shot's length and model never change. The Guardrails (references, nobody speaks, one simple hand action, modest styling, no text, audio off) are always added by the server. ` +
      `Plain words (say "the product", "the person"; no [tags] or @image references), at most ${SHOT_FIELD_MAX_CHARS.scene} characters for the scene. Never changes the price.`,
  );

/** The Modesty Default the render will apply: the resolver's, else the Preset's default arms (a Preset with no one on screen). */
function renderModesty(preset: PresetDefinition, presetInputs: PresetInputs): Modesty {
  const m = presetInputs.run.modesty as Modesty | undefined;
  return m ?? { arms: preset.modesty.arms.default, hijab: false };
}

/**
 * The Playbook (#32) a render of `draft` follows: its Product Profile's
 * category's, and General for a category without its own, for a draft without
 * a Profile (from before #30, or made without a photo) and for one whose
 * Profile no longer reads as one.
 */
export function renderPlaybook(draft: Pick<RenderableDraft, 'product_profile'>): ResolvedPlaybook {
  // The Profile was validated once, when the draft was resolved (resolveRenderableDraft).
  return choosePlaybook(draft.product_profile ?? null);
}

/**
 * The Shot Plan of rendering `draft` as `preset` with the Preset inputs the
 * route resolved, and `edits` applied. A refused edit is a 422
 * RenderRefusal carrying its shot_id, field and reason (and the Guardrail it broke).
 */
export function composeRenderShotPlan(
  preset: PresetDefinition,
  draft: Pick<RenderableDraft, 'duration_ms' | 'product_interaction' | 'product_profile'>,
  presetInputs: PresetInputs,
  edits: unknown,
  /** #31: the render uses the draft's In-use Reference (renderInUseReference). */
  inUseReference = false,
): ShotPlan {
  const prompts = presetPrompts(preset.id);
  const plannable = { ...preset, ...prompts } as ShotPlanPreset;
  try {
    return composeShotPlan(
      plannable,
      {
        durationMs: Number(draft.duration_ms),
        modesty: renderModesty(preset, presetInputs),
        vars: prompts.promptVars ? prompts.promptVars(presetInputs.run) : {},
        interaction: draft.product_interaction ?? null,
        // The person in words, as the worker says it on a model that does not take the face (ADR 0003).
        person: {
          gender: (presetInputs.run.character_gender as PersonGender | undefined) ?? null,
          description: (presetInputs.run.character_description as string | null | undefined) ?? null,
        },
        // #31: the Scale Anchor and the In-use Reference line, as the worker adds them.
        product: {
          profile: draft.product_profile ?? null,
          inUseReference,
          handGender: (presetInputs.run.hand_gender as PersonGender | undefined) ?? null,
        },
        playbook: renderPlaybook(draft),
      },
      (edits ?? null) as Record<string, unknown> | null,
    );
  } catch (err) {
    if (err instanceof ShotEditError) {
      throw new RenderRefusal(422, err.code, err.message, {
        shot_id: err.shotId,
        reason: err.reason,
        ...(err.field ? { field: err.field } : {}),
        ...(err.guardrail ? { guardrail: err.guardrail, matched: err.matched } : {}),
        ...(err.rule ? { playbook: err.playbook, rule: err.rule, matched: err.matched } : {}),
      });
    }
    throw err;
  }
}

function guardrailView(g: Guardrail, words: ReferenceWords) {
  return { id: g.id, label: g.label, text: withReferences(g.text, words), enforced_by: g.at === 'request' ? 'request' : 'prompt' };
}

/** One shot as the API shows it: plain words for the reference images, never a provider's syntax. */
export function shotView(shot: ShotPlanShot) {
  // #31: the shot names the product image it is made from.
  const inUse = shot.product_reference === 'in_use_reference';
  const productWords = inUse ? { start: 'the In-use Reference' } : {};
  const fallbacks = shotFallbacks(shot.video).map((id) => ({ id, name: VIDEO_MODEL_LABELS[id] }));
  const video = { ...displayReferences(shot.starting_frame !== null), ...(shot.starting_frame === null ? productWords : {}) };
  const image = { ...displayReferences(false), ...productWords }; // a starting frame is an edit of the product reference
  return {
    shot_id: shot.shot_id,
    number: shot.index + 1,
    kind: shot.kind,
    shows: shot.shows,
    clip_seconds: shot.clip_seconds,
    on_screen_ms: shot.on_screen_ms,
    starting_frame: shot.starting_frame,
    product_reference: shot.product_reference,
    model: { id: shot.video.model, name: VIDEO_MODEL_LABELS[shot.video.model] },
    // The first fallback (null for none), and the whole chain after the model, in the order tried (ADR 0003).
    fallback: fallbacks[0] ?? null,
    fallbacks,
    set_id: shot.set_id,
    fields: shot.fields,
    default_fields: shot.default_fields,
    edited_fields: shot.edited_fields,
    edited: shot.edited,
    guardrails: {
      image: shot.guardrails.image.map((g) => guardrailView(g, image)),
      video: shot.guardrails.video.map((g) => guardrailView(g, video)),
    },
    prompt_preview: {
      image: shot.frame_scene !== null ? shotPrompt(shot, 'image', image) : null,
      video: shotPrompt(shot, 'video', video),
    },
  };
}

/** The editable fields, in composition order, as a client lays out a shot's card. */
export const SHOT_FIELD_CATALOG = SHOT_FIELDS.map((id) => ({
  id,
  label: SHOT_FIELD_LABELS[id],
  ...(id === 'energy' ? { choices: [...SHOT_ENERGIES] } : { max_chars: SHOT_FIELD_MAX_CHARS[id] }),
  required: id === 'scene',
  people_only: PEOPLE_FIELDS.includes(id),
}));

/** The shot-plan response body. */
export function shotPlanView(slug: string, preset: PresetDefinition, draft: Pick<RenderableDraft, 'id' | 'duration_ms'>, plan: ShotPlan) {
  return {
    skill: slug,
    preset: preset.id,
    draft_id: draft.id,
    duration_ms: Number(draft.duration_ms),
    set: plan.set,
    // #32: the Playbook the shots follow ({ id, version, pattern }), or null.
    playbook: plan.playbook,
    fields: SHOT_FIELD_CATALOG,
    shots: plan.shots.map(shotView),
  };
}
