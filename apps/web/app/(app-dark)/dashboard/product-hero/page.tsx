// Copyright 2026 agent-media contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/product-hero — a Preset Short, end to end (#4, #6, #7, #8; Reaction #19).
 *
 *   Preset → Dialect → Photo → [Preset inputs] → Brief → Script review + voice preview → cost confirmation → render → Short
 *
 * Every Preset with a web flow (lib/preset-picker.ts WEB_FLOWS) runs through
 * this page and renders with its own skill (the picker's `skill`). Reaction adds
 * only its own inputs — the saved character who reacts, their gender and the
 * hijab option (components/reaction-character-picker.tsx, lib/reaction-flow.ts)
 * — which join the render request. Hands-on (#18) adds whose hands and the
 * setting (components/hands-on-inputs.tsx, lib/hands-on-flow.ts), shown from
 * the server's pick from the Product Details until the user changes them.
 *
 * The flow starts with the Preset picker (GET /v1/presets): each Preset with
 * every Dialect marked available (a Qualified Preset) or coming soon. Only
 * available Dialects can be picked; operators may also pick an unqualified one
 * the server marks as a reviewer sample. The list is re-read after a
 * PRESET_NOT_QUALIFIED refusal, so a withdrawn pair drops out
 * (lib/preset-picker.ts).
 *
 * Draft phase (free): Brief + Product Details + Dialect + Approved Voice → the
 * server writes a Script that sells the Product Details (plain dialect spelling,
 * Targeted Diacritics, a few Delivery Tags; ADR 0002) and voices it with that
 * Voice. The user reads the Script, hears it, edits it (adding a mark to a word
 * they hear misread, or an allowed Delivery Tag), and re-voices; every voicing
 * is a new draft, so
 * what they finally approve is exactly what renders. When the voiced Script
 * falls outside 5–15 s the server refuses the draft (SCRIPT_TOO_SHORT /
 * SCRIPT_TOO_LONG) and returns the Script, which lands in the editor; so does a
 * written Script that failed the Script check twice (SCRIPT_CHECK_FAILED). The
 * editor lists the allowed Delivery Tags and flags an unknown one (e.g. [wisper])
 * before it is sent, since the server refuses it (UNKNOWN_DELIVERY_TAG).
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
 * the error mapping and the key lifecycle are in lib/product-hero-flow.ts; the
 * reducer there is the single gate for Confirm.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ImagePlus, Loader2, Mic, Sparkles, X } from 'lucide-react';
import {
  classifyApiError,
  currentStep,
  DELIVERY_TAGS,
  formatDeliveryTags,
  initialRenderState,
  insertDeliveryTag,
  isRunSettled,
  parseDraftInUseReference, // #31
  parseQuote,
  PRODUCT_DETAILS_MAX,
  PRODUCT_INTERACTION_MAX,
  interactionEdit,
  isDraftEdited,
  quoteBody, // #9 Music Bed
  readFlowParams,
  renderBody, // #9 Music Bed
  renderReducer,
  runToResume,
  skillOf,
  startedRunId,
  unknownDeliveryTagMessage,
  unknownDeliveryTags,
  writeFlowParams,
  type ApiOutcome,
  type RenderChoice,
  type SkillRunBody,
} from '@/lib/product-hero-flow';
import { postJson } from '@/lib/post-json';
import {
  defaultDialect,
  defaultPreset,
  dialectChoices,
  parsePresets,
  WEB_FLOWS,
  type PresetPicker,
} from '@/lib/preset-picker';
import { PHOTO_ACCEPT, uploadProductPhoto } from '@/lib/product-hero-upload';
import { RenderPanel, Stepper } from '@/components/product-hero-render';
import { ReactionCharacterPicker } from '@/components/reaction-character-picker';
import { HandsOnInputs } from '@/components/hands-on-inputs'; // #18
import { ShotPlanReview } from '@/components/shot-plan-review'; // #26
import { ProductProfileFields } from '@/components/product-profile-fields'; // #30
import { InUseReferenceNote } from '@/components/in-use-reference-note'; // #31
import { isProfileEdited, profileEdit, profileFieldsOf, type ProductProfile, type ProfileFields } from '@/lib/product-profile-flow';
import { HANDS_ON_PRESET, NO_HANDS_ON_CHOICE, handsOnInputs, handsOnView, type HandsOnChoice } from '@/lib/hands-on-flow';
import {
  REACTION_PRESET,
  emptyReactionPick,
  parseCharacters,
  reactionInputs,
  reactionRefusalLine,
  type ReactionPick,
  type SavedCharacter,
} from '@/lib/reaction-flow';

/** A Dialect id as GET /v1/presets names it (levantine, gulf, …). */
type Dialect = string;

interface Draft {
  id: string;
  dialect: Dialect;
  brief: string | null;
  product_details?: string | null;
  /** How a real person uses the product (#25); used in hands and person shots. */
  product_interaction?: string | null;
  /** What the system understood about the product from its photo (#30); null without a photo. */
  product_profile?: ProductProfile | null;
  /** The product as it is used (#31): made when drafting, when the Profile says it differs from the photo. */
  in_use_reference?: unknown;
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

type Gender = 'female' | 'male';

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

const card = { border: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#14151F' } as const;
const field = { backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' } as const;
const label = 'text-[11px] uppercase tracking-wider';
const muted = { color: 'rgba(255,255,255,0.45)' } as const;

async function post(path: string, body: unknown): Promise<{ draft?: Draft; error?: ApiError }> {
  const r = await postJson(path, body);
  const j = (r.body ?? {}) as { draft?: Draft; error?: ApiError | string };
  if (r.status >= 200 && r.status < 300 && j.draft) return { draft: j.draft };
  const error = typeof j.error === 'string' ? { message: j.error } : j.error ?? { message: `HTTP ${r.status}` };
  return { error };
}

const GENDERS: Array<{ id: '' | Gender; label: string }> = [
  { id: '', label: 'Any gender' },
  { id: 'female', label: 'Female' },
  { id: 'male', label: 'Male' },
];

export default function ProductHeroPage() {
  const [brief, setBrief] = useState('');
  const [productDetails, setProductDetails] = useState('');
  const [picker, setPicker] = useState<PresetPicker | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [presetSlug, setPresetSlug] = useState<string | null>(null);
  const [dialect, setDialect] = useState<Dialect | null>(null);
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [styles, setStyles] = useState<string[]>([]);
  const [gender, setGender] = useState<'' | Gender>('');
  const [style, setStyle] = useState('');
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [script, setScript] = useState('');
  const [interaction, setInteraction] = useState('');
  // The Product Profile's key fields as the user edits them (#30); null = the draft has none.
  const [profileFields, setProfileFields] = useState<ProfileFields | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<Draft[]>([]);
  const [busy, setBusy] = useState<'write' | 'voice' | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<ApiOutcome | null>(null);
  const [rs, dispatch] = useReducer(renderReducer, initialRenderState);
  const photoInput = useRef<HTMLInputElement>(null);
  const scriptInput = useRef<HTMLTextAreaElement>(null);

  const preset = picker?.presets.find((p) => p.slug === presetSlug) ?? null;
  const isReaction = preset?.slug === REACTION_PRESET;
  const isHandsOn = preset?.slug === HANDS_ON_PRESET;
  // Hands-on (#18): whose hands and the setting, only once the user changes them.
  const [handsOn, setHandsOn] = useState<HandsOnChoice>(NO_HANDS_ON_CHOICE);
  const choices = dialectChoices(preset, picker?.operator ?? false);

  // Reaction (#19): the saved character who reacts, their gender, the hijab option.
  const [reactionPick, setReactionPick] = useState<ReactionPick>(emptyReactionPick);
  const [characters, setCharacters] = useState<SavedCharacter[] | null>(null);
  const [charactersError, setCharactersError] = useState<string | null>(null);
  useEffect(() => {
    if (!isReaction || characters !== null) return;
    void (async () => {
      try {
        const r = await fetch('/api/dashboard/characters', { credentials: 'include', cache: 'no-store' });
        const j = (await r.json().catch(() => ({}))) as unknown;
        const list = r.ok ? parseCharacters(j) : null;
        if (!list) throw new Error((j as { error?: ApiError })?.error?.message ?? `HTTP ${r.status}`);
        setCharacters(list);
      } catch (e) {
        setCharacters([]);
        setCharactersError((e as Error).message);
      }
    })();
  }, [isReaction, characters]);
  const sampleDialect = choices.find((c) => c.dialect === dialect)?.sample ?? false;

  /** The Preset picker: Presets and their Dialects, read fresh (a pair may be qualified or withdrawn any time). */
  const loadPresets = useCallback(async () => {
    setPickerError(null);
    try {
      const r = await fetch('/api/v1/presets', { credentials: 'include', cache: 'no-store' });
      const j = (await r.json().catch(() => ({}))) as unknown;
      const parsed = r.ok ? parsePresets(j) : null;
      if (!parsed) throw new Error((j as { error?: ApiError })?.error?.message ?? `HTTP ${r.status}`);
      setPicker(parsed);
      setPresetSlug((cur) => defaultPreset(parsed, cur)?.slug ?? null);
    } catch (e) {
      setPicker({ presets: [], operator: false });
      setPickerError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  // Keep the Dialect on one that can still be picked for this Preset. (A loaded
  // draft is re-voiced in its own Dialect; the server refuses that if the pair
  // has been withdrawn since.)
  const choiceKey = choices.map((c) => `${c.dialect}:${c.selectable}`).join(',');
  useEffect(() => {
    if (!picker) return;
    setDialect((cur) => defaultDialect(choices, cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- choiceKey stands for choices
  }, [picker, choiceKey]);

  /** Approved Voices of the Dialect under the current filters. Never cached. */
  const loadVoices = useCallback(async () => {
    setVoicesError(null);
    if (!dialect) {
      setVoices([]);
      return;
    }
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
    setInteraction(d.product_interaction ?? '');
    setProfileFields(profileFieldsOf(d.product_profile));
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
      setInteraction(d.product_interaction ?? '');
      setProfileFields(profileFieldsOf(d.product_profile));
      setHistory([d]);
      if (d.brief) setBrief(d.brief);
      if (d.product_details) setProductDetails(d.product_details);
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
    // The Preset was withdrawn for this Dialect since the picker loaded: refresh it.
    if (e.code === 'PRESET_NOT_QUALIFIED') void loadPresets();
    // A duration or Script-check refusal still hands back the Script: put it in the editor.
    if (e.script) setScript(e.script);
  }

  async function writeScript() {
    if (busy || !brief.trim() || !voiceId || !dialect) return;
    setBusy('write');
    setError(null);
    try {
      const r = await post('/api/v1/drafts/product-hero', {
        brief: brief.trim(),
        ...(productDetails.trim() ? { product_details: productDetails.trim() } : {}),
        dialect,
        voice_id: voiceId,
        // The uploaded photo: Claude reads it into the Product Profile (#30).
        ...(photo?.url ? { product_image_url: photo.url } : {}),
      });
      if (r.draft) accept(r.draft);
      else refuse(r.error!);
    } catch (e) {
      setError({ message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function revoice() {
    const spokenIn = draft ? draft.dialect : dialect;
    if (busy || !script.trim() || (!draft && !voiceId) || !spokenIn) return;
    setBusy('voice');
    setError(null);
    try {
      const r = await post('/api/v1/drafts/product-hero/revoice', {
        script: script.trim(),
        // A re-voice keeps its parent's Dialect; the server refuses any other.
        dialect: spokenIn,
        // The picked Voice; without one, a re-voice reuses the parent draft's Voice.
        ...(voiceId ? { voice_id: voiceId } : {}),
        // The Product Interaction only when the user changed it (#25); else the parent's carries over.
        ...interactionEdit(draft, interaction),
        // The Product Profile only when the user changed it (#30); else the parent's carries over.
        ...profileEdit(draft?.product_profile, profileFields),
        // With a parent, its Brief, Product Details, Product Profile and In-use Reference carry over
        // server-side; the photo is sent so another photo makes a new In-use Reference (#31).
        ...(draft
          ? { parent_draft_id: draft.id, ...(photo?.url ? { product_image_url: photo.url } : {}) }
          : {
              ...(brief.trim() ? { brief: brief.trim() } : {}),
              ...(productDetails.trim() ? { product_details: productDetails.trim() } : {}),
              ...(photo?.url ? { product_image_url: photo.url } : {}),
            }),
      });
      if (r.draft) accept(r.draft);
      else refuse(r.error!);
    } catch (e) {
      setError({ message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  /** Put `[tag] ` at the caret in the Script editor. */
  function addTag(tag: string) {
    const el = scriptInput.current;
    const next = insertDeliveryTag(script, tag, el?.selectionStart ?? script.length, el?.selectionEnd ?? script.length);
    setScript(next.script);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.caret, next.caret);
    });
  }

  const badTags = unknownDeliveryTags(script);
  const voiceChanged = !!draft && !!voiceId && voiceId !== draft.voice?.id;
  const edited = isDraftEdited({ draft, script, interaction, voiceChanged }) || isProfileEdited(draft?.product_profile, profileFields);
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

  // Music Bed (#9): on by default. It is part of the request: the quote is
  // asked with it (so the line under the toggle is the server's), and a change
  // withdraws the quote on screen, re-quotes, and makes the next Confirm a new
  // confirmation with a new Idempotency-Key.
  const [music, setMusic] = useState(true);
  const setMusicOn = (on: boolean) => {
    if (on === music) return;
    setMusic(on);
    dispatch({ type: 'invalidate_quote' });
  };

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
    else {
      // Reaction's own refusals (#19) in the page's words.
      const line = outcome.kind === 'error' ? reactionRefusalLine(outcome.code) : null;
      dispatch({ type: 'refused', outcome: line && outcome.kind === 'error' ? { ...outcome, message: line } : outcome });
    }
  }, [followDraftRun]);

  // Only the latest quote request may land (a toggle can race an answer).
  const quoteSeq = useRef(0);
  const requestQuote = useCallback(async (choice: RenderChoice) => {
    const seq = ++quoteSeq.current;
    dispatch({ type: 'quote_requested' });
    const r = await postJson(`/api/v1/skills/${skillOf(choice)}/quote`, quoteBody(choice));
    if (seq !== quoteSeq.current) return;
    const quote = r.status === 200 ? parseQuote(r.body) : null;
    if (quote) dispatch({ type: 'quote_loaded', quote });
    else handleRefusal(choice.draftId, classifyApiError(r.status, r.body));
  }, [handleRefusal]);

  // What would render now: the voiced draft, the photo and the toggles. The
  // quote, the Confirm and the run request all take this one object.
  const draftId = draft?.id ?? null;
  const photoUrl = photo?.url ?? null;
  // The Preset's skill and own fields (Reaction: character, gender, hijab) are
  // part of the request; a Reaction pick that is not complete cannot be priced.
  const skill = preset?.skill || undefined;
  const presetInputs = isReaction ? reactionInputs(reactionPick) : isHandsOn ? handsOnInputs(handsOn) : null;
  const presetInputsKey = JSON.stringify(presetInputs);
  // Shot Plan review (#26): the scene text the user changed, by shot id. A new
  // draft, Preset or Preset inputs is a new plan (its shots may differ): the
  // edits start over, and the panel is remounted (its key).
  const [shotEdits, setShotEdits] = useState<Record<string, Record<string, string>>>({});
  const planKey = `${draftId ?? ''}|${skill ?? ''}|${presetInputsKey}`;
  useEffect(() => {
    setShotEdits({});
  }, [planKey]);
  const shotEditsKey = JSON.stringify(shotEdits);
  // #31: "use original instead" of the In-use Reference; part of the request, so it re-quotes.
  const [useOriginalPhoto, setUseOriginalPhoto] = useState(false);
  const choice = useMemo<RenderChoice | null>(
    () => {
      if (!draftId || !photoUrl) return null;
      if (isReaction && !presetInputs) return null;
      return { draftId, photoUrl, music, skill, presetInputs, shotEdits, ...(useOriginalPhoto ? { useOriginalPhoto } : {}) };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- presetInputsKey / shotEditsKey stand for presetInputs / shotEdits
    [draftId, photoUrl, music, skill, isReaction, presetInputsKey, shotEditsKey, useOriginalPhoto],
  );

  // A different Preset, Reaction pick or scene edit is a different request:
  // withdraw the quote on screen and re-quote (the reducer leaves a running
  // render alone); the next Confirm is a new confirmation with a new key.
  const requestKey = `${skill ?? ''}|${presetInputsKey}|${shotEditsKey}|${useOriginalPhoto}`;
  useEffect(() => {
    dispatch({ type: 'invalidate_quote' });
  }, [requestKey]);

  // Price the render as soon as there is a voiced draft and a photo. Only a
  // quote is fetched here: nothing is charged until Confirm.
  useEffect(() => {
    if (render.phase !== 'idle' || !choice || edited) return;
    void requestQuote(choice);
  }, [render.phase, choice, edited, requestQuote]);

  // An unvoiced edit makes the quote on screen stale: withdraw it (the reducer
  // leaves a starting or running render alone). Undoing the edit re-quotes.
  useEffect(() => {
    if (edited) dispatch({ type: 'invalidate_quote' });
  }, [edited]);

  /** Ask the reducer to confirm; it is the only gate (see renderReducer 'confirm'). */
  function confirmRender() {
    if (!choice) return;
    dispatch({ type: 'confirm', choice, freshKey: crypto.randomUUID() });
  }

  // Start the render when — and only when — the reducer accepted a Confirm. The
  // key is the confirmation's: the same choice confirmed again after a network
  // blip sends the same key, so the server replays instead of charging twice; a
  // changed Music Bed choice is a new confirmation with a new key.
  const starting = render.phase === 'starting' ? rs.confirmation : null;
  useEffect(() => {
    if (!starting) return;
    const { choice: started, key } = starting;
    void (async () => {
      // aspect_ratio is left to the server's default: Product Hero is always 9:16.
      const r = await postJson(`/api/v1/skills/${skillOf(started)}/run`, renderBody(started), { 'Idempotency-Key': key });
      const runId = r.status === 202 ? startedRunId(r.body) : null;
      if (runId) {
        dispatch({ type: 'run_started', runId });
        syncUrl(started.draftId, runId);
      } else {
        handleRefusal(started.draftId, classifyApiError(r.status, r.body));
      }
    })();
  }, [starting, handleRefusal]);

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
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.4)' }}>{preset?.name ?? 'Product Hero'}</p>
        <h1 className="font-normal" style={{ color: '#E9E9F0', fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em', lineHeight: 1.05 }}>
          From product photo to Short
        </h1>
        <p className="mt-1 max-w-2xl text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
          Add a product photo, describe the ad in any language, and paste the product&apos;s details. We write a Script in
          your Dialect that sells those details and voice it so you can hear it first; drafts are free, and the Short must
          speak for 5–15 seconds. You see the price before anything is charged.
        </p>
      </div>
      <Stepper current={step} />

      {/* Preset picker, then the Dialects that Preset is qualified for */}
      <section className="mt-6 flex flex-col gap-3 rounded-2xl p-5" style={card}>
        <span className={label} style={muted}>Preset</span>
        {picker === null ? (
          <Loader2 className="h-4 w-4 animate-spin" style={muted} />
        ) : picker.presets.length === 0 ? (
          <p className="text-sm" style={{ color: pickerError ? '#FCA5A5' : 'rgba(255,255,255,0.6)' }}>
            {pickerError ? `Could not load Presets: ${pickerError}` : 'No Preset is available yet. Check back soon.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Preset">
            {picker.presets.map((p) => {
              const hasFlow = WEB_FLOWS.has(p.slug);
              const selected = p.slug === presetSlug;
              const offered = p.dialects.some((d) => d.status === 'available');
              return (
                <button
                  key={p.slug}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!hasFlow || renderLocked}
                  onClick={() => setPresetSlug(p.slug)}
                  className="flex flex-col gap-1 rounded-xl px-3 py-3 text-left disabled:cursor-not-allowed"
                  style={{ ...card, border: selected ? '1px solid #A78BFA' : card.border, opacity: hasFlow ? 1 : 0.55 }}
                >
                  <span className="text-sm font-semibold" style={{ color: '#E9E9F0' }}>
                    {p.name}
                    {!hasFlow ? <span className="ml-2 text-xs font-normal" style={muted}>coming soon</span> : null}
                    {hasFlow && !offered ? <span className="ml-2 text-xs font-normal" style={{ color: '#FBBF24' }}>not qualified yet</span> : null}
                  </span>
                  {p.summary ? <span className="text-xs" style={muted}>{p.summary}</span> : null}
                </button>
              );
            })}
          </div>
        )}
        {preset ? (
          <div className="flex flex-col gap-1">
            <label className={label} style={muted} htmlFor="dialect">Dialect</label>
            <select
              id="dialect"
              value={dialect ?? ''}
              disabled={renderLocked}
              onChange={(e) => setDialect(e.target.value)}
              className="h-10 w-full max-w-xs rounded-xl px-3 text-sm outline-none disabled:opacity-60"
              style={field}
            >
              {dialect === null ? <option value="">No Dialect available yet</option> : null}
              {choices.map((c) => (
                <option key={c.dialect} value={c.dialect} disabled={!c.selectable}>{c.label}</option>
              ))}
            </select>
            {sampleDialect ? (
              <p className="text-xs" style={{ color: '#FBBF24' }}>
                Reviewer sample: {preset.name} is not qualified for this Dialect. Only operators can draft and render it, to
                make samples for native reviewers.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Product photo */}
      <section className="mt-6 flex flex-col gap-3 rounded-2xl p-5" style={card}>
        <span className={label} style={muted}>Product photo</span>
        <input
          ref={photoInput}
          type="file"
          accept={PHOTO_ACCEPT}
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
            {photoBusy ? 'Uploading and checking…' : 'Upload a product photo (PNG or JPEG)'}
          </button>
        )}
        {photo ? (
          <InUseReferenceNote
            reference={parseDraftInUseReference(draft?.in_use_reference)}
            useOriginal={useOriginalPhoto}
            disabled={renderLocked}
            onUseOriginal={setUseOriginalPhoto}
          />
        ) : null}
        {photoError ? (
          <p role="alert" className="rounded-xl px-3 py-2 text-sm" style={{ border: '1px solid rgba(255,79,79,0.3)', backgroundColor: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>
            {photoError.kind === 'moderation_blocked'
              ? 'This photo was blocked by our content check. Try a different photo. Nothing was charged.'
              : 'message' in photoError ? photoError.message : 'The upload failed. Try again.'}
          </p>
        ) : null}
      </section>

      {isReaction ? (
        <ReactionCharacterPicker
          characters={characters}
          error={charactersError}
          pick={reactionPick}
          presetInputs={'quote' in render ? render.quote?.presetInputs : null}
          disabled={renderLocked}
          onChange={setReactionPick}
        />
      ) : null}

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
        <label className={label} style={muted} htmlFor="product-details">Product Details (optional)</label>
        <textarea
          id="product-details"
          value={productDetails}
          onChange={(e) => setProductDetails(e.target.value)}
          placeholder="Name, description, notes or ingredients, benefits. e.g. RUMI Royal Rituals, Eau de Parfum. Notes: Bergamot, Pink Pepper, Leather, Musk. Lasts all evening."
          maxLength={PRODUCT_DETAILS_MAX}
          rows={4}
          className="w-full resize-y rounded-xl px-3 py-2 text-sm outline-none"
          style={field}
        />
        <p className="-mt-1 text-xs" style={muted}>
          The facts the Script sells, in any language. Without them the Script can only work from the Brief.
        </p>
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
            disabled={!!busy || renderLocked || !brief.trim() || !voiceId || !dialect}
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
            ref={scriptInput}
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
          {/* Delivery Tags: the only bracketed text a Script may carry. */}
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs" style={muted}>Delivery Tags (never spoken):</span>
              {DELIVERY_TAGS.map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={renderLocked}
                  onClick={() => addTag(t)}
                  className="h-6 rounded-md px-2 font-mono text-[11px] disabled:opacity-60"
                  style={{ border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}
                >
                  {formatDeliveryTags([t])}
                </button>
              ))}
            </div>
            <p className="text-xs" style={muted}>
              A tag shapes how the words after it are spoken. If the voice misreads a word, add a mark to it (e.g. جِلد) and re-voice.
            </p>
            {badTags.length ? (
              <p role="alert" className="text-xs" style={{ color: '#FCA5A5' }}>
                {unknownDeliveryTagMessage(badTags)} Use one of the tags above, or remove it.
              </p>
            ) : null}
          </div>
          {/* Product Profile (#30): what the system understood about the product; editing it re-drafts. */}
          {draft?.product_profile && profileFields ? (
            <ProductProfileFields profile={draft.product_profile} fields={profileFields} disabled={renderLocked} onChange={setProfileFields} />
          ) : null}
          {/* Product Interaction (#25): how a real person uses the product, beside the Script. */}
          <div className="flex flex-col gap-1.5">
            <label className={label} style={muted} htmlFor="product-interaction">Product Interaction</label>
            <textarea
              id="product-interaction"
              dir="ltr"
              lang="en"
              value={interaction}
              onChange={(e) => setInteraction(e.target.value)}
              readOnly={renderLocked}
              maxLength={PRODUCT_INTERACTION_MAX}
              rows={2}
              placeholder="e.g. holds the uncapped bottle, sprays once on the inner wrist, sets the bottle down, then raises the wrist to the nose and smiles"
              className="w-full resize-y rounded-xl px-4 py-3 text-sm outline-none"
              style={field}
            />
            <p className="text-xs" style={muted}>
              How a real person uses your product on camera, in English. It guides the hands and person shots (Hands-on,
              Reaction), never the product shots, and never changes the modest styling or makes anyone speak. Editing it
              re-voices into a new draft, like editing the Script.
            </p>
          </div>
          {draft && !edited ? (
            // key: a new draft swaps the source, so remount the player.
            <audio key={draft.id} controls src={draft.audio_url} onError={() => onAudioError(draft)} className="w-full" />
          ) : null}
          <div>
            <button
              type="button"
              onClick={revoice}
              disabled={!!busy || renderLocked || !script.trim() || !edited || badTags.length > 0}
              className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-60"
              style={{ border: '1px solid rgba(167,139,250,0.5)', color: '#C9B8FF' }}
            >
              {busy === 'voice' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
              {busy === 'voice' ? 'Voicing…' : 'Re-voice'}
            </button>
          </div>
        </section>
      ) : null}

      {isHandsOn && draft ? (
        <HandsOnInputs
          view={handsOnView(handsOn, 'quote' in render ? render.quote?.presetInputs : null)}
          disabled={renderLocked}
          onHandGender={(g) => setHandsOn((cur) => ({ ...cur, handGender: g }))}
          onSetting={(s) => setHandsOn((cur) => ({ ...cur, setting: s }))}
        />
      ) : null}

      {choice && (render.phase === 'idle' || render.phase === 'quoting' || render.phase === 'quoted' || render.phase === 'refused') ? (
        <ShotPlanReview key={planKey} choice={choice} disabled={renderLocked || edited} onEdits={setShotEdits} />
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
        music={music}
        onMusicChange={setMusicOn}
        presetTodo={
          isReaction
            ? [!reactionPick.characterId ? 'pick a saved character' : null, !reactionPick.gender ? 'choose their gender' : null].filter(
                (t): t is string => !!t,
              )
            : undefined
        }
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
