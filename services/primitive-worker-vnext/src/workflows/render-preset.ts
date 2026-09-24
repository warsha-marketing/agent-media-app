// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The shared Preset render pipeline (renderPreset, #16).
 *
 * A Preset is data (../presets, @agentmedia/schema PresetDefinition): its shot
 * plan, shot prompts, required inputs and cost budget. This pipeline reads the
 * definition it is given and never branches on the Preset's name; a new Preset
 * is a new definition plus a thin registered workflow naming it by id (see
 * make-product-hero.ts), not a copied workflow.
 *
 * Internal by design: renderPreset is NOT a Temporal workflow type (./index.ts
 * does not export it). Only the per-Preset wrappers are registered, they take
 * no prompts, and each resolves its definition server-side by id — so starting
 * a workflow can never inject shot prompts into the pipeline.
 *
 * ADR 0001: a Short is audio-first and the video model never speaks. The render
 * takes an APPROVED draft (its audio is exactly what the user heard) and:
 *
 *   1. fetchDraftAudio — reads the draft's private audio by key and measures it.
 *                        Nothing visual is requested until the audio is in hand.
 *   1b. presetStartingFrame — (#18) only for shot kinds that declare a starting
 *                        frame (e.g. Hands-on's product-in-hands image): one
 *                        image per such planned shot, all before any clip. The
 *                        shot is then animated from its frame, not the photo.
 *   2. presetClip — one silent clip per planned shot (generate_audio: false),
 *                        from the product photo, prompted for its shot kind (plus the Modesty Default on every
 *                        shot that shows a person or hands, #17). Shots
 *                        come from the SAME plan the quote priced (planPresetShots
 *                        over the draft's duration), so the charge is the quote.
 *                        A shot showing a person also gets the person's reference
 *                        (character_image_url, Reaction #19) — only on a model
 *                        that takes a re-hosted face: on ModelArk (ADR 0003,
 *                        #29) the person is described in words and the face
 *                        goes only to a fallback that takes it (Kling, Veo);
 *                        each attempt gets its own model's prompt. Each shot renders
 *                        on its kind's video model (#25, data on the Preset);
 *                        if that model refuses or fails and the kind names a
 *                        fallback, the failed attempt is refunded and the
 *                        fallback renders the shot. Both refusing is the
 *                        non-retryable content-policy failure. Every hands and
 *                        person scene also carries the draft's Product
 *                        Interaction (#25). Every frame and clip prompt is a
 *                        Shot Prompt (#26, #28): the shot's fields — the
 *                        Preset's, with the user's edits (shot_edits, checked
 *                        again here) — plus the Guardrails of that stage (image
 *                        for the frame, video for the clip), which this worker
 *                        ALWAYS adds from its own copy (@agentmedia/shot-prompts),
 *                        whatever the input says. Each shot's prompts as sent
 *                        are stored on its rows and on the Short
 *                        (final_output.shots).
 *   3. presetMux  — hard-cuts the clips on the 9:16 canvas (shots with a
 *                        planned on-screen share each cut to it), trims (or, if a
 *                        clip ran a few ms short, holds) the visuals to the audio's
 *                        exact length, and muxes the draft audio in whole. Audio is
 *                        never trimmed or stretched.
 *   3b. mixMusicBed    — (#9) only when api-v2 chose a Music Bed track from the
 *                        Preset's set: lays it ducked under the draft voice; the
 *                        voice sets the length. No track (Music Bed off, or none
 *                        licensed) → no step, and the Short's audio is exactly
 *                        the draft voice.
 *
 * A render never burns Captions (#22): the Short it stores is always clean.
 * Captions are added afterwards in the Caption editor and burned by their own
 * job (./caption-export.ts).
 *
 * Each step writes its own primitive_runs row under the skill run; the Short is
 * the skill run's final output. A terminal failure anywhere refunds every
 * charged child (idempotent), marks the failing step and the run failed, then
 * releases the draft's render claim so the same draft can be rendered again. A
 * content-policy verdict on the product photo is never retried.
 *
 * Before step 1 the render refuses to start without every input its Preset
 * requires, or with a Modesty less modest than the Preset allows.
 */

import { proxyActivities, ApplicationFailure } from '@temporalio/workflow';
import {
  armsAtLeast,
  modelClipUsd,
  modelRenderSeconds,
  presetShows,
  shotModelChain,
  type Modesty,
  type PersonGender,
  type PresetInput,
  type HandGender,
  type HandsOnSetting,
  type VideoModelId,
} from '@agentmedia/schema';
import type { PrimitiveActivities } from '../activities/index.js';
import { makeChildRunId } from './child-run-id.js';
import { failureInfo } from './failure-info.js';
import { CONTENT_POLICY_REFUSED, NON_RETRYABLE_TYPES, failurePolicy } from '../failure-policy.js';
import type { PresetRenderDefinition } from '../presets/index.js';
import {
  IMAGE_REFERENCES,
  REFERENCE_TOKENS,
  ShotEditError,
  VIDEO_MODEL_LABELS,
  composeShotPlan,
  shotHasPersonReference,
  shotPrompt,
  type ShotEdit,
  type ShotField,
  type ShotFields,
  type ShotPlanShot,
} from '@agentmedia/shot-prompts';

/**
 * What a registered Preset workflow (e.g. makeProductHeroWorkflow) is started
 * with. It carries NO Preset definition and no prompts: the wrapper resolves
 * its definition server-side (presetRender(id)), so a caller that can start a
 * workflow can never hand the pipeline its own shot prompts.
 */
export interface PresetRenderInput {
  skill_run_id: string;
  user_id: string;
  /** The approved draft being rendered (api-v2 claimed it for this run). */
  draft_id: string;
  /** Private storage key of the draft's audio. Server-side only. */
  audio_key: string;
  /** The draft's measured speech length; the shots are planned (and priced) from it. */
  duration_ms: number;
  /** R2-hosted, moderated product photo. */
  product_image_url: string;
  /**
   * R2-hosted, moderated reference of the person on screen (Reaction, #19: the
   * saved character's portrait or sheet, re-hosted by api-v2). Passed to the
   * shots whose kind shows a person, and to no other shot.
   */
  character_image_url?: string;
  /**
   * The saved character in words (ADR 0003, #29): its gender (the caller's
   * character_gender) and description (user_characters.description), from
   * api-v2. Said on a person shot whose model does not take the face
   * (ModelArk), cleaned and dropped if it breaks a Guardrail. Absent on runs
   * from before #29: the person is then described by nothing but the Modesty
   * Default on ModelArk.
   */
  character_gender?: PersonGender | null;
  character_description?: string | null;
  aspect_ratio: '9:16';
  /**
   * Music Bed (#9): the track api-v2 chose from the Preset's set
   * (resolveMusicBed), or null/absent for voice only. Absent on runs started
   * before the Music Bed.
   */
  music_bed?: { track_id: string; storage_key: string } | null;
  /**
   * Modesty Default (#17): what api-v2 resolved for this render with
   * resolveModesty (the Preset's defaults for the draft's Dialect, the person's
   * gender and the user's choice), the same way it resolves the Music Bed.
   * Required when the Preset shows a person (the hijab depends on it); for a
   * hands-only Preset, absent means the Preset's default arms; ignored by a
   * Preset with product shots only. Never less modest than the Preset allows:
   * the render re-checks it before anything is requested.
   */
  modesty?: Modesty | null;
  /** Hands-on (#18): whose hands are on screen; api-v2 defaults it from the Product Details. */
  hand_gender?: HandGender;
  /** Hands-on (#18): where the hands use the product; api-v2 defaults it from the Product Details. */
  setting?: HandsOnSetting;
  /**
   * Product Interaction (#25): how a real person uses the product (e.g. perfume:
   * "holds the uncapped bottle, sprays once on the inner wrist, sets the bottle down, …"), from the draft. Added
   * to every hands and person prompt (clip and starting frame), after — and
   * never overriding — the Modesty Default and the no-speaking wording; never
   * to a product shot. Absent/null on drafts from before it: prompts unchanged.
   */
  product_interaction?: string | null;
  /**
   * Shot Plan review (#26, #28): the fields the user changed, by shot id
   * (the shot's role: `reaction`, `product-closer`, …), e.g.
   * { "reaction": { "scene": "…", "energy": "lively" } }, as api-v2 validated
   * them against the same plan. Only shot fields: never a length or model, and
   * the Guardrails are never part of the input — the render adds its own to
   * every stage of every shot. Checked again here (the ids, the fields, the
   * lengths, no brackets or reference syntax, the guardrail check): a bad edit
   * refuses the render before anything is requested. Absent/empty: every shot
   * renders the Preset's fields, exactly as before.
   */
  shot_edits?: Readonly<Record<string, ShotEdit>> | null;
}

/** One shot of the finished Short as it rendered (final_output.shots, #26, #28). */
export interface RenderedShot {
  shot_id: string;
  kind: string;
  /** The model that rendered it (its kind's model, or the fallback). */
  model: string;
  /** That model by name, as the Shot Plan showed it (VIDEO_MODEL_LABELS); the id for a model it does not name. */
  model_name: string;
  /** The fields it rendered, and which of them were the user's. */
  fields: ShotFields;
  edited_fields: ShotField[];
  edited: boolean;
  /** The Guardrails it carried, per stage (image: its starting frame's; empty without one). */
  guardrails: { image: string[]; video: string[] };
  /** The starting frame's prompt as sent (image stage), on a shot that has one. */
  frame_prompt?: string;
  /** The final clip prompt exactly as sent to that model (fields + Guardrails, its reference syntax). */
  prompt: string;
}

export interface PresetRenderResult {
  skill_run_id: string;
  draft_id: string;
  video_url: string;
  /** The finished Short's length as MEASURED from the output file. */
  duration_ms: number;
  credits_actual_usd: number;
}

/** Where each input a Preset can require is carried on the render input. */
const PRESET_INPUT_FIELDS: Record<PresetInput, keyof PresetRenderInput> = {
  product_image: 'product_image_url',
  character: 'character_image_url',
  hand_gender: 'hand_gender',
  setting: 'setting',
};

/** A finished cut may differ from the audio by at most about one frame. */
const MAX_CUT_DRIFT_MS = 50;

const { presetClip, presetStartingFrame } = proxyActivities<PrimitiveActivities>({
  startToCloseTimeout: '20 minutes',
  heartbeatTimeout: '5 minutes',
  retry: { initialInterval: '10s', maximumInterval: '2m', backoffCoefficient: 2, maximumAttempts: 3, nonRetryableErrorTypes: [...NON_RETRYABLE_TYPES] },
});
const { fetchDraftAudio, presetMux, mixMusicBed } = proxyActivities<PrimitiveActivities>({
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '2 minutes',
  retry: { initialInterval: '5s', maximumInterval: '60s', backoffCoefficient: 2, maximumAttempts: 3, nonRetryableErrorTypes: [...NON_RETRYABLE_TYPES] },
});
const { composedSkillState } = proxyActivities<PrimitiveActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});
const { refundCredits, markPrimitiveRunFailed, releaseDraftRender } = proxyActivities<PrimitiveActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '2s', maximumInterval: '20s', backoffCoefficient: 2, maximumAttempts: 5 },
});

/**
 * Render an approved draft as `preset`. Every Preset runs exactly this, called
 * from its registered wrapper workflow with the definition that wrapper
 * resolved server-side. NOT a workflow type itself (never re-exported from
 * ./index.ts): its `preset` argument must never come from a workflow start.
 */
export async function renderPreset(
  input: PresetRenderInput,
  preset: PresetRenderDefinition,
): Promise<PresetRenderResult> {
  const skillRunId = input.skill_run_id;
  // Every child id minted, so the catch refunds exactly what could have been
  // charged (refund is idempotent and a no-op on the free steps).
  const childIds: string[] = [];
  let currentChild: string | undefined;
  const mint = (step: string): string => {
    const id = makeChildRunId(skillRunId, step);
    childIds.push(id);
    currentChild = id;
    return id;
  };

  await composedSkillState({ skill_run_id: skillRunId, status: 'running', current_step: 'audio', started_at_now: true });

  try {
    for (const need of preset.requiredInputs) {
      const value = input[PRESET_INPUT_FIELDS[need]];
      if (typeof value !== 'string' || value.trim() === '') {
        throw ApplicationFailure.nonRetryable(`${preset.name} needs ${need}`, 'INVALID_INPUT');
      }
    }

    const modesty = modestyFor(preset, input.modesty ?? null);
    const vars = promptVarsFor(preset, input);
    const interaction = input.product_interaction ?? null;

    // The shots and every prompt of the render, before anything is requested,
    // so a refused edit costs nothing. The plan is planPresetShots' (the one the
    // quote priced), planned once, inside composeShotPlan; each shot's fields
    // are the user's edits (checked again) over the Preset's, and every prompt
    // gets this worker's own Guardrails for its stage (#26, #28).
    let shots: ShotPlanShot[];
    let framePrompts: Array<string | null>;
    let clipPrompts: Array<Partial<Record<VideoModelId, string>>>;
    try {
      const person = { gender: input.character_gender ?? null, description: input.character_description ?? null };
      shots = composeShotPlan(preset, { durationMs: input.duration_ms, modesty, vars, interaction, person }, input.shot_edits ?? null).shots;
      // A starting frame is an image edit of the product photo: its one reference image.
      framePrompts = shots.map((s) => (s.starting_frame ? shotPrompt(s, 'image', IMAGE_REFERENCES) : null));
      // Each model of the shot's chain gets its own prompt (the face, or the
      // person in words); the provider adapter (presetClip) swaps the
      // reference tokens for its own syntax.
      clipPrompts = shots.map((s) =>
        Object.fromEntries(shotModelChain(s.video).map((m) => [m, shotPrompt(s, 'video', REFERENCE_TOKENS, m)])),
      );
    } catch (err) {
      if (err instanceof ShotEditError) throw ApplicationFailure.nonRetryable(err.message.slice(0, 500), err.code);
      throw ApplicationFailure.nonRetryable((err as Error).message, 'INVALID_INPUT');
    }
    const rendered: RenderedShot[] = [];

    // ── 1. The draft's audio, first ─────────────────────────────────────────
    const audio = await fetchDraftAudio({
      primitive_run_id: mint('audio'),
      user_id: input.user_id,
      skill_run_id: skillRunId,
      draft_id: input.draft_id,
      audio_key: input.audio_key,
      duration_ms: input.duration_ms,
    });

    let totalUsd = 0;
    // ── 1b. Starting frames (#18), every one before any clip ────────────────
    const frameUrls: Array<string | null> = shots.map(() => null);
    for (let i = 0; i < shots.length; i += 1) {
      const frame = shots[i].starting_frame;
      const framePrompt = framePrompts[i];
      if (!frame || !framePrompt) continue;
      await composedSkillState({ skill_run_id: skillRunId, current_step: `frame_${i + 1}` });
      const made = await presetStartingFrame({
        primitive_run_id: mint(`frame_${i}`),
        user_id: input.user_id,
        skill_run_id: skillRunId,
        product_image_url: input.product_image_url,
        frame,
        preset: preset.id,
        shot_kind: shots[i].kind,
        shot_index: i,
        prompt: framePrompt,
      });
      frameUrls[i] = made.image_url;
      totalUsd += made.credits_actual_usd;
    }
    // ── 2. Silent clips covering the speech ─────────────────────────────────
    const clipUrls: string[] = [];
    for (let i = 0; i < shots.length; i += 1) {
      await composedSkillState({ skill_run_id: skillRunId, current_step: `clip_${i + 1}` });
      // The models this shot may render on (#25): its kind's model, then its
      // fallback — as the Preset declares them, never chosen by vendor here.
      const chain = shotModelChain(shots[i].video);
      let clip: Awaited<ReturnType<typeof presetClip>> | undefined;
      // A content refusal on an earlier model of the chain: if the fallback
      // then fails for another reason, the refusal is what the run reports.
      let refused: string | undefined;
      let ranOn: string | undefined;
      for (let a = 0; a < chain.length && !clip; a += 1) {
        const childId = mint(a === 0 ? `clip_${i}` : `clip_${i}_${chain[a]}`);
        try {
          clip = await presetClip({
            primitive_run_id: childId,
            user_id: input.user_id,
            skill_run_id: skillRunId,
            // The shot's start image: its starting frame if it has one, else the photo.
            start_image_url: frameUrls[i] ?? input.product_image_url,
            duration: shots[i].clip_seconds,
            shot_index: i,
            shot_count: shots.length,
            preset: preset.id,
            shot_kind: shots[i].kind,
            model: chain[a],
            prompt: clipPrompts[i][chain[a]]!,
            generate_audio: false,
            // The person's reference only where the shot shows that person (#19)
            // and this model takes a re-hosted face (ADR 0003: never ModelArk),
            // decided as the Guardrails' person_reference line is (one helper).
            ...(shotHasPersonReference(preset, shots[i].kind, chain[a], 'rehosted') && input.character_image_url
              ? { character_image_url: input.character_image_url }
              : {}),
          });
          ranOn = chain[a];
        } catch (err) {
          const f = failureInfo(err);
          const last = a === chain.length - 1;
          if (last || !failurePolicy(f.code).fallbackable) {
            if (refused === undefined || f.code === CONTENT_POLICY_REFUSED) throw err;
            // The fallback failed too, for another reason: record its own
            // failure, and fail the run as the refusal that sent it here.
            await markPrimitiveRunFailed({ primitive_run_id: childId, error_code: f.code, error_message: f.message });
            currentChild = undefined;
            throw ApplicationFailure.nonRetryable(
              `shot ${i + 1}: ${refused}; the fallback ${chain[a]} then failed (${f.code})`.slice(0, 500),
              CONTENT_POLICY_REFUSED,
            );
          }
          if (f.code === CONTENT_POLICY_REFUSED) refused ??= f.message;
          // This model refused or failed: give its charge back, record it, and
          // try the fallback. The shot is charged the same whichever model runs,
          // but the failed attempt may still have cost us: count it (worst case,
          // as the Preset's maxProviderUsd budgets it).
          totalUsd += modelClipUsd(chain[a], shots[i].clip_seconds);
          await refundCredits({ primitive_run_id: childId });
          await markPrimitiveRunFailed({ primitive_run_id: childId, error_code: f.code, error_message: f.message });
        }
      }
      if (!clip) throw ApplicationFailure.nonRetryable(`no model rendered shot ${i + 1}`, 'CLIP_FAILED');
      clipUrls.push(clip.video_url);
      const framePrompt = framePrompts[i];
      // A clip from before #26 (a replayed history) reports neither; fall back to what was asked.
      const model = clip.model ?? ranOn ?? chain[0];
      rendered.push({
        shot_id: shots[i].shot_id,
        kind: shots[i].kind,
        model,
        model_name: (VIDEO_MODEL_LABELS as Readonly<Record<string, string>>)[model] ?? model,
        fields: shots[i].fields,
        edited_fields: shots[i].edited_fields,
        edited: shots[i].edited,
        guardrails: {
          image: shots[i].guardrails.image.map((g) => g.id),
          // The lines of the model that rendered it (the face, or the person in words).
          video: (shots[i].video_guardrails_by_model?.[model as VideoModelId] ?? shots[i].guardrails.video).map((g) => g.id),
        },
        ...(framePrompt ? { frame_prompt: framePrompt } : {}),
        prompt: clip.prompt ?? clipPrompts[i][model as VideoModelId] ?? clipPrompts[i][chain[0]]!,
      });
      totalUsd += clip.credits_actual_usd;
    }

    // ── 3. Cut the visuals to the audio and mux the draft audio in ─────────
    await composedSkillState({ skill_run_id: skillRunId, current_step: 'mux' });
    let short = await presetMux({
      primitive_run_id: mint('mux'),
      user_id: input.user_id,
      skill_run_id: skillRunId,
      clip_urls: clipUrls,
      audio_key: audio.audio_key,
      audio_duration_ms: audio.duration_ms,
      aspect_ratio: preset.aspectRatio,
      preset: preset.id,
      // A plan that shares the speech between its shots (Reaction's intercut, a
      // closing pair like Hands-on ≤10 s) cuts each shot to its planned share;
      // so does one with a shot whose model may render longer than planned
      // (#25: Veo 3.1 renders 8 s for a 5 s shot).
      ...(shots.every((s) => s.planned_on_screen_ms !== null) || shots.some(overruns)
        ? { shot_ms: shots.map((s) => s.planned_on_screen_ms ?? s.clip_seconds * 1000) }
        : {}),
    });
    // ── 3b. Music Bed (#9): ducked under the voice; never lengthens the Short ─
    const musicBed = input.music_bed ?? null;
    if (musicBed) {
      await composedSkillState({ skill_run_id: skillRunId, current_step: 'music_bed' });
      short = await mixMusicBed({
        primitive_run_id: mint('music_bed'),
        user_id: input.user_id,
        skill_run_id: skillRunId,
        short_url: short.video_url,
        audio_key: audio.audio_key,
        audio_duration_ms: audio.duration_ms,
        preset: preset.id,
        aspect_ratio: preset.aspectRatio,
        track_id: musicBed.track_id,
        track_storage_key: musicBed.storage_key,
      });
    }
    if (Math.abs(short.duration_ms - audio.duration_ms) > MAX_CUT_DRIFT_MS) {
      throw ApplicationFailure.nonRetryable(
        `cut is ${short.duration_ms} ms but the audio is ${audio.duration_ms} ms`,
        'CUT_DURATION_MISMATCH',
      );
    }
    currentChild = undefined;

    // Report what the mux measured — checked against the audio above — never
    // the audio's length assumed as the Short's.
    const finalOutput = {
      video_url: short.video_url,
      duration_ms: short.duration_ms,
      audio_duration_ms: audio.duration_ms,
      draft_id: input.draft_id,
      aspect_ratio: preset.aspectRatio,
      credits_actual_usd: totalUsd,
      music_bed: musicBed?.track_id ?? null, // #9
      // #26: what ran — each shot's final prompt as sent, for the owner.
      shots: rendered,
    };
    await composedSkillState({
      skill_run_id: skillRunId,
      status: 'succeeded',
      current_step: 'done',
      finished_at_now: true,
      final_output: finalOutput,
    });
    return {
      skill_run_id: skillRunId,
      draft_id: input.draft_id,
      video_url: short.video_url,
      duration_ms: short.duration_ms,
      credits_actual_usd: totalUsd,
    };
  } catch (err) {
    const f = failureInfo(err);
    // Workflow-level failures (not from an activity) carry their own type.
    const code = err instanceof ApplicationFailure && err.type ? err.type : f.code;
    const message = err instanceof ApplicationFailure ? err.message.slice(0, 500) : f.message;
    for (const id of childIds) await refundCredits({ primitive_run_id: id });
    if (currentChild) {
      await markPrimitiveRunFailed({ primitive_run_id: currentChild, error_code: code, error_message: message });
    }
    await composedSkillState({
      skill_run_id: skillRunId,
      status: 'failed',
      finished_at_now: true,
      error_code: code,
      error_message: message,
    });
    // Refunded and recorded failed: give the draft back so the user can render
    // the same approved audio again. Best effort — api-v2 also treats a claim
    // still held by a failed run as free — so it never masks the real failure.
    try {
      await releaseDraftRender({ skill_run_id: skillRunId, draft_id: input.draft_id });
    } catch {
      // keep the render's own error
    }
    throw err;
  }
}

/** Whether a model of this shot's chain may render longer than the planned clip (#25). */
function overruns(s: ShotPlanShot): boolean {
  return shotModelChain(s.video).some((m) => modelRenderSeconds(m, s.clip_seconds) > s.clip_seconds);
}

/**
 * The words the Preset's prompts are filled with (#18), from its own inputs.
 * An input it cannot word refuses the render before anything is requested.
 */
function promptVarsFor(preset: PresetRenderDefinition, input: PresetRenderInput): Readonly<Record<string, string>> {
  if (!preset.promptVars) return {};
  try {
    return preset.promptVars(input);
  } catch (err) {
    throw ApplicationFailure.nonRetryable((err as Error).message, 'INVALID_INPUT');
  }
}

/**
 * The Modesty Default this render applies (#17), held to the Preset: arms never
 * less modest than it allows, a hijab only where it shows a person. Checked
 * before anything is requested, so a refused render costs nothing.
 */
function modestyFor(preset: PresetRenderDefinition, given: Modesty | null): Modesty {
  const showsPerson = presetShows(preset, 'person');
  if (!given) {
    if (showsPerson) {
      throw ApplicationFailure.nonRetryable(`${preset.name} needs the resolved Modesty Default`, 'INVALID_INPUT');
    }
    return { arms: preset.modesty.arms.default, hijab: false };
  }
  if (!armsAtLeast(given.arms, preset.modesty.arms.least)) {
    throw ApplicationFailure.nonRetryable(
      `${preset.name} shows arms at least ${preset.modesty.arms.least}; "${given.arms}" is less modest than the Preset allows`,
      'INVALID_INPUT',
    );
  }
  if (given.hijab && !showsPerson) {
    throw ApplicationFailure.nonRetryable(`${preset.name} shows no person to wear a hijab`, 'INVALID_INPUT');
  }
  return given;
}
