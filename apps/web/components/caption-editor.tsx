// Copyright 2026 agent-media contributors. Apache-2.0 license.

'use client';

/**
 * The Caption editor (#22) on a finished Short's result.
 *
 * The clean Short plays with the caption line of the moment drawn ON TOP as
 * HTML/CSS (dir="rtl", Noto Sans Arabic Bold): the browser does the Arabic
 * joining and the right-to-left layout, placed and sized in the same units as
 * the server's burn, so the preview matches the export. Every edit is instant;
 * nothing is rendered in the browser and no video is encoded here.
 *
 *   - edit a line's words, split it (at the caret) or merge it with the next;
 *   - nudge a line's start and end (held between its neighbours and inside the Short);
 *   - pick a position, a size and a colour from the whitelist;
 *   - Export Short with Captions: the lines and style go to the server, which
 *     burns them onto the clean Short (free, a few seconds) as a new file;
 *   - Download captions file: an .srt of the lines, made in the page.
 *
 * The logic is in lib/caption-editor.ts.
 */

import { Noto_Sans_Arabic } from 'next/font/google';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertTriangle, Check, Download, FileText, Loader2, Merge, Minus, Plus, RotateCcw, Scissors, Trash2, X } from 'lucide-react';
import {
  CAPTION_COLOURS,
  CAPTION_POSITIONS,
  CAPTION_SIZES,
  POSITION_LABELS,
  SHADOW_PX,
  SIZE_LABELS,
  exportBody,
  exportKeyFor,
  exportViewOf,
  lineAt,
  mergeWithNext,
  nudge,
  overlayStyle,
  parseSuggested,
  removeLine,
  setText,
  splitLine,
  toSrt,
  validateLines,
  type CaptionColour,
  type CaptionStyle,
  type EditorLine,
  type ExportKey,
  type LineIssue,
  type Suggested,
} from '@/lib/caption-editor';
import { apiErrorCode, apiErrorMessage } from '@/lib/product-hero-flow';
import { postJson } from '@/lib/post-json';
import { downloadText, downloadUrl } from '@/lib/download-file';

const arabic = Noto_Sans_Arabic({ subsets: ['arabic'], weight: ['700'], display: 'swap' });

const card = { border: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#0F1015' } as const;
const muted = { color: 'rgba(255,255,255,0.45)' } as const;
const text = { color: 'rgba(255,255,255,0.75)' } as const;
const primary = { backgroundColor: '#A78BFA', color: '#0F1015' } as const;
const secondary = { border: '1px solid rgba(167,139,250,0.5)', color: '#C9B8FF' } as const;
const danger = { border: '1px solid rgba(255,79,79,0.3)', backgroundColor: 'rgba(255,79,79,0.08)', color: '#FCA5A5' } as const;
const good = { border: '1px solid rgba(52,211,153,0.3)', backgroundColor: 'rgba(52,211,153,0.08)', color: '#6EE7B7' } as const;
const label = 'text-[11px] uppercase tracking-wider';

/** How far one nudge moves an edge. */
const NUDGE_S = 0.1;
const POLL_MS = 2000;

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; suggested: Suggested };

type ExportState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'running'; runId: string }
  | { phase: 'refused'; message: string; issues: LineIssue[] };

interface DoneExport {
  runId: string;
  videoUrl: string;
}

export function CaptionEditor({ shortId, onClose }: { shortId: string; onClose: () => void }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [lines, setLines] = useState<EditorLine[]>([]);
  const [style, setStyle] = useState<CaptionStyle | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await fetch(`/api/v1/shorts/${encodeURIComponent(shortId)}/captions`, { credentials: 'include', cache: 'no-store' }).catch(() => null);
      const body = r ? await r.json().catch(() => null) : null;
      if (!live) return;
      const suggested = r?.ok ? parseSuggested(body) : null;
      if (!suggested) {
        setLoad({ kind: 'error', message: apiErrorMessage(body) ?? 'Could not load the caption lines. Try again in a moment.' });
        return;
      }
      setLoad({ kind: 'ready', suggested });
      setLines(suggested.lines);
      setStyle(suggested.style);
    })();
    return () => {
      live = false;
    };
  }, [shortId]);

  if (load.kind === 'loading') {
    return (
      <p className="inline-flex items-center gap-2 text-sm" style={text}>
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the caption lines…
      </p>
    );
  }
  if (load.kind === 'error' || !style) {
    return (
      <div className="flex flex-col gap-2">
        <p role="alert" className="flex gap-2 rounded-xl px-3 py-2 text-sm" style={danger}>
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" /> {load.kind === 'error' ? load.message : 'Could not load the caption lines.'}
        </p>
        <div>
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center gap-2 rounded-xl px-3 text-sm" style={secondary}>
            <X className="h-4 w-4" /> Close
          </button>
        </div>
      </div>
    );
  }
  return (
    <Editor
      shortId={shortId}
      suggested={load.suggested}
      lines={lines}
      setLines={setLines}
      style={style}
      setStyle={setStyle}
      onClose={onClose}
    />
  );
}

