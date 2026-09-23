// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Arabic Captions burn (#10) — the last step of a Preset render, when the user
 * turned Captions on.
 *
 * The render workflow derives the cues from the draft's stored TTS alignment
 * (captionCuesFromAlignment in @agentmedia/schema: the voiced Script's words,
 * Delivery Tags stripped, timed by their characters) and hands them here. This
 * activity only draws them: no speech-to-text, so a caption can never differ
 * from the Script. (The English Whisper path, ./subtitles.ts, is separate.)
 *
 * It burns onto the finished Short (after the cut and any Music Bed): the video
 * is re-encoded frame for frame with the captions drawn right-to-left in Noto
 * Sans Arabic (../lib/arabic-captions-ass.ts), the audio copied untouched, so
 * the Short keeps its length and its sound.
 *
 * Free, like the mux and the Music Bed: Captions never change the price. The
 * download, upload and run records are shared with the Music Bed mix
 * (../lib/finished-short.ts).
 */

import { ApplicationFailure } from '@temporalio/activity';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaptionCue, PresetDefinition } from '@agentmedia/schema';
import type { WorkerConfig } from '../config.js';
import { arabicCaptionsAss, captionBurnArgs } from '../lib/arabic-captions-ass.js';
import { processFinishedShort, type FinishedShortInput, type FinishedShortResult } from '../lib/finished-short.js';

export interface BurnCaptionsInput extends FinishedShortInput {
  /** The finished Short (R2 public URL): the cut, or the cut with its Music Bed. The captioned Short keeps its length. */
  short_url: string;
  /** The cues to draw, derived from the draft alignment by the workflow. */
  cues: CaptionCue[];
  aspect_ratio: PresetDefinition['aspectRatio'];
}

export type BurnCaptionsResult = FinishedShortResult;

export function makeBurnCaptionsActivity(cfg: WorkerConfig) {
  return async function burnCaptions(input: BurnCaptionsInput): Promise<BurnCaptionsResult> {
    if (!Array.isArray(input.cues) || input.cues.length === 0) {
      throw ApplicationFailure.nonRetryable('no caption cues to burn', 'CAPTIONS_UNAVAILABLE');
    }
    return processFinishedShort(cfg, input, {
      primitiveId: 'arabic_captions',
      tag: 'captions',
      runInput: { cue_count: input.cues.length, audio_duration_ms: input.audio_duration_ms, source: 'draft_alignment' },
      metadata: { captions: { language: 'ar', direction: 'rtl', cues: input.cues.length } },
      doneStage: 'burned',
      async prepare({ workDir, shortPath, outPath }) {
        const assPath = join(workDir, 'captions.ass');
        await writeFile(assPath, arabicCaptionsAss(input.cues), 'utf8');
        return captionBurnArgs({ inPath: shortPath, assPath, outPath });
      },
    });
  };
}
