// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The render half of the web Product Hero flow (#6), as pure functions so it is
 * testable without a browser (scripts/tests/product-hero-flow.test.ts).
 *
 *   photo + approved draft ─► quote ─► Confirm ─► rendering ─► Short
 *                                 ▲                   │
 *                                 └──── retry ◄─ failed (refund as the server reports it)
 *
 * What lives here:
 *   - reading the API's (mixed-shape) error bodies into one outcome per UI state;
 *   - reading a skill run into what the progress / result / failure panels show;
 *   - the render-phase reducer, including the Idempotency-Key lifecycle: one key
 *     per confirmation of a (draft, photo, Music Bed) request, reused by a
 *     double-click or a
 *     retried request, retired once the run it started has failed, so a retry of
 *     the SAME draft is a new run rather than a replay of the failed one;
 *   - the URL state (?draft=…&run=…) and which run to resume after a reload.
 *
 * No imports: scripts/tests loads this file directly.
 */

// ── API bodies ──────────────────────────────────────────────────────────────

/** GET /v1/skills/runs/:id, the fields this flow reads. */
export interface SkillRunBody {
  skill_run_id?: string;
  status?: string;
  current_step?: string | null;
  started_at?: string | null;
  created_at?: string | null;
  final_output?: Record<string, unknown> | null;
  error?: { code?: string | null; message?: string | null } | null;
  /** What the run charged and refunded, from the credit ledger; null = unreadable. */
  credits?: { charged?: number; refunded?: number; refund_status?: string } | null;
}

/** POST /v1/skills/make_product_hero/quote → 200. */
export interface Quote {
  credits: number;
  /** Spendable balance (balance minus in-flight reservations); null = unknown. */
  available: number | null;
  sufficient: boolean;
  /** What the quote says about the Music Bed (#9), when it says anything. */
  musicBed?: MusicBedQuote;
}

/** The quote's Music Bed (#9): a bed will play, or why the Short is voice only. */
export interface MusicBedQuote {
  on: boolean;
  reason: 'off' | 'no_tracks' | null;
  detail: string;
}

/** A 200 quote body, or null if it is not one. */
export function parseQuote(body: unknown): Quote | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.credits !== 'number' || !Number.isFinite(b.credits)) return null;
  const available = typeof b.available === 'number' ? b.available : null;
  const musicBed = parseMusicBed(b.music_bed);
  return { credits: b.credits, available, sufficient: b.sufficient !== false, ...(musicBed ? { musicBed } : {}) };
}

// ── Music Bed (#9) ──────────────────────────────────────────────────────────

/**
 * Fallback lines under the Music Bed toggle, used only until a quote for the
 * current setting says otherwise: the server's `music_bed.detail` is the copy.
 */
export const NO_MUSIC_LINE = 'No music: the Short is voice only, so you can add a sound in TikTok.';
const MUSIC_ON_LINE = 'A licensed Music Bed plays quietly under the voice.';

function parseMusicBed(v: unknown): MusicBedQuote | null {
  if (!v || typeof v !== 'object') return null;
  const m = v as Record<string, unknown>;
  if (typeof m.on !== 'boolean') return null;
  const reason = m.reason === 'off' || m.reason === 'no_tracks' ? m.reason : null;
  return { on: m.on, reason, detail: typeof m.detail === 'string' ? m.detail : '' };
}

/**
 * The line under the Music Bed toggle: the server's own `detail` from a quote
 * asked with this setting (the quote body carries `music`). A local fallback
 * only while no such quote is on screen (not answered yet, or it was for the
 * other setting).
 */
export function musicBedLine(music: boolean, quote: Quote): string {
  const m = quote.musicBed;
  const forThisSetting = m && (music ? m.reason !== 'off' : m.reason === 'off');
  if (m && forThisSetting && m.detail) return m.detail;
  return music ? MUSIC_ON_LINE : NO_MUSIC_LINE;
}

/** The make_product_hero run body. aspect_ratio is left to the server (always 9:16). */
export function renderBody(draftId: string, photoUrl: string, music: boolean) {
  return { draft_id: draftId, product_image_url: photoUrl, music };
}

/** The make_product_hero quote body: the same request the run would send. */
export function quoteBody(draftId: string, photoUrl: string, music: boolean) {
  return renderBody(draftId, photoUrl, music);
}

/** The run id of a 202 from POST /v1/skills/make_product_hero/run (fresh or replayed). */
export function startedRunId(body: unknown): string | null {
  const id = (body as { skill_run_id?: unknown } | null)?.skill_run_id;
  return typeof id === 'string' && isUuid(id) ? id : null;
}

