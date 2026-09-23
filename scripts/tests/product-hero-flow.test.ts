import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyApiError,
  confirmationFor,
  currentStep,
  initialRenderState,
  isRunSettled,
  parseQuote,
  refundOf,
  readFlowParams,
  renderReducer,
  runToResume,
  startedRunId,
  viewOfRun,
  writeFlowParams,
  type RenderEvent,
  type RenderState,
} from '../../apps/web/lib/product-hero-flow.ts';

const DRAFT = '11111111-1111-4111-8111-111111111111';
const RUN_A = '22222222-2222-4222-8222-222222222222';
const RUN_B = '33333333-3333-4333-8333-333333333333';
const PHOTO = 'https://media.example/vnext/uploads/u/photo.png';
const QUOTE = { credits: 30, available: 100, sufficient: true };

const run = (state: RenderState, ...events: RenderEvent[]) => events.reduce(renderReducer, state);
const quoted = () => run(initialRenderState, { type: 'quote_requested' }, { type: 'quote_loaded', quote: QUOTE });
const choice = (photoUrl = PHOTO, music = true) => ({ draftId: DRAFT, photoUrl, music });
const confirm = (freshKey: string, photoUrl = PHOTO, music = true): RenderEvent => ({ type: 'confirm', choice: choice(photoUrl, music), freshKey });

describe('API error → UI state', () => {
  it('draft_render_in_flight resumes the running render instead of erroring', () => {
    assert.deepEqual(classifyApiError(409, { error: 'draft_render_in_flight', skill: 'make_product_hero', detail: 'x' }), { kind: 'resume_in_flight' });
  });
  it('draft_already_rendered shows the existing Short', () => {
    assert.equal(classifyApiError(409, { error: 'draft_already_rendered' }).kind, 'already_rendered');
  });
  it('a moderation refusal at run time says try a different photo', () => {
    const o = classifyApiError(422, { error: 'unsafe_content', code: 'UNSAFE_CONTENT', message: 'The uploaded image was rejected by content moderation.' });
    assert.equal(o.kind, 'moderation_blocked');
  });
  it('a moderation refusal at upload confirm (400 INVALID_INPUT) is a moderation block too', () => {
    const o = classifyApiError(400, { error: { code: 'INVALID_INPUT', message: 'image rejected by content moderation (sexual)' } });
    assert.equal(o.kind, 'moderation_blocked');
  });
  it('a plain invalid upload is an error, not a moderation block', () => {
    assert.equal(classifyApiError(400, { error: { code: 'INVALID_INPUT', message: 'r2: uploaded file is not a PNG or JPEG' } }).kind, 'error');
  });
  it('402 shows the server\'s own account of what is needed and spendable (no client arithmetic)', () => {
    assert.deepEqual(
      classifyApiError(402, { error: 'insufficient_credits', needed: 30, available: 40, committed: 20, detail: 'This needs 30 credits but you have 20 available' }),
      { kind: 'insufficient_credits', message: 'This needs 30 credits but you have 20 available' },
    );
  });
  for (const code of ['voice_not_approved', 'draft_out_of_band']) it(`${code} asks for a re-voice`, () => {
    assert.equal(classifyApiError(422, { error: code, detail: 'Re-voice' }).kind, 'revoice');
  });
  it('draft_not_found is a missing draft', () => {
    assert.equal(classifyApiError(404, { error: 'draft_not_found' }).kind, 'draft_missing');
  });
  it('the concurrency gate (429, nested error) is busy', () => {
    assert.equal(classifyApiError(429, { error: { code: 'TOO_MANY_ACTIVE_VIDEOS', message: 'wait' } }).kind, 'busy');
  });
  it('network and upstream failures are retryable with the same key', () => {
    assert.equal(classifyApiError(0, null).kind, 'retryable');
    assert.equal(classifyApiError(502, { error: { code: 'upstream_unreachable', message: 'ECONNREFUSED' } }).kind, 'retryable');
  });
  it('unpriceable_input is a plain error with its message', () => {
    assert.deepEqual(classifyApiError(422, { error: 'unpriceable_input', detail: 'no price' }), { kind: 'error', code: 'unpriceable_input', message: 'no price' });
  });
});

