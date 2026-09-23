// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Preset × Captions (#10) — the API side.
 *
 * Captions are opt-in (off by default). Turned on, the run hands the render
 * workflow the approved draft's stored TTS alignment; the worker derives the
 * cues from it (captionCuesFromAlignment in @agentmedia/schema: the voiced
 * Script's words, Delivery Tags stripped, timed by the voice) and burns them
 * right-to-left. No speech-to-text. Captions are free: they never change the
 * price, so the quote and the charge are the same with them on or off.
 */

import type { CharacterAlignment } from '@agentmedia/schema';

/** What the quote and run responses say about Captions. */
export interface CaptionsView {
  on: boolean;
  /** One line the page and the agent can show as is. */
  detail: string;
}

export const CAPTIONS_DETAIL = {
  on: 'Right-to-left Arabic Captions of the Script are burned in, timed to the voice.',
  off: 'No Captions.',
} as const;

/** `captions` is the parsed input (default off). */
export function captionsOn(captions: unknown): boolean {
  return captions === true;
}

export function captionsView(on: boolean): CaptionsView {
  return { on, detail: on ? CAPTIONS_DETAIL.on : CAPTIONS_DETAIL.off };
}

/** The workflow's `captions` input: the draft's alignment when on, else null. */
export function captionsWorkflowInput(on: boolean, alignment: CharacterAlignment): { alignment: CharacterAlignment } | null {
  return on ? { alignment } : null;
}
