// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Preset × Captions (#10) — the API side.
 *
 * Captions are opt-in (off by default). Turned on, the run hands the render
 * workflow the approved draft's stored TTS alignment; the worker derives the
 * cues from it (captionCuesFromAlignment in @agentmedia/schema: the voiced
 * Script's words without Delivery Tags or Targeted Diacritics, line by line,
 * timed by the voice) and burns them right-to-left. No speech-to-text.
 * Captions are free: they never change the price, so the quote and the charge
 * are the same with them on or off.
 */

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

export function captionsView(on: boolean): CaptionsView {
  return { on, detail: on ? CAPTIONS_DETAIL.on : CAPTIONS_DETAIL.off };
}
