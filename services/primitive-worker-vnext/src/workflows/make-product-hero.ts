// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Composed skill workflow: make_product_hero — the Product Hero render phase.
 *
 * ADR 0001: a Short is audio-first and the video model never speaks. The render
 * takes an APPROVED draft (its audio is exactly what the user heard) and:
 *
 *   1. fetchDraftAudio — reads the draft's private audio by key and measures it.
 *                        Nothing visual is requested until the audio is in hand.
 *   2. productHeroClip — one silent clip per planned shot (generate_audio: false),
 *                        from the product photo. Shots come from the SAME plan the
 *                        quote priced (planProductHeroShots over the draft's
 *                        duration), so the charge is the quote.
 *   3. muxProductHero  — hard-cuts the clips on the 9:16 canvas, trims (or, if a
 *                        clip ran a few ms short, holds) the visuals to the audio's
 *                        exact length, and muxes the draft audio in whole. Audio is
 *                        never trimmed or stretched.
 *
 * Each step writes its own primitive_runs row under the skill run; the Short is
 * the skill run's final output. A terminal failure anywhere refunds every
 * charged child (idempotent), marks the failing step and the run failed. A
 * content-policy verdict on the product photo is never retried.
 *
 * Extension points (later tickets): the Music Bed and Captions join at step 3.
 */

import { proxyActivities, ApplicationFailure } from '@temporalio/workflow';
import { planProductHeroShots } from '@agentmedia/schema';
import type { PrimitiveActivities } from '../activities/index.js';
import { failureInfo } from './failure-info.js';

export interface MakeProductHeroWorkflowInput {
  skill_run_id: string;
  user_id: string;
  /** The approved draft being rendered (already stamped rendered_at by api-v2). */
  draft_id: string;
  /** Private storage key of the draft's audio. Server-side only. */
  audio_key: string;
  /** The draft's measured speech length; the shots are planned (and priced) from it. */
  duration_ms: number;
  /** R2-hosted, moderated product photo. */
  product_image_url: string;
  aspect_ratio: '9:16';
}

export interface MakeProductHeroWorkflowResult {
  skill_run_id: string;
  draft_id: string;
  video_url: string;
  duration_ms: number;
  credits_actual_usd: number;
}

/** A finished cut may differ from the audio by at most about one frame. */
const MAX_CUT_DRIFT_MS = 50;

const NON_RETRYABLE = [
  'INVALID_INPUT', 'BUDGET_CAP_PRESET', 'BUDGET_CAP_DAY',
  'REFERENCE_URL_NOT_ALLOWED', 'PROVIDER_UNCONFIGURED', 'INSUFFICIENT_CREDITS',
  'DRAFT_AUDIO_MISSING',
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
const { refundCredits, markPrimitiveRunFailed } = proxyActivities<PrimitiveActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '2s', maximumInterval: '20s', backoffCoefficient: 2, maximumAttempts: 5 },
});

export async function makeProductHeroWorkflow(
  input: MakeProductHeroWorkflowInput,
): Promise<MakeProductHeroWorkflowResult> {
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
    let shots: Array<5 | 10>;
    try {
      shots = planProductHeroShots(input.duration_ms);
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
        duration: shots[i],
        shot_index: i,
        shot_count: shots.length,
        run_duration_ms: input.duration_ms,
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
      aspect_ratio: '9:16',
    });
    if (Math.abs(short.duration_ms - audio.duration_ms) > MAX_CUT_DRIFT_MS) {
      throw ApplicationFailure.nonRetryable(
        `cut is ${short.duration_ms} ms but the audio is ${audio.duration_ms} ms`,
        'CUT_DURATION_MISMATCH',
      );
    }
    currentChild = undefined;

    const finalOutput = {
      video_url: short.video_url,
      duration_ms: audio.duration_ms,
      draft_id: input.draft_id,
      aspect_ratio: '9:16',
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
      duration_ms: audio.duration_ms,
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
    throw err;
  }
}

// ── deterministic helpers (isolate-safe: no crypto/Date/random) ─────────────

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic child primitive_run_id from skill_run_id + step (unique per step). */
function makeChildRunId(skillRunId: string, step: string): string {
  const suffix = (fnv1a(step).toString(16).padStart(8, '0') + '0000').slice(0, 12);
  const base = skillRunId.replace(/[^a-f0-9-]/gi, '').toLowerCase();
  return base.slice(0, base.length - 12) + suffix;
}
