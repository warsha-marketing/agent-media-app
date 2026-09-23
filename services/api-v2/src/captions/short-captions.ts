// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Captions after the render (#22, CONTEXT.md "Captions").
 *
 * A Preset render stores a clean Short; Captions are added afterwards:
 *
 *   GET  /v1/shorts/:id/captions         the suggested caption lines for a
 *                                        finished Short (its draft's alignment
 *                                        cut by #10's cue rules), the clean
 *                                        Short, and the style whitelist.
 *   POST /v1/shorts/:id/caption-exports  burn the user's edited lines + style
 *                                        onto the clean Short: a new file.
 *
 * A Short is identified by the skill run that rendered it (a Preset render,
 * e.g. make_product_hero). Only its owner can read or export it: anyone else's
 * Short is indistinguishable from none (404).
 *
 * An export is a run like any other (ARCHITECTURE.md, Credits & spend safety):
 * a skill_runs row (skill_slug `caption_export`), polled at
 * GET /v1/skills/runs/:id, with an Idempotency-Key bound to the request body
 * (request_fingerprint): a replay returns the original export, a different
 * body under the same key is refused. It is free: no provider is called (ffmpeg
 * and libass on the worker), so nothing is quoted, reserved or charged.
 *
 * The request is checked here with @agentmedia/schema's caption-lines contract
 * (line count and length, order, overlap, timing within the Short, the style
 * whitelist) and refused with actionable codes; the worker re-checks, and the
 * burn puts every line's text through the ASS sanitiser.
 *
 * Every dependency is injected (ShortCaptionDeps), so the route tests run on fakes.
 */

import {
  CAPTION_COLOURS,
  CAPTION_LINE_LIMITS,
  CAPTION_POSITIONS,
  CAPTION_SIZES,
  DEFAULT_CAPTION_STYLE,
  isCaptionStyle,
  normaliseCaptionText,
  suggestedCaptionLines,
  validateCaptionLines,
  type CaptionLine,
  type CaptionLineIssue,
  type CaptionStyle,
  type CharacterAlignment,
} from '@agentmedia/schema';
import { z } from 'zod';
import { getSkill } from '../skills/registry.js';

/** The skill_runs.skill_slug of a Caption export; also its workflow id prefix. */
export const CAPTION_EXPORT_SLUG = 'caption_export';
/** The worker's registered workflow type (services/primitive-worker-vnext/src/workflows/caption-export.ts). */
export const CAPTION_EXPORT_WORKFLOW = 'captionExportWorkflow';

// ── Seams ────────────────────────────────────────────────────────────────────

/** A skill run as the Short lookups read it. */
export interface ShortRun {
  id: string;
  user_id: string;
  skill_slug: string;
  status: string;
  input: Record<string, unknown> | null;
  final_output: Record<string, unknown> | null;
}

/** One step of a render, with the files it produced (only read for renders made before #22). */
export interface ShortStep {
  primitive_id: string;
  status: string;
  artifacts: Array<{ kind: string; url: string }>;
}

/** An export run found by its Idempotency-Key. */
export interface StoredExport {
  id: string;
  status: string;
  input: Record<string, unknown> | null;
  request_fingerprint: string | null;
}

/** What the worker's captionExportWorkflow is started with. */
export interface CaptionExportWorkflowInput {
  skill_run_id: string;
  user_id: string;
  short_id: string;
  short_url: string;
  duration_ms: number;
  audio_duration_ms: number;
  preset: string;
  aspect_ratio: string;
  lines: CaptionLine[];
  style: CaptionStyle;
}

/** Thrown by startExport when this server has no Temporal configured (503). */
export class ExportUnconfiguredError extends Error {}

export interface ShortCaptionDeps {
  /** The run only if `userId` owns it; null otherwise. */
  getRun(id: string, userId: string): Promise<ShortRun | null>;
  /** A render's steps, oldest first. */
  getSteps(runId: string): Promise<ShortStep[]>;
  /** The draft's stored TTS alignment, only if `userId` owns the draft. */
  getDraftAlignment(draftId: string, userId: string): Promise<CharacterAlignment | null>;
  exports: {
    findByKey(userId: string, key: string): Promise<StoredExport | null>;
    /** Insert a submitted export run; 'conflict' when the (user, slug, key) index already holds one. */
    insert(row: { user_id: string; input: Record<string, unknown>; idempotency_key: string | null; request_fingerprint: string | null }): Promise<{ id: string } | 'conflict'>;
    fail(id: string, code: string, message: string): Promise<void>;
  };
  /** Start the export workflow; throws ExportUnconfiguredError without Temporal. */
  startExport(workflowId: string, input: CaptionExportWorkflowInput): Promise<void>;
}

// ── Refusals ─────────────────────────────────────────────────────────────────

/** Every refusal the two routes answer with, by code: the table the OpenAPI entry reads. */
export const SHORT_CAPTION_REFUSALS = {
  not_found: { status: 404, when: 'no such Short on this account (someone else’s Short is indistinguishable from none)' },
  short_not_ready: { status: 409, when: 'the render has not finished (or did not succeed); Captions are added to a finished Short' },
  clean_short_unavailable: { status: 422, when: 'the clean Short of this render cannot be found' },
  captions_unavailable: { status: 422, when: "the Short's draft has no voiced words to suggest caption lines from" },
  invalid_caption_lines: {
    status: 422,
    when:
      'the lines or style cannot be burned; `issues` lists each problem ({ code, line, message }) with code no_lines, too_many_lines, empty_text, text_too_long, invalid_timing, line_too_short, outside_short, out_of_order, overlap or style_not_allowed',
  },
} as const;
export type ShortCaptionRefusalCode = keyof typeof SHORT_CAPTION_REFUSALS;

export class ShortCaptionError extends Error {
  readonly status: number;
  constructor(
    readonly code: ShortCaptionRefusalCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.status = SHORT_CAPTION_REFUSALS[code].status;
  }
}

// ── The finished Short ───────────────────────────────────────────────────────

export interface FinishedShort {
  id: string;
  preset: string;
  aspect_ratio: string;
  draft_id: string | null;
  /** The clean Short: no Captions burned in. */
  clean_url: string;
  duration_ms: number;
  audio_duration_ms: number;
}

/** The steps whose file is a clean Short, most finished first (the Music Bed mix is the cut plus its bed). */
const CLEAN_STEPS = ['music_bed_mix', 'product_hero_mux'];

/**
 * The clean Short of a render. Since #22 a render's output IS the clean Short.
 * A render made with #10's Captions toggle on stored the captioned file as its
 * output (final_output.captions === true); its clean Short is the file of the
 * step before the burn.
 */
export function cleanShortUrl(finalOutput: Record<string, unknown>, steps: readonly ShortStep[]): string | null {
  if (finalOutput.captions !== true) return typeof finalOutput.video_url === 'string' ? finalOutput.video_url : null;
  for (const id of CLEAN_STEPS) {
    const step = steps.find((s) => s.primitive_id === id && s.status === 'succeeded');
    const file = step?.artifacts.find((a) => a.kind === 'short' && typeof a.url === 'string');
    if (file) return file.url;
  }
  return null;
}

const notFound = () => new ShortCaptionError('not_found', 'No such Short on this account.');

/** The caller's finished Short `shortId`, or the refusal to send. */
export async function resolveFinishedShort(deps: ShortCaptionDeps, userId: string, shortId: string): Promise<FinishedShort> {
  const run = await deps.getRun(shortId, userId);
  if (!run || run.user_id !== userId) throw notFound();
  const preset = getSkill(run.skill_slug)?.preset;
  if (!preset) throw notFound(); // only a Preset render is a Short
  const out = run.final_output ?? {};
  const durationMs = Number(out.duration_ms);
  if (run.status !== 'succeeded' || typeof out.video_url !== 'string' || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new ShortCaptionError('short_not_ready', 'This Short is not finished yet. Add Captions once its render has succeeded.', { status: run.status });
  }
  const clean = cleanShortUrl(out, out.captions === true ? await deps.getSteps(run.id) : []);
  if (!clean) throw new ShortCaptionError('clean_short_unavailable', 'The clean version of this Short cannot be found.');
  const audioMs = Number(out.audio_duration_ms);
  const draftId = (run.input?.draft_id ?? out.draft_id) as unknown;
  return {
    id: run.id,
    preset: preset.id,
    aspect_ratio: preset.aspectRatio,
    draft_id: typeof draftId === 'string' ? draftId : null,
    clean_url: clean,
    duration_ms: durationMs,
    audio_duration_ms: Number.isFinite(audioMs) && audioMs > 0 ? audioMs : durationMs,
  };
}

// ── GET suggested lines ──────────────────────────────────────────────────────

/** The style whitelist and limits, as the editor needs them. */
export const CAPTION_EDITOR_OPTIONS = {
  positions: [...CAPTION_POSITIONS],
  sizes: [...CAPTION_SIZES],
  colours: { ...CAPTION_COLOURS },
  limits: { ...CAPTION_LINE_LIMITS },
};

export interface SuggestedCaptions {
  short_id: string;
  /** The clean Short, to preview the lines over. */
  video_url: string;
  duration_ms: number;
  lines: CaptionLine[];
  style: CaptionStyle;
  options: typeof CAPTION_EDITOR_OPTIONS;
}

export async function suggestedCaptions(deps: ShortCaptionDeps, userId: string, shortId: string): Promise<SuggestedCaptions> {
  const short = await resolveFinishedShort(deps, userId, shortId);
  const alignment = short.draft_id ? await deps.getDraftAlignment(short.draft_id, userId) : null;
  let lines: CaptionLine[] = [];
  try {
    if (alignment) lines = suggestedCaptionLines(alignment, short.duration_ms / 1000);
  } catch {
    lines = []; // a malformed alignment has nothing to suggest
  }
  if (lines.length === 0) {
    throw new ShortCaptionError('captions_unavailable', "This Short's draft has no voiced words to suggest caption lines from.");
  }
  return {
    short_id: short.id,
    video_url: short.clean_url,
    duration_ms: short.duration_ms,
    lines,
    style: { ...DEFAULT_CAPTION_STYLE },
    options: CAPTION_EDITOR_OPTIONS,
  };
}

// ── POST an export ───────────────────────────────────────────────────────────

/**
 * The export body's SHAPE (400 when wrong). Values are checked afterwards by
 * checkExportRequest, so a bad line or a style off the whitelist is a 422 with
 * actionable codes rather than a zod dump. The bounds here only cap the payload.
 */
export const CaptionExportBodySchema = z
  .object({
    lines: z
      .array(z.object({ text: z.string().max(1000), start: z.number(), end: z.number() }).strict())
      .max(1000)
      .describe('The caption lines to burn, in order: { text, start, end } in seconds from the Short’s start.'),
    style: z
      .object({ position: z.string().max(40), size: z.string().max(40), colour: z.string().max(40) })
      .strict()
      .default({ ...DEFAULT_CAPTION_STYLE })
      .describe(`Position (${CAPTION_POSITIONS.join(', ')}), size (${CAPTION_SIZES.join(', ')}) and colour (${Object.keys(CAPTION_COLOURS).join(', ')}).`),
  })
  .strict();
export type CaptionExportBody = z.infer<typeof CaptionExportBodySchema>;

export type ExportIssue = CaptionLineIssue | { code: 'style_not_allowed'; line: null; message: string };

/** The lines as they will be burned (texts normalised) and the style, or the invalid_caption_lines refusal. */
export function checkExportRequest(body: CaptionExportBody, durationMs: number): { lines: CaptionLine[]; style: CaptionStyle } {
  const lines = body.lines.map((l) => ({ text: normaliseCaptionText(l.text), start: l.start, end: l.end }));
  const issues: ExportIssue[] = validateCaptionLines(lines, durationMs / 1000);
  if (!isCaptionStyle(body.style)) {
    issues.push({
      code: 'style_not_allowed',
      line: null,
      message: `Choose a position (${CAPTION_POSITIONS.join(', ')}), a size (${CAPTION_SIZES.join(', ')}) and a colour (${Object.keys(CAPTION_COLOURS).join(', ')}).`,
    });
  }
  if (issues.length) {
    throw new ShortCaptionError('invalid_caption_lines', issues[0].message, { issues });
  }
  return { lines, style: body.style as CaptionStyle };
}