describe('quote and run bodies', () => {
  it('reads a quote; an unknown balance does not block', () => {
    assert.deepEqual(parseQuote({ slug: 'make_product_hero', credits: 30, available: null, committed: 0, sufficient: true }), { credits: 30, available: null, sufficient: true });
    assert.equal(parseQuote({ error: 'x' }), null);
  });
  it('reads the run id of a fresh or replayed start', () => {
    assert.equal(startedRunId({ skill_run_id: RUN_A, idempotent_replay: true }), RUN_A);
    assert.equal(startedRunId({ skill_run_id: 'nope' }), null);
  });
  it('maps workflow steps to progress', () => {
    assert.deepEqual(viewOfRun({ status: 'submitted', current_step: 'pending' }), { kind: 'rendering', stage: 'queued', shot: null, label: 'Queued' });
    assert.equal((viewOfRun({ status: 'running', current_step: 'audio' }) as { stage: string }).stage, 'voice');
    assert.deepEqual(viewOfRun({ status: 'running', current_step: 'clip_2' }), { kind: 'rendering', stage: 'visuals', shot: 2, label: 'Generating shot 2' });
    assert.equal((viewOfRun({ status: 'running', current_step: 'mux' }) as { stage: string }).stage, 'cut');
  });
  it('a succeeded run is the Short', () => {
    assert.deepEqual(viewOfRun({ status: 'succeeded', final_output: { video_url: 'https://m/x.mp4', duration_ms: 9120 } }), { kind: 'succeeded', videoUrl: 'https://m/x.mp4', durationMs: 9120 });
  });
  it('a video-model content-policy failure is a moderation block', () => {
    const v = viewOfRun({ status: 'failed', error: { code: 'EVOLINK_CONTENT_POLICY_VIOLATION', message: 'refused' } });
    assert.equal(v.kind === 'failed' && v.moderation, true);
  });
  it('other failures and cancels are not', () => {
    const f = viewOfRun({ status: 'failed', error: { code: 'EVOLINK_500', message: 'boom' } });
    assert.equal(f.kind === 'failed' && !f.moderation && !f.canceled, true);
    const c = viewOfRun({ status: 'canceled' });
    assert.equal(c.kind === 'failed' && c.canceled, true);
  });
});

describe('refund, as the server states it', () => {
  const failedRun = (credits: unknown) => ({ status: 'failed', error: { code: 'EVOLINK_500', message: 'x' }, credits }) as Parameters<typeof viewOfRun>[0];
  it('a fully refunded failure shows the amount the ledger returned', () => {
    assert.deepEqual(refundOf(failedRun({ charged: 420, refunded: 420, refund_status: 'refunded' })), { status: 'refunded', charged: 420, refunded: 420 });
  });
  it('a refund still on its way is pending, not "refunded"', () => {
    assert.deepEqual(refundOf(failedRun({ charged: 420, refunded: 280, refund_status: 'pending' })), { status: 'pending', charged: 420, refunded: 280 });
  });
  it('a failure before any charge says nothing was charged', () => {
    assert.equal(refundOf(failedRun({ charged: 0, refunded: 0, refund_status: 'not_due' })).status, 'not_charged');
  });
  it('an unreadable ledger (or an older API) claims nothing', () => {
    assert.equal(refundOf(failedRun(null)).status, 'unknown');
    assert.equal(refundOf(failedRun(undefined)).status, 'unknown');
  });
  it('the failure view carries the refund', () => {
    const v = viewOfRun(failedRun({ charged: 140, refunded: 140, refund_status: 'refunded' }));
    assert.deepEqual(v.kind === 'failed' && v.refund, { status: 'refunded', charged: 140, refunded: 140 });
  });
  it('a failed run is settled only once its refund has landed', () => {
    assert.equal(isRunSettled(failedRun({ charged: 420, refunded: 0, refund_status: 'pending' })), false);
    assert.equal(isRunSettled(failedRun({ charged: 420, refunded: 420, refund_status: 'refunded' })), true);
    assert.equal(isRunSettled({ status: 'running' }), false);
    assert.equal(isRunSettled({ status: 'succeeded', final_output: { video_url: 'https://m/s.mp4' } }), true);
  });
  it('polling a failed run updates a pending refund when it lands', () => {
    const failed = run(
      quoted(), confirm('k1'), { type: 'run_started', runId: RUN_A },
      { type: 'run_polled', runId: RUN_A, run: failedRun({ charged: 420, refunded: 0, refund_status: 'pending' }) },
    );
    assert.equal(failed.render.phase === 'failed' && failed.render.refund.status, 'pending');
    const later = run(failed, { type: 'run_polled', runId: RUN_A, run: failedRun({ charged: 420, refunded: 420, refund_status: 'refunded' }) });
    assert.deepEqual(later.render.phase === 'failed' && later.render.refund, { status: 'refunded', charged: 420, refunded: 420 });
    assert.equal(run(later, { type: 'run_polled', runId: RUN_B, run: failedRun(null) }), later);
  });
  it('after a reload the refund comes from the server, not from the page', () => {
    const s = run(initialRenderState, { type: 'resume', runId: RUN_A }, { type: 'run_polled', runId: RUN_A, run: failedRun({ charged: 280, refunded: 280, refund_status: 'refunded' }) });
    assert.deepEqual(s.render.phase === 'failed' && s.render.refund, { status: 'refunded', charged: 280, refunded: 280 });
  });
});

