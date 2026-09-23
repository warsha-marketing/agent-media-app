// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The Caption editor (#22), as pure functions so it is testable without a
 * browser (scripts/tests/caption-editor.test.ts).
 *
 * Captions are added after the render (CONTEXT.md "Captions"). The finished
 * Short plays with its caption lines drawn ON TOP as HTML/CSS: the browser
 * does the Arabic joining and the right-to-left layout, so what the user sees
 * is what the server burns. Editing is instant and never re-renders; the
 * browser never encodes video. "Export Short with Captions" sends only the
 * lines and the style; the server burns them onto the clean Short.
 *
 *   GET suggested lines ─► edit (text, split, merge, nudge, style) ─► export ─► poll ─► new file
 *                                     └─► .srt download (text only, right to left)
 *
 * The limits, the style whitelist and the checks mirror @agentmedia/schema
 * (caption-lines.ts) and the burn's placement mirrors the worker's ASS style
 * (arabic-captions-ass.ts); scripts/tests/caption-editor-parity.test.ts holds
 * them equal. No imports: scripts/tests loads this file directly.
 */

// ── The contract (mirrors @agentmedia/schema caption-lines.ts) ──────────────

export const CAPTION_POSITIONS = ['lower_third', 'centre', 'top'] as const;
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];
export const CAPTION_SIZES = ['s', 'm', 'l'] as const;
export type CaptionSize = (typeof CAPTION_SIZES)[number];
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

export const DEFAULT_STYLE: Readonly<CaptionStyle> = { position: 'lower_third', size: 'm', colour: 'white' };

export const CAPTION_LIMITS = { maxLines: 60, maxChars: 48, minSeconds: 0.2 } as const;

/** Labels for the style pickers. */
export const POSITION_LABELS: Record<CaptionPosition, string> = { lower_third: 'Lower third', centre: 'Centre', top: 'Top' };
export const SIZE_LABELS: Record<CaptionSize, string> = { s: 'S', m: 'M', l: 'L' };

export interface CaptionLine {
  text: string;
  start: number;
  end: number;
}

/** A line in the editor: a stable id for the list, plus the line. */
export interface EditorLine extends CaptionLine {
  id: string;
}

export function withIds(lines: readonly CaptionLine[]): EditorLine[] {
  return lines.map((l, i) => ({ id: `l${i}`, text: l.text, start: l.start, end: l.end }));
}

const round3 = (s: number) => Math.round(s * 1000) / 1000;

// Controls and bidi embeddings/overrides/isolates: dropped (a line is always right to left).
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

/** The text as it will be shown and burned. Mirrors normaliseCaptionText. */
export function normaliseText(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Editing ─────────────────────────────────────────────────────────────────

/**
 * Split line `i` in two at a space: the one nearest the caret (`at`, a char
 * offset into the text) or, without one, the one nearest the middle. Each half
 * keeps its words' share of the letters of the line's time. A one-word line,
 * or one too short to leave both halves readable, comes back unchanged.
 */
export function splitLine(lines: readonly EditorLine[], i: number, at?: number): EditorLine[] {
  const line = lines[i];
  if (!line) return lines as EditorLine[];
  const text = normaliseText(line.text);
  const spaces = [...text.matchAll(/ /g)].map((m) => m.index ?? 0);
  if (spaces.length === 0) return lines as EditorLine[];
  const target = typeof at === 'number' && Number.isFinite(at) ? at : text.length / 2;
  const cut = spaces.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best), spaces[0]);
  const left = text.slice(0, cut);
  const right = text.slice(cut + 1);
  const letters = left.length + right.length;
  const mid = round3(line.start + (line.end - line.start) * (left.length / letters));
  if (mid - line.start < CAPTION_LIMITS.minSeconds || line.end - mid < CAPTION_LIMITS.minSeconds) return lines as EditorLine[];
  const out = lines.slice();
  out.splice(i, 1, { id: `${line.id}a`, text: left, start: line.start, end: mid }, { id: `${line.id}b`, text: right, start: mid, end: line.end });
  return out;
}

/** Join line `i` with the next: its words then the next's, from its start to the next's end. */
export function mergeWithNext(lines: readonly EditorLine[], i: number): EditorLine[] {
  const a = lines[i];
  const b = lines[i + 1];
  if (!a || !b) return lines as EditorLine[];
  const out = lines.slice();
  out.splice(i, 2, { id: a.id, text: normaliseText(`${a.text} ${b.text}`), start: a.start, end: b.end });
  return out;
}

/**
 * Move one edge of line `i` by `delta` seconds, held between its neighbours
 * (no overlap), inside the Short, and at least CAPTION_LIMITS.minSeconds long.
 */