/**
 * What a refused quote / run / upload means for the page. The API answers in
 * three shapes — `{ error: 'code', detail }` (skill routes), `{ error: { code,
 * message } }` (uploads, drafts, the concurrency gate, the web proxy) and
 * `{ error: 'unsafe_content', code, message }` (moderation) — so the code and
 * the message are read from whichever is present.
 */
export type ApiOutcome =
  /** draft_render_in_flight: a render of this draft is running — show it. */
  | { kind: 'resume_in_flight' }
  /** draft_already_rendered: this draft is a Short already — show it. */
  | { kind: 'already_rendered' }
  /** The photo was refused by moderation. Nothing was charged. */
  | { kind: 'moderation_blocked'; message: string }
  /** 402: `message` is the server's own line (needed, spendable, reserved). */
  | { kind: 'insufficient_credits'; message: string }
  /** voice_not_approved / draft_out_of_band: the draft cannot render; re-voice. */
  | { kind: 'revoice'; code: string; message: string }
  | { kind: 'draft_missing'; message: string }
  /** 429: too many renders at once, or rate limited. */
  | { kind: 'busy'; message: string }
  /** Network / upstream trouble: the same confirmation may be retried as-is. */
  | { kind: 'retryable'; message: string }
  | { kind: 'error'; code: string | null; message: string };

export function apiErrorCode(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.error === 'string') return b.error;
  const e = b.error as { code?: unknown } | undefined;
  if (e && typeof e.code === 'string') return e.code;
  return typeof b.code === 'string' ? b.code : null;
}

export function apiErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.detail === 'string') return b.detail;
  if (typeof b.message === 'string') return b.message;
  const e = b.error as { message?: unknown } | undefined;
  if (e && typeof e === 'object' && typeof e.message === 'string') return e.message;
  return null;
}

const MODERATION_CODES = new Set(['unsafe_content', 'evolink_content_policy_violation']);

/** A moderation verdict, whether from our upload gate or the video model. */
export function isModerationBlock(code: string | null | undefined, message?: string | null): boolean {
  if (code && MODERATION_CODES.has(code.toLowerCase())) return true;
  return !!message && /content moderation|content.policy/i.test(message);
}

export function classifyApiError(status: number, body: unknown): ApiOutcome {
  const code = apiErrorCode(body);
  const message = apiErrorMessage(body);
  const lc = code?.toLowerCase() ?? null;
  switch (lc) {
    case 'draft_render_in_flight':
      return { kind: 'resume_in_flight' };
    case 'draft_already_rendered':
      return { kind: 'already_rendered' };
    case 'insufficient_credits':
      return { kind: 'insufficient_credits', message: message ?? 'Not enough credits for this render.' };
    case 'voice_not_approved':
    case 'draft_out_of_band':
      return { kind: 'revoice', code: lc, message: message ?? 'Re-voice the Script, then render the new draft.' };
    case 'draft_not_found':
    case 'not_found':
      return { kind: 'draft_missing', message: message ?? 'This draft is not on your account.' };
  }
  if (isModerationBlock(code, message)) {
    return { kind: 'moderation_blocked', message: message ?? 'The photo was rejected by content moderation.' };
  }
  if (status === 429) return { kind: 'busy', message: message ?? 'Too many requests. Try again in a moment.' };
  if (status === 0 || status === 502 || status === 503 || status === 504 || lc === 'upstream_unreachable') {
    return { kind: 'retryable', message: message ?? 'Could not reach the server. Try again.' };
  }
  return { kind: 'error', code, message: message ?? `Request failed (HTTP ${status}).` };
}

// ── Runs ────────────────────────────────────────────────────────────────────

export type RenderStage = 'queued' | 'voice' | 'visuals' | 'cut';

/**
 * The refund of a failed or canceled run, exactly as the server reports it —
 * never assumed. `unknown` = the server could not read (or did not send) it.
 */
export type RefundView =
  | { status: 'refunded' | 'pending'; charged: number; refunded: number }
  | { status: 'not_charged' }
  | { status: 'unknown' };

export function refundOf(run: SkillRunBody): RefundView {
  const c = run.credits;
  if (!c || typeof c.charged !== 'number' || typeof c.refunded !== 'number') return { status: 'unknown' };
  if (c.charged <= 0) return { status: 'not_charged' };
  if (c.refund_status === 'refunded' || c.refund_status === 'pending') {
    return { status: c.refund_status, charged: c.charged, refunded: c.refunded };
  }
  return { status: 'unknown' };
}

