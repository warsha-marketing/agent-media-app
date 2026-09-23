// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Arabic Captions burn (#10, #22) — the Captions step, shared by every burn.
 *
 * Captions are added after the render (CONTEXT.md "Captions"): a render always
 * keeps its clean Short, and the Caption export (../workflows/caption-export.ts)
 * hands this activity the user's edited lines and style. It only draws them:
 * no speech-to-text, so a caption is exactly what the user saw in the editor.
 * (The English Whisper path, ./subtitles.ts, is separate.)
 *
 * It burns onto the clean Short: the video is re-encoded frame for frame with
 * the lines drawn right-to-left in Noto Sans Arabic (../lib/arabic-captions-ass.ts,
 * where the style whitelist is mapped to ASS and every line's text goes through
 * the ASS sanitiser), the audio copied untouched, so the captioned Short keeps
 * its length and its sound. The result is a new file; the clean Short is never
 * overwritten.
 *
 * Free, like the mux and the Music Bed: Captions never cost credits. The
 * download, upload and run records are shared with the Music Bed mix
 * (../lib/finished-short.ts).
 */

import { ApplicationFailure } from '@temporalio/activity';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_CAPTION_STYLE, isCaptionStyle, type CaptionLine, type CaptionStyle, type PresetDefinition } from '@agentmedia/schema';
import type { WorkerConfig } from '../config.js';
import { arabicCaptionsAss, captionBurnArgs } from '../lib/arabic-captions-ass.js';
import { processFinishedShort, type FinishedShortInput, type FinishedShortResult } from '../lib/finished-short.js';

export interface BurnCaptionsInput extends FinishedShortInput {
  /** The clean Short (R2 public URL). The captioned Short keeps its length. */
  short_url: string;
  /** The lines to draw (text + timing), in order. */
  cues: CaptionLine[];
  /** Position, size and colour from the whitelist; #10's look when absent. */
  style?: CaptionStyle;
  aspect_ratio: PresetDefinition['aspectRatio'];
  /** The Short these Captions were made for (its render's skill run id), recorded on the new file. */
  source_short_id?: string;
}

export type BurnCaptionsResult = FinishedShortResult;

export function makeBurnCaptionsActivity(cfg: WorkerConfig) {
  return async function burnCaptions(input: BurnCaptionsInput): Promise<BurnCaptionsResult> {
    if (!Array.isArray(input.cues) || input.cues.length === 0) {
      throw ApplicationFailure.nonRetryable('no caption lines to burn', 'CAPTIONS_UNAVAILABLE');
    }
    const style = input.style ?? DEFAULT_CAPTION_STYLE;
    if (!isCaptionStyle(style)) {
      throw ApplicationFailure.nonRetryable('not an allowed caption style', 'INVALID_INPUT');
    }
    const source = input.source_short_id ? { source_short_id: input.source_short_id } : {};
    return processFinishedShort(cfg, input, {
      primitiveId: 'arabic_captions',
      tag: 'captions',
      runInput: { cue_count: input.cues.length, audio_duration_ms: input.audio_duration_ms, style, source: 'caption_editor', ...source },
      metadata: { captions: { language: 'ar', direction: 'rtl', cues: input.cues.length, style }, ...source },
      doneStage: 'burned',
      async prepare({ workDir, shortPath, outPath }) {
        const assPath = join(workDir, 'captions.ass');
        await writeFile(assPath, arabicCaptionsAss(input.cues, style), 'utf8');
        return captionBurnArgs({ inPath: shortPath, assPath, outPath });
      },
    });
  };
}
