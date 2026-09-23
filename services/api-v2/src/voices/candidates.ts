// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Operator-only candidate finder: browses ElevenLabs' shared Arabic voices so an
 * operator can pick ones to send for native review. Ported from the prototype
 * preserved in commit c556541 (services/api-v2/src/lib/voices/library.ts).
 *
 * Users never see this list. A candidate becomes a Voice only when an operator
 * adds it to the catalog (pending), and an Approved Voice only after review.
 * The accent → Dialect mapping is a suggestion for the operator, nothing more.
 */

import {
  VoiceError,
  type CandidateSearch,
  type VoiceCandidate,
  type VoiceDeps,
  type VoiceDialect,
  type VoiceGender,
} from './catalog.js';

interface ProviderVoice {
  voice_id?: string;
  name?: string;
  description?: string;
  gender?: string;
  accent?: string;
  descriptive?: string;
  language?: string;
  labels?: Record<string, string>;
  preview_url?: string;
  verified_languages?: Array<{ language?: string; accent?: string; preview_url?: string }>;
}

/** Only public provider media, over https, without credentials. */
export function safeSampleUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const publicApiPreview =
      url.hostname === 'api.us.elevenlabs.io' && /^\/v1\/voices\/[a-zA-Z0-9_-]+\/previews\/audio$/.test(url.pathname);
    if (url.hostname !== 'storage.googleapis.com' && url.hostname !== 'cdn.elevenlabs.io' && !publicApiPreview) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** The provider's free-text accent, mapped to a Dialect when it clearly names one. */
export function suggestedDialect(accent: string): VoiceDialect | null {
  if (/levant|leban|syria|palestin|jordan/i.test(accent)) return 'levantine';
  if (/egypt/i.test(accent)) return 'egyptian';
  if (/saudi|gulf|emirat|kuwait|qatar|bahrain|oman|khaleej/i.test(accent)) return 'gulf';
  if (/morocc|algeri|tunis|maghreb|libya/i.test(accent)) return 'maghrebi';
  if (/standard|fusha|fus.ha|msa|classical/i.test(accent)) return 'msa';
  return null;
}

