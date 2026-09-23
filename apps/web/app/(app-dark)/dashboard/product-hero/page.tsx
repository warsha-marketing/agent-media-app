// Copyright 2026 agent-media contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/product-hero — a Product Hero Short, end to end (#4, #6, #7).
 *
 *   Photo → Brief → Script review + voice preview → cost confirmation → render → Short
 *
 * Draft phase (free): Brief + Dialect + Approved Voice → the server writes a
 * fully diacritized Script and voices it with that Voice. The user reads the
 * Script, hears it, edits it, and re-voices; every voicing is a new draft, so
 * what they finally approve is exactly what renders. When the voiced Script
 * falls outside 5–15 s the server refuses the draft (SCRIPT_TOO_SHORT /
 * SCRIPT_TOO_LONG) and returns the Script, which lands in the editor.
 *
 * The Voice picker lists only Approved Voices of the chosen Dialect, re-read
 * whenever the Dialect or a filter changes and after a VOICE_NOT_APPROVED
 * refusal, so a revoked Voice drops out instead of lingering. Draft audio is
 * private: each response carries a short-lived signed `audio_url`; an expired
 * one is refreshed by re-reading the draft.
 *
 * Render phase (#6): the product photo goes straight from the browser to
 * storage and is moderated on upload (lib/product-hero-upload.ts). With a
 * voiced draft and a photo the page shows the make_product_hero quote; nothing
 * is charged until Confirm, which sends one Idempotency-Key per confirmation so
 * a double-click or a retried request replays instead of charging twice. The
 * draft and run ids live in the URL (?draft=…&run=…): a reload re-reads the
 * draft and resumes whichever run holds its render claim. The state machine,
 * the error mapping and the key lifecycle are in lib/product-hero-flow.ts.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ImagePlus, Loader2, Mic, Sparkles, X } from 'lucide-react';
import {
  classifyApiError,
  confirmationFor,
  currentStep,
  initialRenderState,
  isRunSettled,
  parseQuote,
  readFlowParams,
  renderReducer,
  runToResume,
  startedRunId,
  writeFlowParams,
  type ApiOutcome,
  type SkillRunBody,
} from '@/lib/product-hero-flow';
import { PHOTO_TYPES, uploadProductPhoto } from '@/lib/product-hero-upload';
import { RenderPanel, Stepper, cleanMessage } from './_render';

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
  voice: { id: string | null };
  created_at: string;
  /** The make_product_hero run holding this draft's render claim; null = free. */
  render_run_id?: string | null;
}

/** The product photo: a moderated, hosted URL (never bytes in page state). */
interface Photo {
  url: string;
  name: string;
}

const PHOTO_KEY = 'product-hero:photo';
const POLL_MS = 4000;
const SKILL = 'make_product_hero';

function savedPhoto(): Photo | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(PHOTO_KEY) ?? 'null') as Photo | null;
    return p && typeof p.url === 'string' && /^https:\/\//.test(p.url) ? p : null;
  } catch {
    return null;
  }
}

function savePhoto(p: Photo | null) {
  try {
    if (p) sessionStorage.setItem(PHOTO_KEY, JSON.stringify(p));
    else sessionStorage.removeItem(PHOTO_KEY);
  } catch {
    // Private mode: the photo just won't survive a reload.
  }
}

