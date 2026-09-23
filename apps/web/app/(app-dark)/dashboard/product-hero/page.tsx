// Copyright 2026 agent-media contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/product-hero — the draft phase of a Product Hero Short (#4).
 *
 * Brief + Dialect → the server writes a fully diacritized Script and voices it.
 * The user reads the Script, hears it, edits it, and re-voices; every voicing
 * is a new draft, so what they finally approve is exactly what renders later.
 * Nothing here costs credits: the cost gate comes after the draft (#5).
 *
 * When the voiced Script falls outside 5–15 s the server refuses the draft
 * (SCRIPT_TOO_SHORT / SCRIPT_TOO_LONG) and returns the Script, which lands in
 * the editor so the user can lengthen or shorten it and re-voice.
 *
 * Draft audio is private: each response carries a short-lived signed
 * `audio_url`. When a player's URL has lapsed it fails to load, and the page
 * re-reads that draft (GET /v1/drafts/:id) for a fresh one.
 */

import { useState } from 'react';
import { Loader2, Sparkles, Mic } from 'lucide-react';

type Dialect = 'levantine' | 'gulf';

interface Draft {
  id: string;
  dialect: Dialect;
  brief: string | null;
  script: string;
  /** Short-lived signed URL; re-read the draft for a fresh one. */
  audio_url: string;
  audio_url_expires_at: string;
  duration_ms: number;
  created_at: string;
}

interface ApiError {
  code?: string;
  message?: string;
  script?: string;
  duration_ms?: number;
}

const DIALECTS: Array<{ id: Dialect; label: string; live: boolean }> = [
  { id: 'levantine', label: 'Levantine', live: true },
  { id: 'gulf', label: 'Gulf (coming soon)', live: false },
];

const card = { border: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#14151F' } as const;
const field = { backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' } as const;
const label = 'text-[11px] uppercase tracking-wider';
const muted = { color: 'rgba(255,255,255,0.45)' } as const;

async function post(path: string, body: unknown): Promise<{ draft?: Draft; error?: ApiError }> {
  const r = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { draft?: Draft; error?: ApiError | string };
  if (r.ok && j.draft) return { draft: j.draft };
  const error = typeof j.error === 'string' ? { message: j.error } : j.error ?? { message: `HTTP ${r.status}` };
  return { error };
}

export default function ProductHeroPage() {
  const [brief, setBrief] = useState('');
  const [dialect, setDialect] = useState<Dialect>('levantine');
  const [script, setScript] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<Draft[]>([]);
  const [busy, setBusy] = useState<'write' | 'voice' | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  function accept(d: Draft) {
    setDraft(d);
    setScript(d.script);
    setHistory((h) => [d, ...h]);
  }

  /** Swap in a freshly signed audio URL for a draft whose URL has expired. */
  async function refreshAudio(id: string) {
    const r = await fetch(`/api/v1/drafts/${encodeURIComponent(id)}`, { credentials: 'include' }).catch(() => null);
    const fresh = r?.ok ? ((await r.json().catch(() => ({}))) as { draft?: Draft }).draft : undefined;
    if (!fresh) return;
    const withFreshUrl = (d: Draft) => (d.id === id ? { ...d, audio_url: fresh.audio_url, audio_url_expires_at: fresh.audio_url_expires_at } : d);
    setDraft((d) => (d ? withFreshUrl(d) : d));
    setHistory((h) => h.map(withFreshUrl));
  }

  /** An expired signed URL fails to load; fetch a new one (once per URL). */
  function onAudioError(d: Draft) {
    if (Date.parse(d.audio_url_expires_at) <= Date.now()) void refreshAudio(d.id);
  }

  function refuse(e: ApiError) {
    setError(e);
    // A duration refusal still hands back the Script: put it in the editor.
    if (e.script) setScript(e.script);
  }

  async function writeScript() {
    if (busy || !brief.trim()) return;
    setBusy('write');
    setError(null);
    try {
      const r = await post('/api/v1/drafts/product-hero', { brief: brief.trim(), dialect });
      if (r.draft) accept(r.draft);
      else refuse(r.error!);
    } catch (e) {
      setError({ message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function revoice() {
    if (busy || !script.trim()) return;
    setBusy('voice');
    setError(null);
    try {
      const r = await post('/api/v1/drafts/product-hero/revoice', {
        script: script.trim(),
        // A re-voice keeps its parent's Dialect; the server refuses any other.
        dialect: draft ? draft.dialect : dialect,
        ...(draft ? { parent_draft_id: draft.id } : brief.trim() ? { brief: brief.trim() } : {}),
      });
      if (r.draft) accept(r.draft);
      else refuse(r.error!);
    } catch (e) {
      setError({ message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const edited = draft ? script.trim() !== draft.script : script.trim().length > 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-10">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.4)' }}>Product Hero</p>
        <h1 className="font-normal" style={{ color: '#E9E9F0', fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em', lineHeight: 1.05 }}>
          Script and voice preview
        </h1>
        <p className="mt-1 max-w-2xl text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
          Describe the ad in any language. We write a fully diacritized Script in your Dialect and voice it so you can
          hear it before anything is rendered. Drafts are free; the Short must speak for 5–15 seconds.
        </p>
      </div>

      {/* Brief */}
      <section className="mt-8 flex flex-col gap-3 rounded-2xl p-5" style={card}>
        <label className={label} style={muted} htmlFor="brief">Brief</label>
        <textarea
          id="brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="e.g. A 10-second ad for our new cold brew: smooth, not bitter, 20% off this week."
          maxLength={2000}
          rows={3}
          className="w-full resize-y rounded-xl px-3 py-2 text-sm outline-none"
          style={field}
        />
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className={label} style={muted} htmlFor="dialect">Dialect</label>
            <select
              id="dialect"
              value={dialect}
              onChange={(e) => setDialect(e.target.value as Dialect)}
              className="h-10 rounded-xl px-3 text-sm outline-none"
              style={field}
            >
              {DIALECTS.map((d) => (
                <option key={d.id} value={d.id} disabled={!d.live}>{d.label}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={writeScript}
            disabled={!!busy || !brief.trim()}
            className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-60"
            style={{ backgroundColor: '#A78BFA', color: '#0F1015' }}
          >
            {busy === 'write' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy === 'write' ? 'Writing and voicing…' : draft ? 'Write a new Script' : 'Write Script'}
          </button>
        </div>
      </section>

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-2xl px-4 py-3 text-sm"
          style={{ border: '1px solid rgba(255,79,79,0.3)', backgroundColor: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}
        >
          {error.message ?? 'Something went wrong.'}
        </div>
      ) : null}

      {/* Script review */}
      {draft || script ? (
        <section className="mt-6 flex flex-col gap-3 rounded-2xl p-5" style={card}>
          <div className="flex items-center justify-between">
            <label className={label} style={muted} htmlFor="script">Script</label>
            {draft ? (
              <span className="text-xs" style={muted}>
                {(draft.duration_ms / 1000).toFixed(1)} s{edited ? ' · edited, re-voice to hear it' : ''}
              </span>
            ) : null}
          </div>
          <textarea
            id="script"
            dir="rtl"
            lang="ar"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            maxLength={600}
            rows={4}
            className="w-full resize-y rounded-xl px-4 py-3 outline-none"
            style={{ ...field, fontSize: 20, lineHeight: 1.9 }}
          />
          {draft && !edited ? (
            // key: a new draft swaps the source, so remount the player.
            <audio key={draft.id} controls src={draft.audio_url} onError={() => onAudioError(draft)} className="w-full" />
          ) : null}
          <div>
            <button
              type="button"
              onClick={revoice}
              disabled={!!busy || !script.trim() || !edited}
              className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-60"
              style={{ border: '1px solid rgba(167,139,250,0.5)', color: '#C9B8FF' }}
            >
              {busy === 'voice' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
              {busy === 'voice' ? 'Voicing…' : 'Re-voice'}
            </button>
          </div>
        </section>
      ) : null}

      {history.length > 1 ? (
        <section className="mt-6">
          <p className={label} style={muted}>Earlier drafts</p>
          <ul className="mt-2 flex flex-col gap-2">
            {history.slice(1).map((d) => (
              <li key={d.id} className="flex items-center gap-3 rounded-xl px-3 py-2" style={card}>
                <span dir="rtl" lang="ar" className="flex-1 truncate text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>{d.script}</span>
                <span className="text-xs" style={muted}>{(d.duration_ms / 1000).toFixed(1)} s</span>
                <audio controls src={d.audio_url} onError={() => onAudioError(d)} className="h-8 w-48" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
