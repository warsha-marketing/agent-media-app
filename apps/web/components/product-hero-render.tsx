// Copyright 2026 agent-media contributors. Apache-2.0 license.

'use client';

/**
 * The render half of /dashboard/product-hero (#6): the cost confirmation, the
 * render's progress, and the finished Short (or the failure, with its refund).
 * Presentational only: the state comes from lib/product-hero-flow.ts.
 */

import Link from 'next/link';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { AlertTriangle, Captions, Check, Clapperboard, Download, ImageOff, Loader2, RotateCcw } from 'lucide-react';
import { downloadUrl } from '@/lib/download-file';
import { CaptionEditor } from '@/components/caption-editor';
import { FLOW_STEPS, RENDER_STAGES, musicBedLine, type ApiOutcome, type FlowStep, type Quote, type RefundView, type RenderPhase } from '@/lib/product-hero-flow';

const card = { border: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#14151F' } as const;
const muted = { color: 'rgba(255,255,255,0.45)' } as const;
const text = { color: 'rgba(255,255,255,0.75)' } as const;
const label = 'text-[11px] uppercase tracking-wider';
const primary = { backgroundColor: '#A78BFA', color: '#0F1015' } as const;
const secondary = { border: '1px solid rgba(167,139,250,0.5)', color: '#C9B8FF' } as const;
const danger = { border: '1px solid rgba(255,79,79,0.3)', backgroundColor: 'rgba(255,79,79,0.08)', color: '#FCA5A5' } as const;
const good = { border: '1px solid rgba(52,211,153,0.3)', backgroundColor: 'rgba(52,211,153,0.08)', color: '#6EE7B7' } as const;

const credits = (n: number) => `${n} credit${n === 1 ? '' : 's'}`;

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
  /** Music Bed (#9): on by default; off = voice only, add a sound in TikTok. */
  music?: boolean;
  onMusicChange?: (on: boolean) => void;
  /** What the picked Preset still needs before it can be priced (e.g. Reaction: "pick a saved character"). */
  presetTodo?: string[];
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
        <Confirmation quote={r.quote} starting={r.phase === 'starting'} blocked={p.edited} onConfirm={p.onConfirm} music={p.music} onMusicChange={p.onMusicChange} />
      ) : null}
      {r.phase === 'refused' ? <Refusal outcome={r.outcome} quoted={!!r.quote} {...p} /> : null}
      {r.phase === 'rendering' ? <Progress view={r.view} /> : null}
      {r.phase === 'succeeded' ? <Result runId={r.runId} videoUrl={r.videoUrl} durationMs={r.durationMs} /> : null}
      {r.phase === 'failed' ? (
        <Failure canceled={r.canceled} moderation={r.moderation} message={r.message} refund={r.refund} onRetry={p.onRetry} onNewPhoto={p.onNewPhoto} />
      ) : null}
    </section>
  );
}

function Waiting({ hasDraft, hasPhoto, edited, presetTodo }: RenderPanelProps) {
  const todo = [
    !hasPhoto ? 'add a product photo' : null,
    ...(presetTodo ?? []),
    !hasDraft ? 'write and voice a Script' : edited ? 're-voice your edited Script' : null,
  ].filter(Boolean);
  return (
    <p className="text-sm" style={muted}>
      {todo.length ? `To see the price, ${todo.join(' and ')}.` : 'Getting ready…'}
    </p>
  );
}