export type RunView =
  | { kind: 'rendering'; stage: RenderStage; shot: number | null; label: string }
  | { kind: 'succeeded'; videoUrl: string; durationMs: number | null }
  | { kind: 'failed'; canceled: boolean; moderation: boolean; code: string | null; message: string | null; refund: RefundView };

/** The ordered checklist the progress panel draws. */
export const RENDER_STAGES: ReadonlyArray<{ stage: RenderStage; label: string }> = [
  { stage: 'queued', label: 'Queued' },
  { stage: 'voice', label: 'Loading your approved voice' },
  { stage: 'visuals', label: 'Generating silent product shots' },
  { stage: 'cut', label: 'Cutting the shots to the voice' },
];

const TERMINAL = new Set(['succeeded', 'failed', 'canceled', 'cancelled']);

export function isTerminalRun(status: string | undefined | null): boolean {
  return !!status && TERMINAL.has(status);
}

/** Nothing left to follow: the run is over and, if it failed, its refund has landed. */
export function isRunSettled(run: SkillRunBody): boolean {
  return isTerminalRun(run.status) && run.credits?.refund_status !== 'pending';
}

/** Map the workflow's current_step (pending | audio | clip_N | mux | done) to a stage. */
export function stageOf(currentStep: string | null | undefined): { stage: RenderStage; shot: number | null } {
  const step = currentStep ?? '';
  const clip = /^clip_(\d+)$/.exec(step);
  if (clip) return { stage: 'visuals', shot: Number(clip[1]) };
  if (step === 'audio') return { stage: 'voice', shot: null };
  if (step === 'mux' || step === 'music_bed' || step === 'done') return { stage: 'cut', shot: null };
  return { stage: 'queued', shot: null };
}

export function viewOfRun(run: SkillRunBody): RunView {
  const status = run.status ?? '';
  if (status === 'succeeded') {
    const out = run.final_output ?? {};
    const url = typeof out.video_url === 'string' ? out.video_url : null;
    if (url) {
      return { kind: 'succeeded', videoUrl: url, durationMs: typeof out.duration_ms === 'number' ? out.duration_ms : null };
    }
    // Succeeded without a Short is not a result the user can use.
    return { kind: 'failed', canceled: false, moderation: false, code: 'NO_OUTPUT', message: 'The render finished without a video.', refund: refundOf(run) };
  }
  if (status === 'failed' || status === 'canceled' || status === 'cancelled') {
    const code = run.error?.code ?? null;
    const message = run.error?.message ?? null;
    return { kind: 'failed', canceled: status !== 'failed', moderation: isModerationBlock(code, message), code, message, refund: refundOf(run) };
  }
  const { stage, shot } = stageOf(run.current_step);
  const label = stage === 'visuals' && shot ? `Generating product shot ${shot}` : RENDER_STAGES.find((s) => s.stage === stage)!.label;
  return { kind: 'rendering', stage, shot, label };
}

// ── Render phase + Idempotency-Key lifecycle ───────────────────────────────

/**
 * What one confirmation asks the server for. Everything in the run body is here:
 * the Idempotency-Key names exactly this request (the server refuses the same
 * key with a different body, 409 idempotency_key_reused).
 */
export interface ConfirmationRequest {
  draftId: string;
  photoUrl: string;
  /** Music Bed on/off (#9). */
  music: boolean;
}

/** One confirmation of a request, and the key it sends. */
export interface Confirmation extends ConfirmationRequest {
  key: string;
}

export type RenderPhase =
  /** Nothing to price yet (no draft, no photo, or the Script has unsaved edits). */
  | { phase: 'idle' }
  | { phase: 'quoting' }
  /** The cost is on screen; nothing is charged until Confirm. */
  | { phase: 'quoted'; quote: Quote }
  /** Confirm was pressed; the run request is in flight. */
  | { phase: 'starting'; quote: Quote }
  /** A refusal the user must act on (credits, moderation, re-voice, …). */
  | { phase: 'refused'; outcome: ApiOutcome; quote: Quote | null }
  | { phase: 'rendering'; runId: string; view: Extract<RunView, { kind: 'rendering' }> | null; quote: Quote | null }
  | { phase: 'succeeded'; runId: string; videoUrl: string; durationMs: number | null; quote: Quote | null }
  | { phase: 'failed'; runId: string; canceled: boolean; moderation: boolean; message: string | null; refund: RefundView; quote: Quote | null };

export interface RenderState {
  render: RenderPhase;
  /** The key the next Confirm sends; null until the first Confirm. */
  confirmation: Confirmation | null;
}