export function nudge(lines: readonly EditorLine[], i: number, edge: 'start' | 'end', delta: number, durationSeconds: number): EditorLine[] {
  const line = lines[i];
  if (!line) return lines as EditorLine[];
  const prevEnd = lines[i - 1]?.end ?? 0;
  const nextStart = lines[i + 1]?.start ?? durationSeconds;
  const out = lines.slice();
  if (edge === 'start') {
    const lo = Math.max(0, prevEnd);
    const hi = line.end - CAPTION_LIMITS.minSeconds;
    out[i] = { ...line, start: round3(Math.min(hi, Math.max(lo, line.start + delta))) };
  } else {
    const lo = line.start + CAPTION_LIMITS.minSeconds;
    const hi = Math.min(durationSeconds, nextStart);
    out[i] = { ...line, end: round3(Math.max(lo, Math.min(hi, line.end + delta))) };
  }
  return out;
}

export function setText(lines: readonly EditorLine[], i: number, text: string): EditorLine[] {
  if (!lines[i]) return lines as EditorLine[];
  const out = lines.slice();
  out[i] = { ...lines[i], text };
  return out;
}

export function removeLine(lines: readonly EditorLine[], i: number): EditorLine[] {
  return lines.filter((_, j) => j !== i);
}

// ── Checks (mirror validateCaptionLines; the server answers with the same codes) ─

export type IssueCode =
  | 'no_lines'
  | 'too_many_lines'
  | 'empty_text'
  | 'text_too_long'
  | 'invalid_timing'
  | 'line_too_short'
  | 'outside_short'
  | 'out_of_order'
  | 'overlap';

export interface LineIssue {
  code: IssueCode;
  line: number | null;
  message: string;
}

const fmt = (s: number) => `${Math.round(s * 100) / 100} s`;

export function validateLines(lines: readonly CaptionLine[], durationSeconds: number): LineIssue[] {
  const issues: LineIssue[] = [];
  const add = (code: IssueCode, line: number | null, message: string) => issues.push({ code, line, message });
  if (lines.length === 0) {
    add('no_lines', null, 'Add at least one caption line.');
    return issues;
  }
  if (lines.length > CAPTION_LIMITS.maxLines) add('too_many_lines', null, `At most ${CAPTION_LIMITS.maxLines} caption lines; merge some lines.`);
  let prev: { start: number; end: number } | null = null;
  lines.forEach((l, i) => {
    const n = i + 1;
    const text = normaliseText(typeof l.text === 'string' ? l.text : '');
    if (text === '') add('empty_text', i, `Line ${n} has no text; type its words or merge it away.`);
    else if ([...text].length > CAPTION_LIMITS.maxChars) add('text_too_long', i, `Line ${n} is longer than ${CAPTION_LIMITS.maxChars} characters; split it.`);
    const { start, end } = l;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      add('invalid_timing', i, `Line ${n} must end after it starts.`);
      prev = null;
      return;
    }
    if (start < 0 || end > durationSeconds + 0.001) add('outside_short', i, `Line ${n} must stay within the Short (0–${fmt(durationSeconds)}).`);
    else if (end - start < CAPTION_LIMITS.minSeconds - 1e-9) add('line_too_short', i, `Line ${n} must stay on screen at least ${fmt(CAPTION_LIMITS.minSeconds)}.`);
    if (prev) {
      if (start < prev.start) add('out_of_order', i, `Line ${n} starts before line ${i}; keep lines in order.`);
      else if (start < prev.end - 1e-9) add('overlap', i, `Line ${n} starts before line ${i} ends; move one of them.`);
    }
    prev = { start, end };
  });
  return issues;
}

// ── Preview ─────────────────────────────────────────────────────────────────

/** The line on screen at `t` seconds (start inclusive, end exclusive), or -1. */
export function lineAt(lines: readonly CaptionLine[], t: number): number {
  return lines.findIndex((l) => t >= l.start && t < l.end);
}

/** The burn's canvas and placement (the worker's ASS style), for the overlay. */
const CANVAS = { x: 1080, y: 1920 };
const SIZE_PX: Record<CaptionSize, number> = { s: 72, m: 96, l: 120 };
const LOWER_THIRD_MARGIN_PX = 560;
const TOP_MARGIN_PX = 300;
const SIDE_MARGIN_PX = 130;
/** The burn's outline and shadow (px on the canvas). */
export const OUTLINE_PX = 6;
export const SHADOW_PX = 2;

export interface OverlayStyle {
  /** Font size in container-height units (cqh) of the 9:16 player. */
  fontSizeCqh: number;
  /** Outline width in cqh. */
  outlineCqh: number;
  /** Distance from the bottom edge to the line block (lower third), else null. */
  bottomPct: number | null;
  /** Distance from the top edge (top), else null. */
  topPct: number | null;
  /** Vertically centred (centre). */
  centred: boolean;
  /** Left and right margins, % of the width. */
  sidePct: number;
  color: string;
}

