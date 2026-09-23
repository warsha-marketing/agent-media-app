// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The shared Preset render pipeline (renderPresetWorkflow), and make_product_hero
 * — the Product Hero render phase — as one Preset definition on it (#16).
 *
 * A Preset is data (../presets, @agentmedia/schema PresetDefinition): its shot
 * plan, shot prompts, required inputs and cost budget. This pipeline reads the
 * definition it is given and never branches on the Preset's name; a new Preset
 * is a new definition (and a thin workflow naming it), not a copied workflow.
 *
 * ADR 0001: a Short is audio-first and the video model never speaks. The render
 * takes an APPROVED draft (its audio is exactly what the user heard) and:
 *
 *   1. fetchDraftAudio — reads the draft's private audio by key and measures it.
 *                        Nothing visual is requested until the audio is in hand.
 *   2. productHeroClip — one silent clip per planned shot (generate_audio: false),
 *                        from the product photo, prompted for its shot kind. Shots
 *                        come from the SAME plan the quote priced (planPresetShots
 *                        over the draft's duration), so the charge is the quote.
 *   3. muxProductHero  — hard-cuts the clips on the 9:16 canvas, trims (or, if a
 *                        clip ran a few ms short, holds) the visuals to the audio's
 *                        exact length, and muxes the draft audio in whole. Audio is
 *                        never trimmed or stretched.
 *
 * Each step writes its own primitive_runs row under the skill run; the Short is
 * the skill run's final output. A terminal failure anywhere refunds every
 * charged child (idempotent), marks the failing step and the run failed, then
 * releases the draft's render claim so the same draft can be rendered again. A
 * content-policy verdict on the product photo is never retried.
 *
 * Before step 1 the render refuses to start without every input its Preset
 * requires. Extension points (later tickets): the Music Bed and Captions join at
 * step 3 (the mix), declared per Preset on its definition.
 */

import { proxyActivities, ApplicationFailure } from '@temporalio/workflow';
import { planPresetShots, type PlannedShot, type PresetInput } from '@agentmedia/schema';
import type { PrimitiveActivities } from '../activities/index.js';
import { makeChildRunId } from './child-run-id.js';
import { failureInfo } from './failure-info.js';
import { PRODUCT_HERO_RENDER, type PresetRenderDefinition } from '../presets/index.js';

export interface MakeProductHeroWorkflowInput {
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
  aspect_ratio: '9:16';
}

/** The shared pipeline's input: a render input plus the Preset to render it as. */
export interface RenderPresetWorkflowInput extends MakeProductHeroWorkflowInput {
  preset: PresetRenderDefinition;
}

export interface MakeProductHeroWorkflowResult {
  skill_run_id: string;
  draft_id: string;
  video_url: string;
  /** The finished Short's length as MEASURED from the output file. */
  duration_ms: number;
  credits_actual_usd: number;
}

/** Where each input a Preset can require is carried on the render input. */
const PRESET_INPUT_FIELDS: Record<PresetInput, keyof MakeProductHeroWorkflowInput> = {
  product_image: 'product_image_url',
};

/** A finished cut may differ from the audio by at most about one frame. */
const MAX_CUT_DRIFT_MS = 50;

const NON_RETRYABLE = [
  'INVALID_INPUT', 'BUDGET_CAP_DAY',
  'REFERENCE_URL_NOT_ALLOWED', 'PROVIDER_UNCONFIGURED', 'INSUFFICIENT_CREDITS',
  'DRAFT_AUDIO_MISSING', 'DRAFT_STORAGE_UNCONFIGURED',
  // A moderation verdict is final; resubmitting is another paid render of a
  // photo that will be refused again.
  'EVOLINK_CONTENT_POLICY_VIOLATION',
  'EVOLINK_400', 'EVOLINK_401', 'EVOLINK_403', 'EVOLINK_404', 'EVOLINK_413', 'EVOLINK_415', 'EVOLINK_422', 'EVOLINK_451',
];

const { productHeroClip } = proxyActivities<PrimitiveActivities>({
  startToCloseTimeout: '20 minutes',
  heartbeatTimeout: '5 minutes',
  retry: { initialInterval: '10s', maximumInterval: '2m', backoffCoefficient: 2, maximumAttempts: 3, nonRetryableErrorTypes: NON_RETRYABLE },
});
const { fetchDraftAudio, muxProductHero } = proxyActivities<PrimitiveActivities>({
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '2 minutes',
  retry: { initialInterval: '5s', maximumInterval: '60s', backoffCoefficient: 2, maximumAttempts: 3, nonRetryableErrorTypes: NON_RETRYABLE },
});
const { composedSkillState } = proxyActivities<PrimitiveActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});
const { refundCredits, markPrimitiveRunFailed, releaseDraftRender } = proxyActivities<PrimitiveActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '2s', maximumInterval: '20s', backoffCoefficient: 2, maximumAttempts: 5 },
});

/** make_product_hero: the Product Hero definition on the shared pipeline. */
export async function makeProductHeroWorkflow(
  input: MakeProductHeroWorkflowInput,
): Promise<MakeProductHeroWorkflowResult> {
  return renderPresetWorkflow({ ...input, preset: PRODUCT_HERO_RENDER });
}

/** Render an approved draft as `input.preset`. Every Preset runs exactly this. */
export async function renderPresetWorkflow(
  input: RenderPresetWorkflowInput,
): Promise<MakeProductHeroWorkflowResult> {
  const { preset } = input;
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

    // ── 1. The draft's audio, first ─────────────────────────────────────────
    const audio = await fetchDraftAudio({
      primitive_run_id: mint('audio'),
      user_id: input.user_id,
      skill_run_id: skillRunId,
      draft_id: input.draft_id,
      audio_key: input.audio_key,
      duration_ms: input.duration_ms,
    });

    // ── 2. Silent clips covering the speech ─────────────────────────────────
    let shots: PlannedShot[];
    try {
      shots = planPresetShots(preset, input.duration_ms);
    } catch (err) {
      throw ApplicationFailure.nonRetryable((err as Error).message, 'INVALID_INPUT');
    }
    const clipUrls: string[] = [];
    let totalUsd = 0;
    for (let i = 0; i < shots.length; i += 1) {
      await composedSkillState({ skill_run_id: skillRunId, current_step: `clip_${i + 1}` });
      const clip = await productHeroClip({
        primitive_run_id: mint(`clip_${i}`),
        user_id: input.user_id,
        skill_run_id: skillRunId,
        product_image_url: input.product_image_url,
        duration: shots[i].seconds,
        shot_index: i,
        shot_count: shots.length,
        preset: preset.id,
        shot_kind: shots[i].kind,
        prompt: preset.shotPrompts[shots[i].kind],
        generate_audio: false,
      });
      clipUrls.push(clip.video_url);
      totalUsd += clip.credits_actual_usd;
    }

    // ── 3. Cut the visuals to the audio and mux the draft audio in ─────────
    await composedSkillState({ skill_run_id: skillRunId, current_step: 'mux' });
    const short = await muxProductHero({
      primitive_run_id: mint('mux'),
      user_id: input.user_id,
      skill_run_id: skillRunId,
      clip_urls: clipUrls,
      audio_key: audio.audio_key,
      audio_duration_ms: audio.duration_ms,
      aspect_ratio: preset.aspectRatio,
      preset: preset.id,
    });
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