function Confirmation({ quote, starting, blocked, onConfirm, music, onMusicChange }: { quote: Quote; starting: boolean; blocked: boolean; onConfirm: () => void; music?: boolean; onMusicChange?: (on: boolean) => void }) {
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
      {onMusicChange ? <MusicBedToggle music={music !== false} quote={quote} disabled={starting} onChange={onMusicChange} /> : null}
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

/** Music Bed on/off (#9), with its one-line explanation. It never changes the price. */
function MusicBedToggle({ music, quote, disabled, onChange }: { music: boolean; quote: Quote; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="inline-flex items-center gap-2 text-sm" style={text}>
        <input type="checkbox" checked={music} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[#A78BFA]" />
        Music Bed under the voice
      </label>
      <p className="text-xs" style={muted}>{musicBedLine(music, quote)}</p>
    </div>
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
          {outcome.message} Nothing was charged.{' '}
          <Link href="/dashboard/billing" className="underline">Go to Billing</Link>
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
      return box(<>{outcome.message}</>, button(onRequote, <><RotateCcw className="h-4 w-4" /> Try again</>));
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

function Result({ runId, videoUrl, durationMs }: { runId: string; videoUrl: string; durationMs: number | null }) {
  const [saving, setSaving] = useState(false);
  // Captions are added after the render (#22): the Short stays clean, and the
  // Caption editor previews, edits and exports them on the server.
  const [captioning, setCaptioning] = useState(false);
  return (
    <>
      <p className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm" style={good}>
        <Check className="h-4 w-4" /> Your Short is ready{durationMs ? ` · ${(durationMs / 1000).toFixed(1)} s` : ''}.
      </p>
      {captioning ? (
        <CaptionEditor shortId={runId} onClose={() => setCaptioning(false)} />
      ) : (
        <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-2xl" style={{ aspectRatio: '9 / 16', backgroundColor: '#0F1015', border: '1px solid rgba(255,255,255,0.06)' }}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={videoUrl} controls playsInline className="h-full w-full object-contain" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await downloadUrl(videoUrl, `product-hero-${runId.slice(0, 8)}.mp4`);
            setSaving(false);
          }}
          className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-60"
          style={captioning ? secondary : primary}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download{captioning ? ' without Captions' : ''}
        </button>
        {!captioning ? (
          <button type="button" onClick={() => setCaptioning(true)} className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold" style={secondary}>
            <Captions className="h-4 w-4" /> Add Captions
          </button>
        ) : null}
        <span className="text-xs" style={muted}>A draft renders once. To make another Short, edit the Script and re-voice it.</span>
      </div>
    </>
  );
}

/** The refund line, stated from the server's ledger — never assumed. */
function RefundNotice({ refund }: { refund: RefundView }) {
  switch (refund.status) {
    case 'refunded':
      return (
        <p className="text-sm" style={text}>
          <strong style={{ color: '#6EE7B7' }}>{credits(refund.refunded)} refunded.</strong> Everything charged for this
          render went back to your balance. Your draft is kept, so you can render it again.
        </p>
      );
    case 'pending':
      return (
        <p className="inline-flex items-center gap-2 text-sm" style={text}>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>
            <strong style={{ color: '#FCD34D' }}>Refund pending.</strong> {credits(refund.refunded)} of the{' '}
            {credits(refund.charged)} charged for this render are back so far; this updates when the rest lands.
          </span>
        </p>
      );
    case 'not_charged':
      return (
        <p className="text-sm" style={text}>
          <strong style={{ color: '#6EE7B7' }}>Nothing was charged</strong> for this render. Your draft is kept, so you can
          render it again.
        </p>
      );
    case 'unknown':
      return (
        <p className="text-sm" style={text}>
          We couldn&apos;t read this render&apos;s refund status just now. Check your balance on the{' '}
          <Link href="/dashboard/billing" className="underline">Billing page</Link>. Your draft is kept, so you can render it again.
        </p>
      );
  }
}

function Failure({ canceled, moderation, message, refund, onRetry, onNewPhoto }: { canceled: boolean; moderation: boolean; message: string | null; refund: RefundView; onRetry: () => void; onNewPhoto: () => void }) {
  const headline = moderation
    ? 'The video model refused this product photo. Try a different photo.'
    : canceled
      ? 'The render was canceled.'
      : 'The render failed.';
  return (
    <>
      <div role="alert" className="flex flex-col gap-1 rounded-xl px-3 py-2 text-sm" style={danger}>
        <span className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {headline}</span>
        {!moderation && !canceled && message ? <span className="text-xs opacity-80">{message}</span> : null}
      </div>
      <RefundNotice refund={refund} />
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