describe('render phase and Idempotency-Key lifecycle', () => {
  it('nothing starts before Confirm: a quote is only a quote', () => {
    assert.equal(quoted().render.phase, 'quoted');
    assert.equal(quoted().confirmation, null);
  });
  it('cannot confirm without a quote', () => {
    assert.equal(run(initialRenderState, confirm('k1')).render.phase, 'idle');
  });
  it('a double-click sends one key and starts once', () => {
    const s = run(quoted(), confirm('k1'), confirm('k2'));
    assert.equal(s.render.phase, 'starting');
    assert.equal(s.confirmation?.key, 'k1');
  });
  it('a network failure keeps the key, so pressing Confirm again replays, never double-charges', () => {
    const s = run(quoted(), confirm('k1'), { type: 'refused', outcome: { kind: 'retryable', message: 'x' } }, confirm('k2'));
    assert.equal(s.render.phase, 'starting');
    assert.equal(s.confirmation?.key, 'k1');
  });
  it('a refusal the user must fix (credits) cannot be confirmed straight away', () => {
    const s = run(quoted(), confirm('k1'), { type: 'refused', outcome: { kind: 'insufficient_credits', message: 'x' } }, confirm('k2'));
    assert.equal(s.render.phase, 'refused');
  });
  it('a different photo is a new confirmation with a new key', () => {
    const prev = { choice: choice(), key: 'k1' };
    assert.equal(confirmationFor(prev, choice(`${PHOTO}?2`), 'k2').key, 'k2');
    assert.equal(confirmationFor(prev, choice(), 'k2').key, 'k1');
  });
  it('a different Music Bed setting is a new confirmation with a new key', () => {
    const prev = { choice: choice(), key: 'k1' };
    const next = confirmationFor(prev, choice(PHOTO, false), 'k2');
    assert.equal(next.key, 'k2');
    assert.equal(next.choice.music, false);
  });
  it('toggling music after a network failure retires the key: Confirm again sends a new one', () => {
    // Confirm with music on; the request fails in transit (the server may have started it).
    const failed = run(quoted(), confirm('k1', PHOTO, true), { type: 'refused', outcome: { kind: 'retryable', message: 'x' } });
    // The user turns music off, the page re-quotes, and Confirm is pressed again.
    const s = run(failed, { type: 'invalidate_quote' }, { type: 'quote_requested' }, { type: 'quote_loaded', quote: QUOTE }, confirm('k2', PHOTO, false));
    assert.equal(s.render.phase, 'starting');
    assert.equal(s.confirmation?.key, 'k2');
    assert.equal(s.confirmation?.choice.music, false);
    // Unchanged music after the same failure still replays the same key.
    assert.equal(run(failed, confirm('k3', PHOTO, true)).confirmation?.key, 'k1');
  });
  it('progress, then the Short', () => {
    const s = run(
      quoted(), confirm('k1'), { type: 'run_started', runId: RUN_A },
      { type: 'run_polled', runId: RUN_A, run: { status: 'running', current_step: 'clip_1' } },
    );
    assert.equal(s.render.phase === 'rendering' && s.render.view?.stage, 'visuals');
    const done = run(s, { type: 'run_polled', runId: RUN_A, run: { status: 'succeeded', final_output: { video_url: 'https://m/s.mp4' } } });
    assert.equal(done.render.phase, 'succeeded');
    assert.deepEqual(done.render.phase === 'succeeded' && done.render.quote, QUOTE);
  });
  it('a poll of another run is ignored', () => {
    const s = run(quoted(), confirm('k1'), { type: 'run_started', runId: RUN_A });
    assert.equal(run(s, { type: 'run_polled', runId: RUN_B, run: { status: 'failed' } }).render.phase, 'rendering');
  });
  it('a failed render retires the key; retrying the same draft sends a new one', () => {
    const failed = run(
      quoted(), confirm('k1'), { type: 'run_started', runId: RUN_A },
      { type: 'run_polled', runId: RUN_A, run: { status: 'failed', error: { code: 'EVOLINK_500', message: 'x' } } },
    );
    assert.equal(failed.render.phase, 'failed');
    assert.equal(failed.confirmation, null);
    const again = run(failed, { type: 'retry' }, { type: 'quote_requested' }, { type: 'quote_loaded', quote: QUOTE }, confirm('k2'));
    assert.equal(again.render.phase, 'starting');
    assert.equal(again.confirmation?.key, 'k2');
  });
  it('a stale quote answer after starting is ignored', () => {
    const s = run(quoted(), confirm('k1'), { type: 'quote_requested' });
    assert.equal(s.render.phase, 'starting');
  });
  it('editing the Script withdraws the quote, so an unvoiced edit can never be confirmed', () => {
    const s = run(quoted(), { type: 'invalidate_quote' });
    assert.equal(s.render.phase, 'idle');
    assert.equal(run(s, confirm('k1')).render.phase, 'idle');
    const refused = run(quoted(), confirm('k1'), { type: 'refused', outcome: { kind: 'retryable', message: 'x' } }, { type: 'invalidate_quote' });
    assert.equal(refused.render.phase, 'idle');
    assert.equal(refused.confirmation?.key, 'k1');
  });
  it('withdrawing the quote never interrupts a render that started', () => {
    const starting = run(quoted(), confirm('k1'));
    assert.equal(run(starting, { type: 'invalidate_quote' }), starting);
    const rendering = run(starting, { type: 'run_started', runId: RUN_A });
    assert.equal(run(rendering, { type: 'invalidate_quote' }), rendering);
  });
  it('resume shows an existing run without confirming anything', () => {
    const s = run(initialRenderState, { type: 'resume', runId: RUN_A });
    assert.equal(s.render.phase === 'rendering' && s.render.runId, RUN_A);
    assert.equal(s.confirmation, null);
  });
});

