// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * caption_export (#22) — burn the Caption editor's lines onto a clean Short.
 *
 * Captions are a finishing step after the render (CONTEXT.md "Captions"): a
 * Preset render always keeps its clean Short, the user edits the suggested
 * lines in the browser (a live HTML/CSS preview; the browser never encodes
 * video), and "Export Short with Captions" starts this workflow with the lines
 * and a whitelisted style. It:
 *
 *   1. re-checks the request (@agentmedia/schema validateCaptionLines and the
 *      style whitelist; api-v2 already refused a bad one with actionable codes),
 *   2. burns the lines with the shared Captions step (burnCaptions: ffmpeg,
 *      libass, Noto Sans Arabic, text through the ASS sanitiser, audio copied),
 *   3. checks the captioned file is as long as the clean Short, and records it
 *      as this run's output — a new file, linked to the Short by `short_id`.
 *
 * Free: no provider is called and nothing is charged, so there is nothing to
 * refund. A failure is recorded on the step and on the run. Every export is its
 * own run (and file); the clean Short is never touched.
 */

import { proxyActivities, ApplicationFailure } from '@temporalio/workflow';
import {
  isCaptionStyle,
  normaliseCaptionText,
  validateCaptionLines,
  type CaptionLine,
  type CaptionStyle,
  type PresetDefinition,
} from '@agentmedia/schema';
import type { PrimitiveActivities } from '../activities/index.js';
import { makeChildRunId } from './child-run-id.js';
import { failureInfo } from './failure-info.js';

export interface CaptionExportInput {
  /** This export's skill run (skill_slug caption_export). */
  skill_run_id: string;
  user_id: string;
  /** The Short being captioned: its render's skill run id. */
  short_id: string;
  /** The clean Short (R2 public URL), resolved by api-v2 from the render. */
  short_url: string;
  /** The clean Short's measured length; the lines must sit inside it. */
  duration_ms: number;
  /** The voice's length, recorded on the new file. */
  audio_duration_ms: number;
  /** The Preset the Short was rendered as, recorded on the new file. */
  preset: string;
  aspect_ratio: PresetDefinition['aspectRatio'];
  lines: CaptionLine[];
  style: CaptionStyle;
}

export interface CaptionExportResult {
  skill_run_id: string;
  short_id: string;
  video_url: string;
  duration_ms: number;
}

/** The captioned file may differ from the clean Short by at most about one frame. */
const MAX_DRIFT_MS = 50;

const { burnCaptions } = proxyActivities<PrimitiveActivities>({
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '2 minutes',
  retry: {
    initialInterval: '5s',
    maximumInterval: '60s',
    backoffCoefficient: 2,
    maximumAttempts: 3,
    nonRetryableErrorTypes: ['INVALID_INPUT', 'CAPTIONS_UNAVAILABLE', 'REFERENCE_URL_NOT_ALLOWED'],
  },
});
const { composedSkillState, markPrimitiveRunFailed } = proxyActivities<PrimitiveActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '2s', maximumInterval: '20s', backoffCoefficient: 2, maximumAttempts: 5 },
});

export async function captionExportWorkflow(input: CaptionExportInput): Promise<CaptionExportResult> {
  const skillRunId = input.skill_run_id;
  let child: string | undefined;
  await composedSkillState({ skill_run_id: skillRunId, status: 'running', current_step: 'captions', started_at_now: true });
  try {
    // ── 1. The request, re-checked ──────────────────────────────────────────
    const lines = (Array.isArray(input.lines) ? input.lines : []).map((l) => ({
      text: normaliseCaptionText(String(l?.text ?? '')),
      start: Number(l?.start),
      end: Number(l?.end),
    }));
    const issues = validateCaptionLines(lines, input.duration_ms / 1000);
    if (issues.length) {
      throw ApplicationFailure.nonRetryable(issues.map((i) => `${i.code}: ${i.message}`).join(' '), 'INVALID_INPUT');
    }
    if (!isCaptionStyle(input.style)) {
      throw ApplicationFailure.nonRetryable('not an allowed caption style', 'INVALID_INPUT');
    }

    // ── 2. Burn the lines onto the clean Short (the shared Captions step) ────
    child = makeChildRunId(skillRunId, 'captions');
    const captioned = await burnCaptions({
      primitive_run_id: child,
      user_id: input.user_id,
      skill_run_id: skillRunId,
      short_url: input.short_url,
      cues: lines,
      style: input.style,
      audio_duration_ms: input.audio_duration_ms,
      preset: input.preset,
      aspect_ratio: input.aspect_ratio,
      source_short_id: input.short_id,
    });

    // ── 3. Same length as the clean Short, then record it ──────────────────
    if (Math.abs(captioned.duration_ms - input.duration_ms) > MAX_DRIFT_MS) {
      throw ApplicationFailure.nonRetryable(
        `the captioned Short is ${captioned.duration_ms} ms but the clean Short is ${input.duration_ms} ms`,
        'CUT_DURATION_MISMATCH',
      );
    }
    const done = child;
    child = undefined;
    await composedSkillState({
      skill_run_id: skillRunId,
      status: 'succeeded',
      current_step: 'done',
      finished_at_now: true,
      final_output: {
        video_url: captioned.video_url,
        duration_ms: captioned.duration_ms,
        short_id: input.short_id,
        caption_lines: lines.length,
        style: input.style,
        primitive_run_id: done,
      },
    });
    return { skill_run_id: skillRunId, short_id: input.short_id, video_url: captioned.video_url, duration_ms: captioned.duration_ms };
  } catch (err) {
    const f = failureInfo(err);
    const code = err instanceof ApplicationFailure && err.type ? err.type : f.code;
    const message = err instanceof ApplicationFailure ? err.message.slice(0, 500) : f.message;
    if (child) await markPrimitiveRunFailed({ primitive_run_id: child, error_code: code, error_message: message });
    await composedSkillState({ skill_run_id: skillRunId, status: 'failed', finished_at_now: true, error_code: code, error_message: message });
    throw err;
  }
}
