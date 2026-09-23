// Copyright 2026 agent-media contributors. Apache-2.0 license.

'use client';

/**
 * The render half of /dashboard/product-hero (#6): the cost confirmation, the
 * render's progress, and the finished Short (or the failure, with its refund).
 * Presentational only: the state comes from lib/product-hero-flow.ts.
 */

import Link from 'next/link';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { AlertTriangle, Check, Clapperboard, Download, ImageOff, Loader2, RotateCcw } from 'lucide-react';
import { FLOW_STEPS, RENDER_STAGES, type ApiOutcome, type FlowStep, type RenderPhase } from '@/lib/product-hero-flow';

const card = { border: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#14151F' } as const;
const muted = { color: 'rgba(255,255,255,0.45)' } as const;
const text = { color: 'rgba(255,255,255,0.75)' } as const;
const label = 'text-[11px] uppercase tracking-wider';
const primary = { backgroundColor: '#A78BFA', color: '#0F1015' } as const;
const secondary = { border: '1px solid rgba(167,139,250,0.5)', color: '#C9B8FF' } as const;
const danger = { border: '1px solid rgba(255,79,79,0.3)', backgroundColor: 'rgba(255,79,79,0.08)', color: '#FCA5A5' } as const;
const good = { border: '1px solid rgba(52,211,153,0.3)', backgroundColor: 'rgba(52,211,153,0.08)', color: '#6EE7B7' } as const;

const credits = (n: number) => `${n} credit${n === 1 ? '' : 's'}`;
/** Server messages from the storage layer carry an internal prefix. */
export const cleanMessage = (m: string) => m.replace(/^r2:\s*/i, '');

export function Stepper({ current }: { current: FlowStep }) {
  const at = FLOW_STEPS.indexOf(current);
  return (
    <ol className="mt-6 flex flex-wrap items-center gap-1.5 text-xs" aria-label="Progress">
      {FLOW_STEPS.map((s, i) => {
        const done = i < at;
        const now = i === at;
        return (
          <li key={s} className="flex items-center gap-1.5">
            <span
              aria-current={now ? 'step' : undefined}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1"
              style={{
                border: `1px solid ${now ? '#A78BFA' : 'rgba(255,255,255,0.08)'}`,
                color: now ? '#E9E9F0' : done ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.35)',
                backgroundColor: now ? 'rgba(167,139,250,0.12)' : 'transparent',
              }}
            >
              {done ? <Check className="h-3 w-3" /> : null}
              {s}
            </span>
            {i < FLOW_STEPS.length - 1 ? <span style={muted}>›</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

interface RenderPanelProps {
  render: RenderPhase;
  hasDraft: boolean;
  hasPhoto: boolean;
  /** The Script has edits that were not voiced: the draft on screen is not what they read. */
  edited: boolean;
  onConfirm: () => void;
  onRequote: () => void;
  onRetry: () => void;
  onNewPhoto: () => void;
}

export function RenderPanel(p: RenderPanelProps) {
  const r = p.render;
  return (
    <section className="mt-6 flex flex-col gap-3 rounded-2xl p-5" style={card} aria-live="polite">
      <span className={label} style={muted}>Render</span>
      {r.phase === 'idle' ? <Waiting {...p} /> : null}
      {r.phase === 'quoting' ? (
        <p className="inline-flex items-center gap-2 text-sm" style={text}>
          <Loader2 className="h-4 w-4 animate-spin" /> Getting the price…
        </p>
      ) : null}
      {r.phase === 'quoted' || r.phase === 'starting' ? (
        <Confirmation quote={r.quote} starting={r.phase === 'starting'} blocked={p.edited} onConfirm={p.onConfirm} />
      ) : null}
      {r.phase === 'refused' ? <Refusal outcome={r.outcome} quoted={!!r.quote} {...p} /> : null}
      {r.phase === 'rendering' ? <Progress view={r.view} /> : null}
      {r.phase === 'succeeded' ? <Result runId={r.runId} videoUrl={r.videoUrl} durationMs={r.durationMs} /> : null}
      {r.phase === 'failed' ? (
        <Failure canceled={r.canceled} moderation={r.moderation} message={r.message} onRetry={p.onRetry} onNewPhoto={p.onNewPhoto} />
      ) : null}
    </section>
  );
}

function Waiting({ hasDraft, hasPhoto, edited }: RenderPanelProps) {
  const todo = [
    !hasPhoto ? 'add a product photo' : null,
    !hasDraft ? 'write and voice a Script' : edited ? 're-voice your edited Script' : null,
  ].filter(Boolean);
  return (
    <p className="text-sm" style={muted}>
      {todo.length ? `To see the price, ${todo.join(' and ')}.` : 'Getting ready…'}
    </p>
  );
}

function Confirmation({ quote, starting, blocked, onConfirm }: { quote: { credits: number; available: number | null; sufficient: boolean }; starting: boolean; blocked: boolean; onConfirm: () => void }) {
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl" style={{ color: '#E9E9F0', letterSpacing: '-0.02em' }}>{credits(quote.credits)}</span>
        {quote.available !== null ? <span className="text-xs" style={muted}>{credits(quote.available)} available</span> : null}
      </div>
      <p className="text-sm" style={text}>
        Your Short is rendered from this photo and the voice you approved, cut to its exact length. Nothing is charged
        until you confirm, and if the render fails the credits are refunded.
      </p>
      {!quote.sufficient ? (
        <p className="rounded-xl px-3 py-2 text-sm" style={danger}>
          You don&apos;t have enough credits for this render.{' '}
          <Link href="/dashboard/billing" className="underline">Top up on the Billing page</Link>, then come back.
        </p>
      ) : null}
      {blocked ? (
        <p className="text-xs" style={muted}>You edited the Script. Re-voice it (or undo the edit) first: the Short speaks the voiced draft.</p>
      ) : null}
      <div>
        <button
          type="button"
          onClick={onConfirm}
          disabled={starting || blocked || !quote.sufficient}
          className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-60"
          style={primary}
        >
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
          {starting ? 'Starting render…' : `Confirm and render · ${credits(quote.credits)}`}
        </button>
      </div>
    </>
  );
}

function Refusal({ outcome, quoted, onConfirm, onRequote, onNewPhoto }: RenderPanelProps & { outcome: ApiOutcome; quoted: boolean }) {
  const box = (children: ReactNode, actions?: ReactNode) => (
    <>
      <div role="alert" className="flex gap-2 rounded-xl px-3 py-2 text-sm" style={danger}>
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
        <div>{children}</div>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </>
  );
  const button = (onClick: () => void, children: ReactNode, style: CSSProperties = secondary) => (
    <button type="button" onClick={onClick} className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold" style={style}>
      {children}
    </button>
  );
  switch (outcome.kind) {
    case 'insufficient_credits':
      return box(
        <>
          This render needs {outcome.needed !== null ? credits(outcome.needed) : 'more credits'}
          {outcome.available !== null ? `; you have ${credits(outcome.available)} available` : ''}. Nothing was charged.{' '}
          <Link href="/dashboard/billing" className="underline">Top up on the Billing page</Link>.
        </>,
        button(onRequote, <><RotateCcw className="h-4 w-4" /> Check again</>),
      );
    case 'moderation_blocked':
      return box(
        <>This photo can&apos;t be used: our content check blocked it. Try a different photo. Nothing was charged.</>,
        button(onNewPhoto, <><ImageOff className="h-4 w-4" /> Choose a different photo</>),
      );
    case 'revoice':
      return box(<>{outcome.message} Nothing was charged.</>);
    case 'already_rendered':
      return box(<>This draft has already been rendered into a Short. Re-voice the Script to make a new draft.</>);
    case 'draft_missing':
      return box(<>{outcome.message} Write a new Script to start again.</>);
    case 'busy':
    case 'retryable':
      if (!quoted) return box(<>{outcome.message}</>, button(onRequote, <><RotateCcw className="h-4 w-4" /> Try again</>));
      // Same confirmation, same Idempotency-Key: a repeat can never charge twice.
      return box(<>{outcome.message} Confirming again is safe: it can&apos;t start, or charge for, a second render.</>, button(onConfirm, <><RotateCcw className="h-4 w-4" /> Confirm again</>, primary));
    case 'resume_in_flight':
      return box(<>This draft is already rendering. Reload the page to follow it.</>);
    case 'error':
      return box(<>{cleanMessage(outcome.message)}</>, button(onRequote, <><RotateCcw className="h-4 w-4" /> Try again</>));
  }
}

function Progress({ view }: { view: Extract<RenderPhase, { phase: 'rendering' }>['view'] }) {
  const at = view ? RENDER_STAGES.findIndex((s) => s.stage === view.stage) : 0;
  return (
    <>
      <ol className="flex flex-col gap-2">
        {RENDER_STAGES.map((s, i) => {
          const done = i < at;
          const now = i === at;
          return (
            <li key={s.stage} className="flex items-center gap-2 text-sm" style={now ? { color: '#E9E9F0' } : done ? text : muted}>
              {done ? <Check className="h-4 w-4" style={{ color: '#34D399' }} /> : now ? <Loader2 className="h-4 w-4 animate-spin" style={{ color: '#A78BFA' }} /> : <span className="inline-block h-4 w-4 text-center">·</span>}
              {now && view ? view.label : s.label}
            </li>
          );
        })}
      </ol>
      <p className="text-xs" style={muted}>
        Rendering takes a few minutes. You can reload or leave this page: the render keeps going and this page picks it
        back up.
      </p>
    </>
  );
}

async function downloadShort(url: string, name: string) {
  // A cross-origin <a download> is ignored by browsers, so fetch the file and
  // save it; if the storage origin does not allow that, open it instead.
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    const href = URL.createObjectURL(await r.blob());
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

function Result({ runId, videoUrl, durationMs }: { runId: string; videoUrl: string; durationMs: number | null }) {
  const [saving, setSaving] = useState(false);
  return (
    <>
      <p className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm" style={good}>
        <Check className="h-4 w-4" /> Your Short is ready{durationMs ? ` · ${(durationMs / 1000).toFixed(1)} s` : ''}.
      </p>
      <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-2xl" style={{ aspectRatio: '9 / 16', backgroundColor: '#0F1015', border: '1px solid rgba(255,255,255,0.06)' }}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video src={videoUrl} controls playsInline className="h-full w-full object-contain" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await downloadShort(videoUrl, `product-hero-${runId.slice(0, 8)}.mp4`);
            setSaving(false);
          }}
          className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-60"
          style={primary}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download
        </button>
        <span className="text-xs" style={muted}>A draft renders once. To make another Short, edit the Script and re-voice it.</span>
      </div>
    </>
  );
}

function Failure({ canceled, moderation, message, onRetry, onNewPhoto }: { canceled: boolean; moderation: boolean; message: string | null; onRetry: () => void; onNewPhoto: () => void }) {
  const headline = moderation
    ? 'The video model refused this product photo. Try a different photo.'
    : canceled
      ? 'The render was canceled.'
      : 'The render failed.';
  return (
    <>
      <div role="alert" className="flex flex-col gap-1 rounded-xl px-3 py-2 text-sm" style={danger}>
        <span className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {headline}</span>
        {!moderation && !canceled && message ? <span className="text-xs opacity-80">{cleanMessage(message)}</span> : null}
      </div>
      <p className="text-sm" style={text}>
        <strong style={{ color: '#6EE7B7' }}>Credits refunded.</strong> Every credit charged for this render went back to
        your balance. Your draft is kept, so you can render it again.
      </p>
      <div className="flex flex-wrap gap-2">
        {moderation ? (
          <button type="button" onClick={onNewPhoto} className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold" style={primary}>
            <ImageOff className="h-4 w-4" /> Choose a different photo
          </button>
        ) : (
          <button type="button" onClick={onRetry} className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold" style={primary}>
            <RotateCcw className="h-4 w-4" /> Render this draft again
          </button>
        )}
      </div>
    </>
  );
}