/** Keep ?draft / ?run in the address bar so a reload lands in the same place. */
function syncUrl(draftId: string | null, runId: string | null) {
  const search = writeFlowParams(window.location.search, { draftId, runId });
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}`);
}

async function readDraft(id: string): Promise<Draft | null> {
  const r = await fetch(`/api/v1/drafts/${encodeURIComponent(id)}`, { credentials: 'include', cache: 'no-store' }).catch(() => null);
  if (!r?.ok) return null;
  return ((await r.json().catch(() => ({}))) as { draft?: Draft }).draft ?? null;
}

async function postSkill(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  try {
    const r = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  } catch (e) {
    return { status: 0, body: { error: { code: 'network', message: (e as Error).message } } };
  }
}

type Gender = 'female' | 'male' | 'neutral';

/** An Approved Voice, as GET /v1/voices returns it. */
interface Voice {
  id: string;
  display_name: string;
  gender: Gender;
  style: string;
  sample_url: string;
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

const GENDERS: Array<{ id: '' | Gender; label: string }> = [
  { id: '', label: 'Any gender' },
  { id: 'female', label: 'Female' },
  { id: 'male', label: 'Male' },
  { id: 'neutral', label: 'Neutral' },
];

export default function ProductHeroPage() {
  const [brief, setBrief] = useState('');
  const [dialect, setDialect] = useState<Dialect>('levantine');
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [styles, setStyles] = useState<string[]>([]);
  const [gender, setGender] = useState<'' | Gender>('');
  const [style, setStyle] = useState('');
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [script, setScript] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<Draft[]>([]);
  const [busy, setBusy] = useState<'write' | 'voice' | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<ApiOutcome | null>(null);
  const [rs, dispatch] = useReducer(renderReducer, initialRenderState);
  const photoInput = useRef<HTMLInputElement>(null);
  /** Guards Confirm within one tick, before the reducer's 'starting' renders. */
  const startingRef = useRef(false);

  /** Approved Voices of the Dialect under the current filters. Never cached. */
  const loadVoices = useCallback(async () => {
    setVoicesError(null);
    const q = new URLSearchParams({ dialect });
    if (gender) q.set('gender', gender);
    if (style) q.set('style', style);
    try {
      const r = await fetch(`/api/v1/voices?${q}`, { credentials: 'include', cache: 'no-store' });
      const j = (await r.json().catch(() => ({}))) as { voices?: Voice[]; styles?: string[]; error?: ApiError };
      if (!r.ok) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
      const list = j.voices ?? [];
      setVoices(list);
      setStyles(j.styles ?? []);
      // A Voice that was revoked (or filtered out) cannot stay selected.
      setVoiceId((id) => (id && list.some((v) => v.id === id) ? id : null));
    } catch (e) {
      setVoices([]);
      setVoicesError((e as Error).message);
    }
  }, [dialect, gender, style]);

  useEffect(() => {
    void loadVoices();
  }, [loadVoices]);

  function accept(d: Draft) {
    setDraft(d);
    setScript(d.script);
    setHistory((h) => [d, ...h]);
    // A new draft needs its own quote; its URL is where a reload comes back to.
    dispatch({ type: 'reset' });
    syncUrl(d.id, null);
  }

  // ── Resume after a reload: the draft from ?draft, the run from its claim ──
  useEffect(() => {
    const params = readFlowParams(window.location.search);
    setPhoto(savedPhoto());
    if (!params.draftId) {
      if (params.runId) dispatch({ type: 'resume', runId: params.runId });
      return;
    }
    let live = true;
    void (async () => {
      const d = await readDraft(params.draftId!);
      if (!live) return;
      if (!d) {
        syncUrl(null, null);
        return;
      }
      setDraft(d);
      setScript(d.script);
      setHistory([d]);
      if (d.brief) setBrief(d.brief);
      setDialect(d.dialect);
      if (d.voice?.id) setVoiceId(d.voice.id);
      const runId = runToResume(params, d);
      if (runId) {
        dispatch({ type: 'resume', runId });
        syncUrl(d.id, runId);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

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
    // The Voice was revoked since the picker loaded: refresh it.
    if (e.code === 'VOICE_NOT_APPROVED') void loadVoices();
    // A duration refusal still hands back the Script: put it in the editor.
    if (e.script) setScript(e.script);
  }

  async function writeScript() {
    if (busy || !brief.trim() || !voiceId) return;
    setBusy('write');
    setError(null);
    try {
      const r = await post('/api/v1/drafts/product-hero', { brief: brief.trim(), dialect, voice_id: voiceId });
      if (r.draft) accept(r.draft);
      else refuse(r.error!);
    } catch (e) {
      setError({ message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function revoice() {
    if (busy || !script.trim() || (!draft && !voiceId)) return;
    setBusy('voice');
    setError(null);
    try {
      const r = await post('/api/v1/drafts/product-hero/revoice', {
        script: script.trim(),
        // A re-voice keeps its parent's Dialect; the server refuses any other.
        dialect: draft ? draft.dialect : dialect,
        // The picked Voice; without one, a re-voice reuses the parent draft's Voice.
        ...(voiceId ? { voice_id: voiceId } : {}),
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

  const voiceChanged = !!draft && !!voiceId && voiceId !== draft.voice?.id;
  const edited = draft ? script.trim() !== draft.script || voiceChanged : script.trim().length > 0;
  const render = rs.render;
  /** While a render starts or runs, the draft and photo on screen are the ones it uses. */
  const renderLocked = render.phase === 'starting' || render.phase === 'rendering';

  // ── Photo ──────────────────────────────────────────────────────────────
  async function pickPhoto(file: File) {
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      const r = await uploadProductPhoto(file);
      if (r.ok) {
        const p = { url: r.url, name: file.name };
        setPhoto(p);
        savePhoto(p);
        dispatch({ type: 'reset' });
      } else {
        setPhotoError(classifyApiError(r.status, r.body));
      }
    } finally {
      setPhotoBusy(false);
      if (photoInput.current) photoInput.current.value = '';
    }
  }

  function clearPhoto() {
    setPhoto(null);
    savePhoto(null);
    setPhotoError(null);
    dispatch({ type: 'reset' });
  }

  /** After a moderation block: drop the photo and open the picker. */
  function choosePhotoAgain() {
    clearPhoto();
    dispatch({ type: 'retry' });
    syncUrl(draft?.id ?? null, null);
    photoInput.current?.click();
  }

  // ── Render: quote → Confirm → progress → Short ─────────────────────────

  /** The draft is already rendering (or rendered): show that run instead of an error. */
  const followDraftRun = useCallback(async (draftId: string, outcome: ApiOutcome) => {
    const d = await readDraft(draftId);
    const runId = d?.render_run_id ?? null;
    if (runId) {
      dispatch({ type: 'resume', runId });
      syncUrl(draftId, runId);
    } else {
      dispatch({ type: 'refused', outcome });
    }
  }, []);

  const handleRefusal = useCallback((draftId: string, outcome: ApiOutcome) => {
    if (outcome.kind === 'resume_in_flight' || outcome.kind === 'already_rendered') void followDraftRun(draftId, outcome);
    else dispatch({ type: 'refused', outcome });
  }, [followDraftRun]);

  const requestQuote = useCallback(async (draftId: string, photoUrl: string) => {
    dispatch({ type: 'quote_requested' });
    const r = await postSkill(`/api/v1/skills/${SKILL}/quote`, { draft_id: draftId, product_image_url: photoUrl });
    const quote = r.status === 200 ? parseQuote(r.body) : null;
    if (quote) dispatch({ type: 'quote_loaded', quote });
    else handleRefusal(draftId, classifyApiError(r.status, r.body));
  }, [handleRefusal]);

  // Price the render as soon as there is a voiced draft and a photo. Only a
  // quote is fetched here: nothing is charged until Confirm.
  const draftId = draft?.id ?? null;
  const photoUrl = photo?.url ?? null;
  useEffect(() => {
    if (render.phase !== 'idle' || !draftId || !photoUrl || edited) return;
    void requestQuote(draftId, photoUrl);
  }, [render.phase, draftId, photoUrl, edited, requestQuote]);

  async function confirmRender() {
    // Confirmable: a fresh quote, or the same quote again after a network blip / busy server.
    const again = render.phase === 'refused' && !!render.quote && (render.outcome.kind === 'retryable' || render.outcome.kind === 'busy');
    if (!draft || !photo || edited || startingRef.current || (render.phase !== 'quoted' && !again)) return;
    startingRef.current = true;
    try {
      // Same (draft, photo) as the pending confirmation → same key → a replay, never a second charge.
      const { key } = confirmationFor(rs.confirmation, draft.id, photo.url, crypto.randomUUID());
      dispatch({ type: 'confirm', draftId: draft.id, photoUrl: photo.url, freshKey: key });
      const r = await postSkill(
        `/api/v1/skills/${SKILL}/run`,
        { draft_id: draft.id, product_image_url: photo.url, aspect_ratio: '9:16' },
        { 'Idempotency-Key': key },
      );
      const runId = r.status === 202 ? startedRunId(r.body) : null;
      if (runId) {
        dispatch({ type: 'run_started', runId });
        syncUrl(draft.id, runId);
      } else {
        handleRefusal(draft.id, classifyApiError(r.status, r.body));
      }
    } finally {
      startingRef.current = false;
    }
  }

  function retryRender() {
    dispatch({ type: 'retry' });
    syncUrl(draft?.id ?? null, null);
  }

  // Follow the run until it ends, and a failed run until its refund has landed.
  // Transient errors keep polling; the render itself carries on server-side
  // whatever this page does.
  const pollRunId =
    render.phase === 'rendering' || (render.phase === 'failed' && render.refund.status === 'pending') ? render.runId : null;
  useEffect(() => {
    if (!pollRunId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let done = false;
      try {
        const r = await fetch(`/api/v1/skills/runs/${encodeURIComponent(pollRunId)}`, { credentials: 'include', cache: 'no-store' });
        if (!live) return;
        if (r.status === 404) {
          dispatch({ type: 'refused', outcome: { kind: 'error', code: 'not_found', message: 'This render could not be found on your account.' } });
          syncUrl(draftId, null);
          return;
        }
        if (r.ok) {
          const run = (await r.json()) as SkillRunBody;
          if (!live) return;
          dispatch({ type: 'run_polled', runId: pollRunId, run });
          done = isRunSettled(run);
        }
      } catch {
        // network blip: try again
      }
      if (live && !done) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [pollRunId, draftId]);

  const step = currentStep({ hasPhoto: !!photo, hasDraft: !!draft, scriptEdited: !!draft && edited, render });

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-10">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.4)' }}>Product Hero</p>
        <h1 className="font-normal" style={{ color: '#E9E9F0', fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em', lineHeight: 1.05 }}>
          From product photo to Short
        </h1>
        <p className="mt-1 max-w-2xl text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
          Add a product photo and describe the ad in any language. We write a fully diacritized Script in your Dialect and
          voice it so you can hear it first; drafts are free, and the Short must speak for 5–15 seconds. You see the price
          before anything is charged.
        </p>
      </div>
      <Stepper current={step} />

      {/* Product photo */}
      <section className="mt-6 flex flex-col gap-3 rounded-2xl p-5" style={card}>
        <span className={label} style={muted}>Product photo</span>
        <input
          ref={photoInput}
          type="file"
          accept={PHOTO_TYPES.join(',')}
          className="hidden"
          aria-label="Product photo"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pickPhoto(f);
          }}
        />
        {photo ? (
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt="Your product photo" className="h-28 w-28 rounded-xl object-cover" style={{ border: '1px solid rgba(255,255,255,0.08)' }} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="truncate text-sm" style={{ color: '#E9E9F0' }}>{photo.name}</span>
              <span className="text-xs" style={muted}>Used as-is: the video is generated from this exact photo.</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={photoBusy || renderLocked}
                  onClick={() => photoInput.current?.click()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold disabled:opacity-60"
                  style={{ border: '1px solid rgba(167,139,250,0.5)', color: '#C9B8FF' }}
                >
                  {photoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} Replace
                </button>
                <button
                  type="button"
                  disabled={photoBusy || renderLocked}
                  onClick={clearPhoto}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs disabled:opacity-60"
                  style={{ border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}
                >
                  <X className="h-3.5 w-3.5" /> Remove
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={photoBusy}
            onClick={() => photoInput.current?.click()}
            className="flex h-28 flex-col items-center justify-center gap-1 rounded-xl text-sm disabled:opacity-60"
            style={{ border: '1px dashed rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)' }}
          >
            {photoBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
            {photoBusy ? 'Uploading and checking…' : 'Upload a product photo (PNG or JPEG, up to 25 MB)'}
          </button>
        )}
        {photoError ? (
          <p role="alert" className="rounded-xl px-3 py-2 text-sm" style={{ border: '1px solid rgba(255,79,79,0.3)', backgroundColor: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>
            {photoError.kind === 'moderation_blocked'
              ? 'This photo was blocked by our content check. Try a different photo. Nothing was charged.'
              : cleanMessage('message' in photoError ? photoError.message : 'The upload failed. Try again.')}
          </p>
        ) : null}
      </section>

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
        </div>

        {/* Voice picker: Approved Voices of the Dialect only */}
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-3">
            <span className={label} style={muted}>Voice</span>
            <select
              aria-label="Filter by gender"
              value={gender}
              onChange={(e) => setGender(e.target.value as '' | Gender)}
              className="h-8 rounded-lg px-2 text-xs outline-none"
              style={field}
            >
              {GENDERS.map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
            <select
              aria-label="Filter by delivery style"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="h-8 rounded-lg px-2 text-xs outline-none"
              style={field}
            >
              <option value="">Any style</option>
              {styles.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          {voices === null ? (
            <p className="text-xs" style={muted}>Loading voices…</p>
          ) : voicesError ? (
            <p className="text-xs" style={{ color: '#FCA5A5' }}>Could not load voices: {voicesError}</p>
          ) : voices.length === 0 ? (
            <p className="text-xs" style={muted}>
              {gender || style ? 'No Approved Voice matches these filters.' : 'No Approved Voices for this Dialect yet.'}
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Approved Voices">
              {voices.map((v) => {
                const selected = v.id === voiceId;
                return (
                  <li
                    key={v.id}
                    className="flex flex-col gap-2 rounded-xl px-3 py-2"
                    style={{ ...card, border: selected ? '1px solid #A78BFA' : card.border }}
                  >
                    <label className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: '#E9E9F0' }}>
                      <input
                        type="radio"
                        name="voice"
                        value={v.id}
                        checked={selected}
                        onChange={() => setVoiceId(v.id)}
                      />
                      <span className="flex-1">{v.display_name}</span>
                      <span className="text-xs" style={muted}>{v.gender} · {v.style}</span>
                    </label>
                    <audio controls preload="none" src={v.sample_url} className="h-8 w-full" />
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <button
            type="button"
            onClick={writeScript}
            disabled={!!busy || renderLocked || !brief.trim() || !voiceId}
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
            readOnly={renderLocked}
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
              disabled={!!busy || renderLocked || !script.trim() || !edited}
              className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-60"
              style={{ border: '1px solid rgba(167,139,250,0.5)', color: '#C9B8FF' }}
            >
              {busy === 'voice' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
              {busy === 'voice' ? 'Voicing…' : 'Re-voice'}
            </button>
          </div>
        </section>
      ) : null}

      <RenderPanel
        render={render}
        hasDraft={!!draft}
        hasPhoto={!!photo}
        edited={!!draft && edited}
        onConfirm={() => void confirmRender()}
        onRequote={retryRender}
        onRetry={retryRender}
        onNewPhoto={choosePhotoAgain}
      />

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