/** Where and how the overlay draws a line in `style`: the same numbers the burn uses, as fractions of the frame. */
export function overlayStyle(style: CaptionStyle): OverlayStyle {
  const pctY = (px: number) => (px / CANVAS.y) * 100;
  return {
    fontSizeCqh: pctY(SIZE_PX[style.size]),
    outlineCqh: pctY(OUTLINE_PX),
    bottomPct: style.position === 'lower_third' ? pctY(LOWER_THIRD_MARGIN_PX) : null,
    topPct: style.position === 'top' ? pctY(TOP_MARGIN_PX) : null,
    centred: style.position === 'centre',
    sidePct: (SIDE_MARGIN_PX / CANVAS.x) * 100,
    color: CAPTION_COLOURS[style.colour],
  };
}

// ── .srt ────────────────────────────────────────────────────────────────────

/** U+200F RIGHT-TO-LEFT MARK: makes each cue right to left in players that guess direction from the first strong character. */
const RLM = '\u200F';

/** Seconds → SRT time `HH:MM:SS,mmm`, rounded to the millisecond with the carry done on the whole value. */
export function srtTime(seconds: number): string {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

/** The lines as an .srt file (CapCut, Premiere, a platform's caption track): numbered from 1, each line right to left. */
export function toSrt(lines: readonly CaptionLine[]): string {
  return lines
    .map((l) => ({ ...l, text: normaliseText(l.text) }))
    .filter((l) => l.text !== '' && l.end > l.start)
    .map((l, i) => `${i + 1}\n${srtTime(l.start)} --> ${srtTime(l.end)}\n${RLM}${l.text}\n`)
    .join('\n');
}

// ── The export ──────────────────────────────────────────────────────────────

export interface ExportBody {
  lines: CaptionLine[];
  style: CaptionStyle;
}

/** POST /v1/shorts/:id/caption-exports: only the lines (text + timing) and the style. */
export function exportBody(lines: readonly CaptionLine[], style: CaptionStyle): ExportBody {
  return {
    lines: lines.map(({ text, start, end }) => ({ text, start, end })),
    style: { position: style.position, size: style.size, colour: style.colour },
  };
}

export interface ExportKey {
  body: string;
  key: string;
}

/**
 * The Idempotency-Key for exporting `body`: the previous one when the request
 * is the same (a double click or a retry replays instead of making a second
 * file), a fresh one for any edit (the server refuses a reused key with a
 * different body).
 */
export function exportKeyFor(prev: ExportKey | null, body: ExportBody, freshKey: string): ExportKey {
  const s = JSON.stringify(body);
  return prev && prev.body === s ? prev : { body: s, key: freshKey };
}

export type ExportView = { kind: 'running' } | { kind: 'succeeded'; videoUrl: string } | { kind: 'failed'; message: string };

/** An export run (GET /v1/skills/runs/:id) as the editor shows it. */
export function exportViewOf(run: { status?: string; final_output?: Record<string, unknown> | null; error?: { code?: string | null; message?: string | null } | null }): ExportView {
  if (run.status === 'succeeded') {
    const url = run.final_output?.video_url;
    return typeof url === 'string' ? { kind: 'succeeded', videoUrl: url } : { kind: 'failed', message: 'The export finished without a video.' };
  }
  if (run.status === 'failed' || run.status === 'canceled') {
    return { kind: 'failed', message: run.error?.message || 'The export failed.' };
  }
  return { kind: 'running' };
}

// ── Reading the API ─────────────────────────────────────────────────────────

export interface Suggested {
  videoUrl: string;
  durationSeconds: number;
  lines: EditorLine[];
  style: CaptionStyle;
}

const isStyle = (v: unknown): v is CaptionStyle => {
  const s = v as Record<string, unknown> | null;
  return (
    !!s &&
    (CAPTION_POSITIONS as readonly unknown[]).includes(s.position) &&
    (CAPTION_SIZES as readonly unknown[]).includes(s.size) &&
    typeof s.colour === 'string' &&
    Object.hasOwn(CAPTION_COLOURS, s.colour)
  );
};

/** GET /v1/shorts/:id/captions → the editor's starting point, or null. */
export function parseSuggested(body: unknown): Suggested | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.video_url !== 'string' || typeof b.duration_ms !== 'number' || !Array.isArray(b.lines)) return null;
  const lines = (b.lines as unknown[]).filter(
    (l): l is CaptionLine =>
      !!l && typeof (l as CaptionLine).text === 'string' && typeof (l as CaptionLine).start === 'number' && typeof (l as CaptionLine).end === 'number',
  );
  return {
    videoUrl: b.video_url,
    durationSeconds: b.duration_ms / 1000,
    lines: withIds(lines),
    style: isStyle(b.style) ? { ...b.style } : { ...DEFAULT_STYLE },
  };
}