describe('URL state and resume on reload', () => {
  it('reads only well-formed ids', () => {
    assert.deepEqual(readFlowParams(`?draft=${DRAFT}&run=nope`), { draftId: DRAFT, runId: null });
  });
  it('writes the ids and keeps other params', () => {
    assert.equal(writeFlowParams('?x=1', { draftId: DRAFT, runId: RUN_A }), `?x=1&draft=${DRAFT}&run=${RUN_A}`);
    assert.equal(writeFlowParams(`?draft=${DRAFT}&run=${RUN_A}`, { draftId: DRAFT, runId: null }), `?draft=${DRAFT}`);
    assert.equal(writeFlowParams(`?draft=${DRAFT}`, { draftId: null, runId: null }), '');
  });
  it("the draft's render claim wins over the URL's run", () => {
    assert.equal(runToResume({ draftId: DRAFT, runId: RUN_A }, { id: DRAFT, render_run_id: RUN_B }), RUN_B);
  });
  it('with no claim (a failed run released it) the URL run is shown, keeping its refund notice', () => {
    assert.equal(runToResume({ draftId: DRAFT, runId: RUN_A }, { id: DRAFT, render_run_id: null }), RUN_A);
  });
  it('a free draft with no run in the URL resumes nothing', () => {
    assert.equal(runToResume({ draftId: DRAFT, runId: null }, { id: DRAFT, render_run_id: null }), null);
  });
});

describe('stepper', () => {
  const idle = { phase: 'idle' } as const;
  it('walks Photo → Brief → Script → Confirm → Render → Short', () => {
    assert.equal(currentStep({ hasPhoto: false, hasDraft: false, scriptEdited: false, render: idle }), 'Photo');
    assert.equal(currentStep({ hasPhoto: true, hasDraft: false, scriptEdited: false, render: idle }), 'Brief');
    assert.equal(currentStep({ hasPhoto: true, hasDraft: true, scriptEdited: true, render: idle }), 'Script');
    assert.equal(currentStep({ hasPhoto: true, hasDraft: true, scriptEdited: false, render: idle }), 'Confirm');
    assert.equal(currentStep({ hasPhoto: true, hasDraft: true, scriptEdited: false, render: { phase: 'rendering', runId: RUN_A, view: null, quote: null } }), 'Render');
    assert.equal(currentStep({ hasPhoto: true, hasDraft: true, scriptEdited: false, render: { phase: 'succeeded', runId: RUN_A, videoUrl: 'u', durationMs: null, quote: null } }), 'Short');
  });
});
