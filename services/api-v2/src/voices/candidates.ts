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

import { VoiceError, type VoiceCandidate, type VoiceDeps, type VoiceDialect, type VoiceGender } from './catalog.js';

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

/** Shared-library browsing. Needs the Voices: Read permission on the ElevenLabs key. */
export function elevenLabsCandidateFinder(opts: { apiKey: string | undefined; apiBase?: string }): VoiceDeps['findCandidates'] {
  const base = (opts.apiBase ?? 'https://api.elevenlabs.io/v1').replace(/\/+$/, '');
  return async (page) => {
    if (!opts.apiKey) {
      throw new VoiceError(503, 'VOICE_PROVIDER_UNCONFIGURED', 'ElevenLabs is not configured on this server (missing ELEVENLABS_API_KEY).');
    }
    const response = await fetch(`${base}/shared-voices?language=ar&page_size=100&page=${page}`, {
      headers: { 'xi-api-key': opts.apiKey },
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
    return { candidates, has_more: Boolean(body.has_more), page };
  };
}
