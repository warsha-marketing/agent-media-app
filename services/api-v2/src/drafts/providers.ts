// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The real providers behind DraftDeps: Claude writes the Script, ElevenLabs
 * voices it with character timestamps, R2 stores the audio, Supabase keeps the
 * draft row. Wired in server.ts; the route tests use fakes instead.
 *
 * Env:
 *   ANTHROPIC_API_KEY            (existing)
 *   PRODUCT_HERO_SCRIPT_MODEL    Claude model for Script writing (default claude-opus-5-5)
 *   ELEVENLABS_API_KEY           (existing)
 *   ELEVENLABS_API_BASE          (existing, optional)
 *   PRODUCT_HERO_VOICE_ID        the one pre-configured Voice until the catalog (#7)
 *   PRODUCT_HERO_TTS_MODEL       ElevenLabs model (default eleven_v3, as media-worker-v2)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { putPublicObject } from '../lib/r2-upload.js';
import {
  DraftError,
  MAX_SPEECH_MS,
  MIN_SPEECH_MS,
  type Alignment,
  type Dialect,
  type DraftDeps,
  type DraftRow,
  type NewDraftRow,
  type VoicedScript,
  type WriteScriptInput,
} from './product-hero-draft.js';
import { randomUUID } from 'node:crypto';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// ── Script writer (Claude) ───────────────────────────────────────────────────

const DIALECT_GUIDE: Record<Dialect, string> = {
  levantine:
    'Levantine Arabic (شامي — Syrian/Lebanese/Palestinian/Jordanian everyday speech). Use Levantine words and grammar ' +
    '(e.g. هَيْدا/هادا، شُو، كْتِير، هَلَّق، بِدَّك، رَح), never فصحى phrasing a native speaker would find stiff.',
  gulf:
    'Gulf Arabic (خليجي — Saudi/Emirati/Kuwaiti/Qatari everyday speech). Use Gulf words and grammar ' +
    '(e.g. وَايِد، شْلُون، الحِين، أَبِي، هَذَا), never فصحى phrasing a native speaker would find stiff.',
};

function systemPrompt(dialect: Dialect): string {
  return `You write the spoken voice-over Script for a short vertical product ad (a "Product Hero" Short). A synthetic voice will read your Script aloud exactly as written, over silent product visuals.

Write in ${DIALECT_GUIDE[dialect]}

The Brief may be in any language; it tells you what to sell, never the words to say. Write fresh copy in the dialect.

Length: the voice must speak for 8 to 12 seconds, which is about 18 to 28 words. Never under 5 seconds or over 15.

Diacritics: put full تشكيل on every word (fatha, damma, kasra, sukun, shadda, tanween) so the voice cannot mispronounce anything. Mark the dialect pronunciation, not the فصحى one.

Write brand and product names in Arabic letters as they are said. Write numbers and prices as words. No emojis, hashtags, Latin letters, stage directions, speaker labels, quotation marks or line breaks.

Reply with the Script only: one paragraph of diacritized Arabic, nothing before or after it.`;
}

function userPrompt(input: WriteScriptInput): string {
  const brief = `Brief:\n${input.brief}`;
  if (!input.previous) return brief;
  const secs = (input.previous.duration_ms / 1000).toFixed(1);
  return `${brief}

Your previous Script, voiced, ran ${secs} seconds, which is outside the ${MIN_SPEECH_MS / 1000}–${MAX_SPEECH_MS / 1000} second limit. ${
    input.previous.direction === 'shorten' ? 'Shorten' : 'Lengthen'
  } it to land at about 10 seconds. Previous Script:
${input.previous.script}`;
}

export function anthropicScriptWriter(opts: { apiKey: string; model: string }): DraftDeps['writeScript'] {
  return async (input) => {
    // Opus 5.5: thinking is always on (no `thinking` param, no temperature);
    // effort is the only dial and short copy does not need more than medium.
    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        system: systemPrompt(input.dialect),
        messages: [{ role: 'user', content: userPrompt(input) }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const data = (await upstream.json().catch(() => ({}))) as {
      stop_reason?: string;
      content?: Array<{ type?: string; text?: string }>;
      error?: { message?: string };
    };
    if (!upstream.ok) throw new Error(`anthropic ${upstream.status}: ${data.error?.message ?? 'no detail'}`);
    if (data.stop_reason === 'refusal') {
      throw new DraftError(422, 'BRIEF_REFUSED', 'This Brief cannot be turned into an ad Script. Rephrase the Brief.');
    }
    const script = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    return { script, model: opts.model };
  };
}

// ── Voice (ElevenLabs, with character timestamps) ────────────────────────────

export function elevenLabsVoicer(opts: {
  apiKey: string;
  voiceId: string;
  modelId: string;
  apiBase?: string;
}): DraftDeps['voiceScript'] {
  const base = (opts.apiBase ?? 'https://api.elevenlabs.io/v1').replace(/\/+$/, '');
  return async ({ script }): Promise<VoicedScript> => {
    const resp = await fetch(
      `${base}/text-to-speech/${encodeURIComponent(opts.voiceId)}/with-timestamps?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': opts.apiKey },
        // `alignment` (not `normalized_alignment`) is keyed to the text we sent,
        // so Captions can later map it back onto the Script character by character.
        body: JSON.stringify({ text: script, model_id: opts.modelId }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`elevenlabs ${resp.status}: ${detail.slice(0, 300)}`);
    }
    const data = (await resp.json()) as {
      audio_base64?: string;
      alignment?: Alignment | null;
      normalized_alignment?: Alignment | null;
    };
    const alignment = data.alignment ?? data.normalized_alignment;
    if (!data.audio_base64 || !alignment) throw new Error('elevenlabs: response missing audio or alignment');
    return {
      audio: Buffer.from(data.audio_base64, 'base64'),
      mime: 'audio/mpeg',
      alignment: {
        characters: alignment.characters,
        character_start_times_seconds: alignment.character_start_times_seconds,
        character_end_times_seconds: alignment.character_end_times_seconds,
      },
      voiceId: opts.voiceId,
      ttsModel: opts.modelId,
    };
  };
}

// ── Storage + table ──────────────────────────────────────────────────────────

export const r2DraftAudioStore: DraftDeps['storeAudio'] = async ({ userId, draftId, audio, mime }) => {
  // Same per-user namespace convention as uploads; the draft id makes it unguessable.
  const key = `vnext/drafts/${userId}/${draftId}.mp3`;
  const url = await putPublicObject(key, audio, mime);
  return { key, url };
};

const TABLE = 'short_drafts';

export function supabaseDraftRepo(supabase: SupabaseClient): DraftDeps['repo'] {
  return {
    async insert(row: NewDraftRow): Promise<DraftRow> {
      const { data, error } = await supabase.from(TABLE).insert(row).select('*').single();
      if (error || !data) throw new Error(`short_drafts insert: ${error?.message ?? 'no row'}`);
      return data as DraftRow;
    },
    async getOwned(id: string, userId: string): Promise<DraftRow | null> {
      // Service-role client bypasses RLS, so ownership is enforced here too.
      const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).eq('user_id', userId).maybeSingle();
      if (error) throw new Error(`short_drafts read: ${error.message}`);
      return (data as DraftRow | null) ?? null;
    },
  };
}

/**
 * Build the production deps. A host missing a provider key still serves GET
 * (the table only needs Supabase), but drafting answers 503 naming the missing
 * variable instead of half-working.
 */
export function productionDraftDeps(supabase: SupabaseClient): { deps: DraftDeps; missing: string[] } {
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const elevenKey = process.env.ELEVENLABS_API_KEY?.trim();
  const voiceId = process.env.PRODUCT_HERO_VOICE_ID?.trim();
  const missing = [
    !anthropicKey && 'ANTHROPIC_API_KEY',
    !elevenKey && 'ELEVENLABS_API_KEY',
    !voiceId && 'PRODUCT_HERO_VOICE_ID',
  ].filter(Boolean) as string[];
  const unconfigured = async (): Promise<never> => {
    throw new DraftError(503, 'DRAFTING_UNCONFIGURED', `Drafting is not configured on this server (missing ${missing.join(', ')}).`);
  };
  return {
    missing,
    deps: {
      writeScript: anthropicKey
        ? anthropicScriptWriter({
            apiKey: anthropicKey,
            model: process.env.PRODUCT_HERO_SCRIPT_MODEL?.trim() || 'claude-opus-5-5',
          })
        : unconfigured,
      voiceScript:
        elevenKey && voiceId
          ? elevenLabsVoicer({
              apiKey: elevenKey,
              voiceId,
              modelId: process.env.PRODUCT_HERO_TTS_MODEL?.trim() || 'eleven_v3',
              apiBase: process.env.ELEVENLABS_API_BASE?.trim() || undefined,
            })
          : unconfigured,
      storeAudio: r2DraftAudioStore,
      repo: supabaseDraftRepo(supabase),
      newId: () => randomUUID(),
    },
  };
}