function Editor(p: {
  shortId: string;
  suggested: Suggested;
  lines: EditorLine[];
  setLines: (l: EditorLine[]) => void;
  style: CaptionStyle;
  setStyle: (s: CaptionStyle) => void;
  onClose: () => void;
}) {
  const { shortId, suggested, lines, setLines, style, setStyle } = p;
  const duration = suggested.durationSeconds;
  const video = useRef<HTMLVideoElement>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const [active, setActive] = useState(-1);
  const issues = useMemo(() => validateLines(lines, duration), [lines, duration]);

  // The overlay follows the video: read currentTime every frame while it plays,
  // and on every seek; only a change of line re-renders.
  const linesRef = useRef(lines);
  linesRef.current = lines;
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let frame = 0;
    const sync = () => setActive(lineAt(linesRef.current, v.currentTime));
    const loop = () => {
      sync();
      if (!v.paused && !v.ended) frame = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(loop);
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('seeked', sync);
    v.addEventListener('timeupdate', sync);
    v.addEventListener('loadedmetadata', sync);
    return () => {
      cancelAnimationFrame(frame);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('seeked', sync);
      v.removeEventListener('timeupdate', sync);
      v.removeEventListener('loadedmetadata', sync);
    };
  }, []);
  // An edit can move the line under the playhead.
  useEffect(() => {
    if (video.current) setActive(lineAt(lines, video.current.currentTime));
  }, [lines]);

  const seek = (t: number) => {
    const v = video.current;
    if (v) v.currentTime = Math.min(duration, t + 0.001);
  };

  // ── Export ──────────────────────────────────────────────────────────────
  const [exp, setExp] = useState<ExportState>({ phase: 'idle' });
  const [done, setDone] = useState<DoneExport[]>([]);
  const lastKey = useRef<ExportKey | null>(null);
  // An edit answers a refusal: clear it.
  useEffect(() => {
    setExp((e) => (e.phase === 'refused' ? { phase: 'idle' } : e));
  }, [lines, style]);

  async function exportCaptions() {
    if (issues.length || exp.phase === 'starting' || exp.phase === 'running') return;
    const body = exportBody(lines, style);
    const k = exportKeyFor(lastKey.current, body, crypto.randomUUID());
    lastKey.current = k;
    setExp({ phase: 'starting' });
    const r = await postJson(`/api/v1/shorts/${encodeURIComponent(shortId)}/caption-exports`, body, { 'Idempotency-Key': k.key });
    const runId = r.status === 202 ? (r.body as { skill_run_id?: unknown } | null)?.skill_run_id : null;
    if (typeof runId === 'string') {
      setExp({ phase: 'running', runId });
      return;
    }
    const serverIssues = ((r.body as { error?: { issues?: unknown } } | null)?.error?.issues ?? []) as LineIssue[];
    if (apiErrorCode(r.body) === 'idempotency_key_reused') lastKey.current = null;
    setExp({ phase: 'refused', message: apiErrorMessage(r.body) ?? `The export could not start (HTTP ${r.status}).`, issues: Array.isArray(serverIssues) ? serverIssues : [] });
  }

  const runningId = exp.phase === 'running' ? exp.runId : null;
  useEffect(() => {
    if (!runningId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const r = await fetch(`/api/v1/skills/runs/${encodeURIComponent(runningId)}`, { credentials: 'include', cache: 'no-store' });
        if (!live) return;
        if (r.ok) {
          const view = exportViewOf(await r.json());
          if (!live) return;
          if (view.kind === 'succeeded') {
            setDone((d) => (d.some((x) => x.runId === runningId) ? d : [{ runId: runningId, videoUrl: view.videoUrl }, ...d]));
            setExp({ phase: 'idle' });
            return;
          }
          if (view.kind === 'failed') {
            lastKey.current = null; // that export is over: exporting again is a new one
            setExp({ phase: 'refused', message: view.message, issues: [] });
            return;
          }
        }
      } catch {
        // network blip: keep polling
      }
      if (live) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [runningId]);

  const busy = exp.phase === 'starting' || exp.phase === 'running';
  const current = active >= 0 ? lines[active] : null;
  const o = overlayStyle(style);
  const overlay: CSSProperties = {
    position: 'absolute',
    left: `${o.sidePct}%`,
    right: `${o.sidePct}%`,
    ...(o.bottomPct !== null ? { bottom: `${o.bottomPct}%` } : {}),
    ...(o.topPct !== null ? { top: `${o.topPct}%` } : {}),
    ...(o.centred ? { top: '50%', transform: 'translateY(-50%)' } : {}),
    textAlign: 'center',
    pointerEvents: 'none',
  };
  const textStyle = {
    fontSize: `${o.fontSizeCqh}cqh`,
    lineHeight: 1.25,
    color: o.color,
    // The burn's 6 px outline sits outside the glyph: a stroke twice as wide, painted under the fill.
    WebkitTextStroke: `${o.outlineCqh * 2}cqh #000`,
    paintOrder: 'stroke fill',
    textShadow: `${(SHADOW_PX / 1920) * 100}cqh ${(SHADOW_PX / 1920) * 100}cqh 0 rgba(0,0,0,0.5)`,
    textWrap: 'balance',
  } as CSSProperties;

  const issuesOf = (i: number) => issues.filter((x) => x.line === i);
  const setIssues = issues.filter((x) => x.line === null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        {/* The player with the live overlay */}
        <div
          className="relative mx-auto w-full max-w-[320px] flex-none overflow-hidden rounded-2xl"
          style={{ aspectRatio: '9 / 16', backgroundColor: '#0F1015', border: '1px solid rgba(255,255,255,0.06)', containerType: 'size' }}
        >
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={video} src={suggested.videoUrl} controls playsInline className="absolute inset-0 h-full w-full object-contain" />
          {current ? (
            <div style={overlay} aria-live="off">
              <span dir="rtl" lang="ar" className={arabic.className} style={textStyle}>
                {current.text}
              </span>
            </div>
          ) : null}
        </div>

        {/* Style */}
        <div className="flex flex-1 flex-col gap-3">
          <StylePicker style={style} onChange={setStyle} disabled={busy} />
          <p className="text-xs" style={muted}>
            The preview is drawn by your browser; the export is burned on our server in the same font, size and place.
            Captions are free.
          </p>
        </div>
      </div>

      {/* Lines */}
      <ol className="flex flex-col gap-2">
        {lines.map((l, i) => {
          const own = issuesOf(i);
          return (
            <li key={l.id} className="flex flex-col gap-1.5 rounded-xl p-2.5" style={{ ...card, borderColor: i === active ? 'rgba(167,139,250,0.6)' : own.length ? 'rgba(255,79,79,0.45)' : 'rgba(255,255,255,0.08)' }}>
              <div className="flex flex-wrap items-center gap-1.5 text-xs" style={muted}>
                <button type="button" onClick={() => seek(l.start)} className="rounded px-1.5 py-0.5 hover:underline" title="Play from here">
                  {i + 1}
                </button>
                <TimeNudge label="Start" value={l.start} disabled={busy} onMinus={() => setLines(nudge(lines, i, 'start', -NUDGE_S, duration))} onPlus={() => setLines(nudge(lines, i, 'start', NUDGE_S, duration))} />
                <span>→</span>
                <TimeNudge label="End" value={l.end} disabled={busy} onMinus={() => setLines(nudge(lines, i, 'end', -NUDGE_S, duration))} onPlus={() => setLines(nudge(lines, i, 'end', NUDGE_S, duration))} />
                <span className="ms-auto flex gap-1">
                  <IconButton title="Split at the cursor" disabled={busy} onClick={() => setLines(splitLine(lines, i, inputs.current.get(l.id)?.selectionStart ?? undefined))}>
                    <Scissors className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton title="Merge with the next line" disabled={busy || i === lines.length - 1} onClick={() => setLines(mergeWithNext(lines, i))}>
                    <Merge className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton title="Delete this line" disabled={busy || lines.length === 1} onClick={() => setLines(removeLine(lines, i))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </span>
              </div>
              <input
                ref={(el) => {
                  if (el) inputs.current.set(l.id, el);
                  else inputs.current.delete(l.id);
                }}
                dir="rtl"
                lang="ar"
                value={l.text}
                disabled={busy}
                onFocus={() => seek(l.start)}
                onChange={(e) => setLines(setText(lines, i, e.target.value))}
                aria-label={`Caption line ${i + 1}`}
                className={`${arabic.className} w-full rounded-lg bg-transparent px-2 py-1.5 text-base outline-none`}
                style={{ color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)' }}
              />
              {own.map((x) => (
                <span key={x.code} className="text-xs" style={{ color: '#FCA5A5' }}>{x.message}</span>
              ))}
            </li>
          );
        })}
      </ol>
      {setIssues.map((x) => (
        <p key={x.code} role="alert" className="rounded-xl px-3 py-2 text-sm" style={danger}>{x.message}</p>
      ))}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void exportCaptions()}
          disabled={busy || issues.length > 0}
          className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-60"
          style={primary}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {busy ? 'Exporting…' : 'Export Short with Captions'}
        </button>
        <button
          type="button"
          onClick={() => downloadText(toSrt(lines), `short-${shortId.slice(0, 8)}.srt`, 'application/x-subrip')}
          disabled={lines.length === 0}
          className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-60"
          style={secondary}
        >
          <FileText className="h-4 w-4" /> Download captions file (.srt)
        </button>
        <button type="button" onClick={() => setLines(suggested.lines)} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm disabled:opacity-60" style={muted}>
          <RotateCcw className="h-4 w-4" /> Reset lines
        </button>
        <button type="button" onClick={p.onClose} className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm" style={muted}>
          <X className="h-4 w-4" /> Close
        </button>
      </div>

      {exp.phase === 'running' ? (
        <p className="inline-flex items-center gap-2 text-sm" style={text}>
          <Loader2 className="h-4 w-4 animate-spin" /> Burning the Captions onto your Short. This takes a few seconds.
        </p>
      ) : null}
      {exp.phase === 'refused' ? (
        <div role="alert" className="flex flex-col gap-1 rounded-xl px-3 py-2 text-sm" style={danger}>
          <span className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {exp.message}</span>
          {exp.issues.slice(1).map((x, j) => (
            <span key={`${x.code}-${j}`} className="text-xs opacity-80">{x.message}</span>
          ))}
        </div>
      ) : null}
      {done.length ? (
        <ul className="flex flex-col gap-2">
          {done.map((d, j) => (
            <li key={d.runId} className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-sm" style={good}>
              <Check className="h-4 w-4" /> Short with Captions{done.length > 1 ? ` · version ${done.length - j}` : ''} is ready.
              <button
                type="button"
                onClick={() => void downloadUrl(d.videoUrl, `short-${shortId.slice(0, 8)}-captions-${done.length - j}.mp4`)}
                className="ms-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold"
                style={primary}
              >
                <Download className="h-3.5 w-3.5" /> Download
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function StylePicker({ style, onChange, disabled }: { style: CaptionStyle; onChange: (s: CaptionStyle) => void; disabled: boolean }) {
  const chip = (on: boolean): CSSProperties => ({
    border: `1px solid ${on ? '#A78BFA' : 'rgba(255,255,255,0.1)'}`,
    backgroundColor: on ? 'rgba(167,139,250,0.14)' : 'transparent',
    color: on ? '#E9E9F0' : 'rgba(255,255,255,0.6)',
  });
  return (
    <>
      <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
        <legend className={label} style={muted}>Position</legend>
        <div className="flex flex-wrap gap-1.5">
          {CAPTION_POSITIONS.map((pos) => (
            <button key={pos} type="button" aria-pressed={style.position === pos} onClick={() => onChange({ ...style, position: pos })} className="h-8 rounded-lg px-3 text-xs" style={chip(style.position === pos)}>
              {POSITION_LABELS[pos]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
        <legend className={label} style={muted}>Size</legend>
        <div className="flex flex-wrap gap-1.5">
          {CAPTION_SIZES.map((size) => (
            <button key={size} type="button" aria-pressed={style.size === size} onClick={() => onChange({ ...style, size })} className="h-8 w-10 rounded-lg text-xs" style={chip(style.size === size)}>
              {SIZE_LABELS[size]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
        <legend className={label} style={muted}>Colour</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(CAPTION_COLOURS) as CaptionColour[]).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={style.colour === c}
              aria-label={c}
              title={c}
              onClick={() => onChange({ ...style, colour: c })}
              className="h-8 w-8 rounded-full"
              style={{ backgroundColor: CAPTION_COLOURS[c], outline: style.colour === c ? '2px solid #A78BFA' : '1px solid rgba(0,0,0,0.6)', outlineOffset: 2 }}
            />
          ))}
        </div>
      </fieldset>
    </>
  );
}

function TimeNudge({ label: name, value, disabled, onMinus, onPlus }: { label: string; value: number; disabled: boolean; onMinus: () => void; onPlus: () => void }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <IconButton title={`${name} earlier`} disabled={disabled} onClick={onMinus}>
        <Minus className="h-3 w-3" />
      </IconButton>
      <span className="min-w-[3.2rem] text-center tabular-nums" style={text} aria-label={name}>{value.toFixed(2)} s</span>
      <IconButton title={`${name} later`} disabled={disabled} onClick={onPlus}>
        <Plus className="h-3 w-3" />
      </IconButton>
    </span>
  );
}

function IconButton({ title, disabled, onClick, children }: { title: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick} className="inline-flex h-6 w-6 items-center justify-center rounded-md disabled:opacity-40" style={{ border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}>
      {children}
    </button>
  );
}