export type RenderEvent =
  | { type: 'reset' }
  /** The Script was edited: the quote on screen no longer prices what would render. */
  | { type: 'invalidate_quote' }
  | { type: 'quote_requested' }
  | { type: 'quote_loaded'; quote: Quote }
  | { type: 'refused'; outcome: ApiOutcome }
  /** `freshKey` is used only if this is a new (draft, photo, music) confirmation. */
  | ({ type: 'confirm'; freshKey: string } & ConfirmationRequest)
  | { type: 'run_started'; runId: string }
  /** Show an existing run (reload, or a render already in flight). */
  | { type: 'resume'; runId: string }
  | { type: 'run_polled'; runId: string; run: SkillRunBody }
  /** After a failure: render the same draft again (a new run, a new key). */
  | { type: 'retry' };

export const initialRenderState: RenderState = { render: { phase: 'idle' }, confirmation: null };

/** The key for confirming this request: the pending one only if it is the same request. */
export function confirmationFor(prev: Confirmation | null, req: ConfirmationRequest, freshKey: string): Confirmation {
  if (prev && prev.draftId === req.draftId && prev.photoUrl === req.photoUrl && prev.music === req.music) return prev;
  return { draftId: req.draftId, photoUrl: req.photoUrl, music: req.music, key: freshKey };
}

function quoteOf(p: RenderPhase): Quote | null {
  return 'quote' in p ? p.quote : null;
}

export function renderReducer(state: RenderState, event: RenderEvent): RenderState {
  const r = state.render;
  switch (event.type) {
    case 'reset':
      // A new draft or photo: whatever was quoted no longer applies.
      return { render: { phase: 'idle' }, confirmation: state.confirmation };
    case 'invalidate_quote':
      if (r.phase !== 'quoting' && r.phase !== 'quoted' && r.phase !== 'refused') return state;
      return { ...state, render: { phase: 'idle' } };
    case 'quote_requested':
      if (r.phase === 'starting' || r.phase === 'rendering') return state;
      return { ...state, render: { phase: 'quoting' } };
    case 'quote_loaded':
      if (r.phase !== 'quoting') return state; // a stale answer
      return { ...state, render: { phase: 'quoted', quote: event.quote } };
    case 'refused':
      return { ...state, render: { phase: 'refused', outcome: event.outcome, quote: quoteOf(r) } };
    case 'confirm': {
      // THE gate for spending: only a quoted cost can be confirmed — also again
      // after a network blip or a busy server, with the SAME key. A second click
      // while starting is a no-op. The page sends the run request only when this
      // moves the phase to 'starting'.
      const again = r.phase === 'refused' && (r.outcome.kind === 'retryable' || r.outcome.kind === 'busy');
      if (r.phase !== 'quoted' && !again) return state;
      const quote = quoteOf(r);
      if (!quote) return state;
      return {
        render: { phase: 'starting', quote },
        confirmation: confirmationFor(state.confirmation, { draftId: event.draftId, photoUrl: event.photoUrl, music: event.music }, event.freshKey),
      };
    }
    case 'run_started':
    case 'resume':
      if (r.phase === 'rendering' && r.runId === event.runId) return state;
      return { ...state, render: { phase: 'rendering', runId: event.runId, view: null, quote: quoteOf(r) } };
    case 'run_polled': {
      // A failed run is still followed while its refund is pending: only the refund moves.
      if (r.phase === 'failed' && r.runId === event.runId) {
        const view = viewOfRun(event.run);
        return view.kind === 'failed' ? { ...state, render: { ...r, refund: view.refund } } : state;
      }
      // Only the run on screen may move the page.
      if (r.phase !== 'rendering' || r.runId !== event.runId) return state;
      const view = viewOfRun(event.run);
      if (view.kind === 'rendering') return { ...state, render: { ...r, view } };
      if (view.kind === 'succeeded') {
        return { ...state, render: { phase: 'succeeded', runId: r.runId, videoUrl: view.videoUrl, durationMs: view.durationMs, quote: r.quote } };
      }
      // The run that key started is over and refunded: the next Confirm is a new run.
      return {
        render: { phase: 'failed', runId: r.runId, canceled: view.canceled, moderation: view.moderation, message: view.message, refund: view.refund, quote: r.quote },
        confirmation: null,
      };
    }
    case 'retry':
      if (r.phase !== 'failed' && r.phase !== 'refused') return state;
      return { render: { phase: 'idle' }, confirmation: null };
  }
}

// ── URL state and resume ───────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: string | null | undefined): v is string {
  return !!v && UUID.test(v);
}

/** The flow's place in the URL: the draft on screen and the run rendering it. */
export interface FlowParams {
  draftId: string | null;
  runId: string | null;
}