export function normalizeCandidate(voice: ProviderVoice): VoiceCandidate | null {
  if (!voice.voice_id || !/^[a-zA-Z0-9_-]{10,80}$/.test(voice.voice_id)) return null;
  const labels = voice.labels ?? {};
  const verified = voice.verified_languages?.find((v) => v.language === 'ar');
  const accent = voice.accent || labels.accent || verified?.accent || '';
  const rawGender = (voice.gender || labels.gender || '').toLowerCase();
  const gender: VoiceGender | null = rawGender === 'female' || rawGender === 'male' ? rawGender : null;
  const rawStyle = (voice.descriptive || labels.descriptive || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return {
    provider: 'elevenlabs',
    provider_voice_id: voice.voice_id,
    display_name: (voice.name || 'Arabic voice').slice(0, 80),
    description: (voice.description || '').slice(0, 600),
    gender,
    accent,
    suggested_dialect: suggestedDialect(accent),
    style: /^[a-z][a-z0-9-]{0,39}$/.test(rawStyle) ? rawStyle : null,
    sample_url: safeSampleUrl(verified?.preview_url || voice.preview_url),
  };
}

/**
 * The provider accent labels each Dialect covers. The shared library filters on
 * exactly one accent per request, so a Dialect filter asks for every label here.
 */
export const DIALECT_ACCENTS: Record<VoiceDialect, readonly string[]> = {
  levantine: ['levantine', 'lebanese', 'syrian', 'palestinian', 'jordanian'],
  gulf: ['gulf', 'saudi', 'emirati', 'kuwaiti', 'qatari', 'bahraini', 'omani'],
  egyptian: ['egyptian'],
  maghrebi: ['moroccan', 'algerian', 'tunisian', 'libyan'],
  msa: ['modern standard', 'standard'],
};

/** Voices the operator sees per page, split across the accents of a fanned-out Dialect. */
const PAGE_VOICES = 100;
const MIN_PER_ACCENT = 20;

/**
 * The shared-voices query strings for one candidate search: one per accent.
 * Always Arabic. A Dialect becomes one query per accent label, all for the same
 * page, each with an equal share of the page so a page stays about PAGE_VOICES.
 */
export function sharedVoiceQueries(q: CandidateSearch): string[] {
  const accents: Array<string | undefined> = q.dialect ? [...DIALECT_ACCENTS[q.dialect]] : [q.accent];
  const pageSize = Math.max(MIN_PER_ACCENT, Math.ceil(PAGE_VOICES / accents.length));
  return accents.map((accent) => {
    const p = new URLSearchParams({ language: 'ar', page_size: String(pageSize), page: String(q.page) });
    if (accent) p.set('accent', accent);
    if (q.gender) p.set('gender', q.gender);
    if (q.age) p.set('age', q.age);
    if (q.use_case) p.append('use_cases', q.use_case);
    if (q.search) p.set('search', q.search);
    if (q.sort) p.set('sort', q.sort);
    return p.toString();
  });
}

/** Round-robin across the per-accent pages so no one accent buries the rest; first sighting of a voice wins. */
export function mergeCandidatePages(pages: VoiceCandidate[][]): VoiceCandidate[] {
  const seen = new Set<string>();
  const merged: VoiceCandidate[] = [];
  const longest = Math.max(0, ...pages.map((p) => p.length));
  for (let i = 0; i < longest; i++) {
    for (const page of pages) {
      const c = page[i];
      if (!c || seen.has(c.provider_voice_id)) continue;
      seen.add(c.provider_voice_id);
      merged.push(c);
    }
  }
  return merged;
}

/**
 * Shared-library browsing. Needs the Voices: Read permission on the ElevenLabs key.
 *
 * A Dialect search runs one request per accent label in parallel (at most 7, for
 * Gulf) for the same page, merges them and drops duplicates; has_more is true
 * while any accent has more. Any failed request fails the whole search.
 */
export function elevenLabsCandidateFinder(opts: {
  apiKey: string | undefined;
  apiBase?: string;
  fetch?: typeof fetch;
}): VoiceDeps['findCandidates'] {
  const base = (opts.apiBase ?? 'https://api.elevenlabs.io/v1').replace(/\/+$/, '');
  const doFetch = opts.fetch ?? fetch;
  return async (query) => {
    const apiKey = opts.apiKey;
    if (!apiKey) {
      throw new VoiceError(503, 'VOICE_PROVIDER_UNCONFIGURED', 'ElevenLabs is not configured on this server (missing ELEVENLABS_API_KEY).');
    }
    const pages = await Promise.all(
      sharedVoiceQueries(query).map(async (qs) => {
        const response = await doFetch(`${base}/shared-voices?${qs}`, {
          headers: { 'xi-api-key': apiKey },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          const error = (await response.json().catch(() => ({}))) as { detail?: { status?: string } };
          if (error.detail?.status === 'missing_permissions') {
            throw new VoiceError(503, 'VOICE_READ_PERMISSION_REQUIRED', 'Browsing voices needs the Voices: Read permission on the ElevenLabs key.');
          }
          throw new VoiceError(502, 'VOICE_PROVIDER_UNAVAILABLE', 'The provider voice library is unavailable. Try again.');
        }
        const body = (await response.json()) as { voices?: ProviderVoice[]; has_more?: boolean };
        const candidates = (body.voices ?? []).map(normalizeCandidate).filter((v): v is VoiceCandidate => v !== null);
        return { candidates, has_more: Boolean(body.has_more) };
      }),
    );
    return {
      candidates: mergeCandidatePages(pages.map((p) => p.candidates)),
      has_more: pages.some((p) => p.has_more),
      page: query.page,
    };
  };
}
