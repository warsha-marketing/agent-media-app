// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The render half of the web Product Hero flow (#6), as pure functions so it is
 * testable without a browser (scripts/tests/product-hero-flow.test.ts).
 *
 *   photo + approved draft ─► quote ─► Confirm ─► rendering ─► Short
 *                                 ▲                   │
 *                                 └──── retry ◄─ failed (refunded)
 *
 * What lives here:
 *   - reading the API's (mixed-shape) error bodies into one outcome per UI state;
 *   - reading a skill run into what the progress / result / failure panels show;
 *   - the render-phase reducer, including the Idempotency-Key lifecycle: one key
 *     per confirmation of a (draft, photo) pair, reused by a double-click or a
 *     retried request, retired once the run it started has failed, so a retry of
 *     the SAME draft is a new run rather than a replay of the failed one;
 *   - the URL state (?draft=…&run=…) and which run to resume after a reload.
 *
 * No imports: node --test loads this file directly with type stripping.
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
}

/** POST /v1/skills/make_product_hero/quote → 200. */
export interface Quote {
  credits: number;
  /** Spendable balance (balance minus in-flight reservations); null = unknown. */
  available: number | null;
  sufficient: boolean;
}

/** A 200 quote body, or null if it is not one. */
export function parseQuote(body: unknown): Quote | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.credits !== 'number' || !Number.isFinite(b.credits)) return null;
  const available = typeof b.available === 'number' ? b.available : null;
  return { credits: b.credits, available, sufficient: b.sufficient !== false };
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
  | { kind: 'insufficient_credits'; needed: number | null; available: number | null; message: string }
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
    case 'insufficient_credits': {
      const b = body as { needed?: unknown; available?: unknown; committed?: unknown };
      const available = typeof b.available === 'number'
        ? Math.max(0, b.available - (typeof b.committed === 'number' ? b.committed : 0))
        : null;
      return {
        kind: 'insufficient_credits',
        needed: typeof b.needed === 'number' ? b.needed : null,
        available,
        message: message ?? 'Not enough credits for this render.',
      };
    }
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

export type RunView =
  | { kind: 'rendering'; stage: RenderStage; shot: number | null; label: string }
  | { kind: 'succeeded'; videoUrl: string; durationMs: number | null }
  | { kind: 'failed'; canceled: boolean; moderation: boolean; code: string | null; message: string | null };

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

/** Map the workflow's current_step (pending | audio | clip_N | mux | done) to a stage. */
export function stageOf(currentStep: string | null | undefined): { stage: RenderStage; shot: number | null } {
  const step = currentStep ?? '';
  const clip = /^clip_(\d+)$/.exec(step);
  if (clip) return { stage: 'visuals', shot: Number(clip[1]) };
  if (step === 'audio') return { stage: 'voice', shot: null };
  if (step === 'mux' || step === 'done') return { stage: 'cut', shot: null };
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
    return { kind: 'failed', canceled: false, moderation: false, code: 'NO_OUTPUT', message: 'The render finished without a video.' };
  }
  if (status === 'failed' || status === 'canceled' || status === 'cancelled') {
    const code = run.error?.code ?? null;
    const message = run.error?.message ?? null;
    return { kind: 'failed', canceled: status !== 'failed', moderation: isModerationBlock(code, message), code, message };
  }
  const { stage, shot } = stageOf(run.current_step);
  const label = stage === 'visuals' && shot ? `Generating product shot ${shot}` : RENDER_STAGES.find((s) => s.stage === stage)!.label;
  return { kind: 'rendering', stage, shot, label };
}

// ── Render phase + Idempotency-Key lifecycle ───────────────────────────────

/** One confirmation of a (draft, photo) pair, and the key it sends. */
export interface Confirmation {
  draftId: string;
  photoUrl: string;
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
  | { phase: 'failed'; runId: string; canceled: boolean; moderation: boolean; message: string | null; quote: Quote | null };

export interface RenderState {
  render: RenderPhase;
  /** The key the next Confirm sends; null until the first Confirm. */
  confirmation: Confirmation | null;
}

export type RenderEvent =
  | { type: 'reset' }
  | { type: 'quote_requested' }
  | { type: 'quote_loaded'; quote: Quote }
  | { type: 'refused'; outcome: ApiOutcome }
  /** `freshKey` is used only if this is a new (draft, photo) confirmation. */
  | { type: 'confirm'; draftId: string; photoUrl: string; freshKey: string }
  | { type: 'run_started'; runId: string }
  /** Show an existing run (reload, or a render already in flight). */
  | { type: 'resume'; runId: string }
  | { type: 'run_polled'; runId: string; run: SkillRunBody }
  /** After a failure: render the same draft again (a new run, a new key). */
  | { type: 'retry' };

export const initialRenderState: RenderState = { render: { phase: 'idle' }, confirmation: null };

/** The key for confirming this (draft, photo): the pending one if it is the same pair. */
export function confirmationFor(prev: Confirmation | null, draftId: string, photoUrl: string, freshKey: string): Confirmation {
  if (prev && prev.draftId === draftId && prev.photoUrl === photoUrl) return prev;
  return { draftId, photoUrl, key: freshKey };
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
    case 'quote_requested':
      if (r.phase === 'starting' || r.phase === 'rendering') return state;
      return { ...state, render: { phase: 'quoting' } };
    case 'quote_loaded':
      if (r.phase !== 'quoting') return state; // a stale answer
      return { ...state, render: { phase: 'quoted', quote: event.quote } };
    case 'refused':
      return { ...state, render: { phase: 'refused', outcome: event.outcome, quote: quoteOf(r) } };
    case 'confirm': {
      // Only a quoted cost can be confirmed — also again after a network blip or
      // a busy server, with the SAME key. A second click while starting is a no-op.
      const again = r.phase === 'refused' && (r.outcome.kind === 'retryable' || r.outcome.kind === 'busy');
      if (r.phase !== 'quoted' && !again) return state;
      const quote = quoteOf(r);
      if (!quote) return state;
      return {
        render: { phase: 'starting', quote },
        confirmation: confirmationFor(state.confirmation, event.draftId, event.photoUrl, event.freshKey),
      };
    }
    case 'run_started':
    case 'resume':
      if (r.phase === 'rendering' && r.runId === event.runId) return state;
      return { ...state, render: { phase: 'rendering', runId: event.runId, view: null, quote: quoteOf(r) } };
    case 'run_polled': {
      // Only the run on screen may move the page.
      if (r.phase !== 'rendering' || r.runId !== event.runId) return state;
      const view = viewOfRun(event.run);
      if (view.kind === 'rendering') return { ...state, render: { ...r, view } };
      if (view.kind === 'succeeded') {
        return { ...state, render: { phase: 'succeeded', runId: r.runId, videoUrl: view.videoUrl, durationMs: view.durationMs, quote: r.quote } };
      }
      // The run that key started is over and refunded: the next Confirm is a new run.
      return {
        render: { phase: 'failed', runId: r.runId, canceled: view.canceled, moderation: view.moderation, message: view.message, quote: r.quote },
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