export function readFlowParams(search: string): FlowParams {
  const q = new URLSearchParams(search);
  const draft = q.get('draft');
  const run = q.get('run');
  return { draftId: isUuid(draft) ? draft : null, runId: isUuid(run) ? run : null };
}

/** `search` with the flow params replaced (null removes one); other params are kept. */
export function writeFlowParams(search: string, next: FlowParams): string {
  const q = new URLSearchParams(search);
  for (const [name, value] of [['draft', next.draftId], ['run', next.runId]] as const) {
    if (value) q.set(name, value);
    else q.delete(name);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/**
 * The run to show after a reload. The draft's own render claim wins: it names
 * the run rendering (or that rendered) the draft now, even if the URL still
 * carries an older, failed run. With no claim, the URL's run is shown (a failed
 * run releases its claim, and its refund notice should survive the reload).
 */
export function runToResume(params: FlowParams, draft: { id: string; render_run_id?: string | null } | null): string | null {
  if (draft && params.draftId && draft.id !== params.draftId) return null;
  if (draft?.render_run_id && isUuid(draft.render_run_id)) return draft.render_run_id;
  return params.runId;
}

// ── Steps ───────────────────────────────────────────────────────────────────

export const FLOW_STEPS = ['Photo', 'Brief', 'Script', 'Confirm', 'Render', 'Short'] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];

/** The step the user is on, for the stepper at the top of the page. */
export function currentStep(s: { hasPhoto: boolean; hasDraft: boolean; scriptEdited: boolean; render: RenderPhase }): FlowStep {
  const p = s.render.phase;
  if (p === 'succeeded') return 'Short';
  if (p === 'rendering' || p === 'starting' || p === 'failed') return 'Render';
  if (!s.hasDraft) return s.hasPhoto ? 'Brief' : 'Photo';
  if (s.scriptEdited) return 'Script';
  return s.hasPhoto ? 'Confirm' : 'Photo';
}

// ── Delivery Tags in the Script editor ─────────────────────────────────────

/**
 * The allowed Delivery Tags (CONTEXT.md, ADR 0002): bracketed directions such
 * as [softly] that eleven_v3 treats as how to speak, never as words. The list
 * lives in @agentmedia/schema (DELIVERY_TAGS); this is a mirror, because this
 * file takes no imports, held equal to it by scripts/tests/delivery-tags-parity.test.ts
 * (as are the helpers below that word or format tags).
 */
export const DELIVERY_TAGS = [
  'softly',
  'whispers',
  'warmly',
  'excited',
  'confidently',
  'laughs',
  'sighs',
  'curious',
  'calm',
  'cheerfully',
] as const;

/** Tags as a Script writes them: "[softly], [warmly]". Mirrors formatDeliveryTags in @agentmedia/schema. */
export function formatDeliveryTags(tags: readonly string[] = DELIVERY_TAGS): string {
  return tags.map((t) => `[${t}]`).join(', ');
}

/** Why unknown tags are refused, in the server's words (unknownDeliveryTagMessage in @agentmedia/schema). */
export function unknownDeliveryTagMessage(unknown: readonly string[]): string {
  return unknown.length === 1
    ? `${unknown[0]} is not a Delivery Tag; it would be spoken aloud.`
    : `${unknown.join(', ')} are not Delivery Tags; they would be spoken aloud.`;
}

/** The Product Details field's limit: the API's PRODUCT_DETAILS_MAX_CHARS (held equal by the parity test). */
export const PRODUCT_DETAILS_MAX = 3000;

/**
 * Bracketed text in a Script that is not an allowed Delivery Tag, as written
 * (e.g. "[wisper]"). The server refuses these on re-voice (UNKNOWN_DELIVERY_TAG);
 * the editor warns first so a typo is not sent at all.
 */
export function unknownDeliveryTags(script: string): string[] {
  const allowed = new Set<string>(DELIVERY_TAGS);
  const out: string[] = [];
  for (const m of script.matchAll(/\[([^[\]\n]*)\]/g)) {
    if (!allowed.has(m[1].trim().toLowerCase())) out.push(m[0]);
  }
  return out;
}

/** `script` with `[tag] ` inserted at the caret (or over the selection), and where the caret goes next. */
export function insertDeliveryTag(script: string, tag: string, selStart: number, selEnd: number): { script: string; caret: number } {
  const start = Math.max(0, Math.min(selStart, script.length));
  const end = Math.max(start, Math.min(selEnd, script.length));
  const before = script.slice(0, start);
  const pad = before && !/\s$/.test(before) ? ' ' : '';
  const insert = `${pad}[${tag}] `;
  const after = script.slice(end).replace(/^\s+/, '');
  return { script: before + insert + after, caret: before.length + insert.length };
}
