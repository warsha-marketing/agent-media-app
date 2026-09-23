// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Edited caption lines (#22) — what the Caption editor sends to be burned.
 *
 * Captions are added AFTER the render (CONTEXT.md "Captions"): every render
 * keeps a clean Short, the Caption editor starts from the suggested lines (the
 * draft alignment cut by #10's cue rules, ./captions.ts), and the user edits
 * the words, the timing and the style. Export burns exactly those lines onto
 * the clean Short on the server.
 *
 * This module is the one contract both server sides check: the export route
 * (api-v2) refuses a bad request with actionable codes, and the export workflow
 * (worker) re-checks before it burns. The web editor mirrors the limits, the
 * style whitelist and the checks (apps/web/lib/caption-editor.ts, held equal by
 * scripts/tests/caption-editor-parity.test.ts).
 *
 * Pure and deterministic: it runs inside the Temporal workflow sandbox.
 */

import { captionCuesFromAlignment } from './captions.js';
import type { CharacterAlignment } from './delivery-tags.js';

/** One caption line as shown: its text and when it is on screen (seconds from the Short's start). */
export interface CaptionLine {
  text: string;
  start: number;
  end: number;
}

/** Where a line sits on the 9:16 frame. */
export const CAPTION_POSITIONS = ['lower_third', 'centre', 'top'] as const;
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];

/** Text size: small, medium (the #10 default) or large. */
export const CAPTION_SIZES = ['s', 'm', 'l'] as const;
export type CaptionSize = (typeof CAPTION_SIZES)[number];

/** The palette (fill colour; the outline is always black). Upper-case #RRGGBB. */
export const CAPTION_COLOURS = {
  white: '#FFFFFF',
  yellow: '#FFD60A',
  mint: '#5EEAD4',
  pink: '#F9A8D4',
} as const;
export type CaptionColour = keyof typeof CAPTION_COLOURS;

export interface CaptionStyle {
  position: CaptionPosition;
  size: CaptionSize;
  colour: CaptionColour;
}

/** #10's look: white, medium, in the lower third. */
export const DEFAULT_CAPTION_STYLE: Readonly<CaptionStyle> = { position: 'lower_third', size: 'm', colour: 'white' };

/** What one export may carry. */
export const CAPTION_LINE_LIMITS = {
  /** Most lines on one Short (a 15 s Short cut by the #10 rules has about 10). */
  maxLines: 60,
  /** Most characters on one line, as shown (two suggested lines merged still fit). */
  maxChars: 48,
  /** A line stays on screen at least this long. */
  minSeconds: 0.2,
} as const;

/** Float slack at the Short's end (the player reports times like 9.0000001). */
const END_SLACK_SECONDS = 0.001;

/** Why a set of lines is refused; `line` is the 0-based index, or null for the whole set. */
export type CaptionLineIssueCode =
  | 'no_lines'
  | 'too_many_lines'
  | 'empty_text'
  | 'text_too_long'
  | 'invalid_timing'
  | 'line_too_short'
  | 'outside_short'
  | 'out_of_order'
  | 'overlap';

export interface CaptionLineIssue {
  code: CaptionLineIssueCode;
  line: number | null;
  message: string;
}

// C0/C1 controls and the bidi embeddings, overrides and isolates: a line is
// always right to left (the burn adds its own RLM), and none of these belongs
// in a caption.
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

/** A line's text as it will be shown: controls and bidi overrides dropped, whitespace folded to single spaces, trimmed. */
export function normaliseCaptionText(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The suggested lines for a Short: its draft's alignment cut by #10's cue rules (no Delivery Tags, no diacritics, line by line). */
export function suggestedCaptionLines(alignment: CharacterAlignment, durationSeconds: number): CaptionLine[] {
  return captionCuesFromAlignment(alignment, { durationSeconds }).map(({ text, start, end }) => ({ text, start, end }));
}

const fmt = (s: number) => `${Math.round(s * 100) / 100} s`;

/**
 * Every reason `lines` cannot be burned onto a Short `durationSeconds` long;
 * empty when they can. Lines must be in order, must not overlap, and must sit
 * inside the Short. Texts are checked as normaliseCaptionText leaves them.
 */
export function validateCaptionLines(lines: readonly CaptionLine[], durationSeconds: number): CaptionLineIssue[] {
  const issues: CaptionLineIssue[] = [];
  const add = (code: CaptionLineIssueCode, line: number | null, message: string) => issues.push({ code, line, message });
  if (lines.length === 0) {
    add('no_lines', null, 'Add at least one caption line.');
    return issues;
  }
  if (lines.length > CAPTION_LINE_LIMITS.maxLines) {
    add('too_many_lines', null, `At most ${CAPTION_LINE_LIMITS.maxLines} caption lines; merge some lines.`);
  }
  let prev: { start: number; end: number } | null = null;
  lines.forEach((l, i) => {
    const n = i + 1;
    const text = normaliseCaptionText(typeof l.text === 'string' ? l.text : '');
    if (text === '') add('empty_text', i, `Line ${n} has no text; type its words or merge it away.`);
    else if ([...text].length > CAPTION_LINE_LIMITS.maxChars) {
      add('text_too_long', i, `Line ${n} is longer than ${CAPTION_LINE_LIMITS.maxChars} characters; split it.`);
    }

    const { start, end } = l;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      add('invalid_timing', i, `Line ${n} must end after it starts.`);
      prev = null;
      return;
    }
    if (start < 0 || end > durationSeconds + END_SLACK_SECONDS) {
      add('outside_short', i, `Line ${n} must stay within the Short (0–${fmt(durationSeconds)}).`);
    } else if (end - start < CAPTION_LINE_LIMITS.minSeconds - 1e-9) {
      add('line_too_short', i, `Line ${n} must stay on screen at least ${fmt(CAPTION_LINE_LIMITS.minSeconds)}.`);
    }
    if (prev) {
      if (start < prev.start) add('out_of_order', i, `Line ${n} starts before line ${i}; keep lines in order.`);
      else if (start < prev.end - 1e-9) add('overlap', i, `Line ${n} starts before line ${i} ends; move one of them.`);
    }
    prev = { start, end };
  });
  return issues;
}

/** Whether `v` is exactly a style on the whitelist (no other fields). */
export function isCaptionStyle(v: unknown): v is CaptionStyle {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const s = v as Record<string, unknown>;
  const keys = Object.keys(s).sort().join(',');
  return (
    keys === 'colour,position,size' &&
    (CAPTION_POSITIONS as readonly unknown[]).includes(s.position) &&
    (CAPTION_SIZES as readonly unknown[]).includes(s.size) &&
    typeof s.colour === 'string' &&
    Object.hasOwn(CAPTION_COLOURS, s.colour)
  );
}
