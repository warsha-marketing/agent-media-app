// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Product Hero draft — the cheap phase before the cost gate (ADR 0001).
 *
 *   Brief + Dialect → Claude writes a fully diacritized dialect Script
 *                   → an ElevenLabs Voice speaks it, with character alignment
 *                   → the duration is MEASURED from the audio bytes
 *                   → 5–15 s of speech is a draft; anything else is refused.
 *
 * The draft is persisted so the render phase (#5) ships exactly the audio the
 * user heard: Script, audio object, duration and alignment are stored, never
 * recomputed. Re-voicing an edited Script always makes a NEW draft, so a draft
 * a render already used can never change underneath it.
 *
 * Drafting charges no credits. It costs us one Claude call and one or two TTS
 * calls, which is why it sits behind a per-user rate limit rather than the
 * credit preflight.
 *
 * Every provider is injected (DraftDeps) so the route tests run on fakes; the
 * real ones live in ./providers.ts.
 */

import { z } from 'zod';

// ── Vocabulary (CONTEXT.md) ──────────────────────────────────────────────────

/** Dialects a Product Hero draft can be requested in. Gulf is modelled now so
 *  it can be switched on (#8) without a schema change; it is refused until then. */
export const DIALECTS = ['levantine', 'gulf'] as const;
export type Dialect = (typeof DIALECTS)[number];
export const DialectSchema = z.enum(DIALECTS);

/** Dialects whose Script writing + Voice are live today. */
export const LIVE_DIALECTS: ReadonlySet<Dialect> = new Set<Dialect>(['levantine']);

export const PRESET = 'product_hero' as const;

/** The duration contract: a Product Hero Short speaks for 5–15 s. */
export const MIN_SPEECH_MS = 5_000;
export const MAX_SPEECH_MS = 15_000;

export const BRIEF_MAX_CHARS = 2_000;
/** Well above 15 s of speech (~40 words), well below a runaway TTS bill. */
export const SCRIPT_MAX_CHARS = 600;

export const CreateDraftInputSchema = z
  .object({
    brief: z.string().trim().min(1, 'brief is required').max(BRIEF_MAX_CHARS),
    dialect: DialectSchema,
  })
  .strict();
export type CreateDraftInput = z.infer<typeof CreateDraftInputSchema>;

export const RevoiceDraftInputSchema = z
  .object({
    script: z.string().trim().min(1, 'script is required').max(SCRIPT_MAX_CHARS),
    dialect: DialectSchema,
    /** Optional: the draft this edit came from. Its Brief carries over. */
    parent_draft_id: z.string().uuid().optional(),
    /** Only used when there is no parent (a first draft that was refused). */
    brief: z.string().trim().max(BRIEF_MAX_CHARS).optional(),
  })
  .strict();
export type RevoiceDraftInput = z.infer<typeof RevoiceDraftInputSchema>;

/** ElevenLabs character-level alignment, stored verbatim for Captions (#6). */
export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface DraftRow {
  id: string;
  user_id: string;
  preset: typeof PRESET;
  dialect: Dialect;
  brief: string | null;
  script: string;
  script_source: 'generated' | 'edited';
  parent_draft_id: string | null;
  voice_provider: 'elevenlabs';
  voice_id: string;
  tts_model: string;
  script_model: string | null;
  audio_key: string;
  audio_url: string;
  audio_mime: string;
  duration_ms: number;
  alignment: Alignment;
  created_at: string;
  rendered_at: string | null;
}

export type NewDraftRow = Omit<DraftRow, 'created_at' | 'rendered_at'>;

// ── Provider seam ────────────────────────────────────────────────────────────

export interface WriteScriptInput {
  brief: string;
  dialect: Dialect;
  /** Set on the one rewrite: what the last Script measured and which way to go. */
  previous?: { script: string; duration_ms: number; direction: 'shorten' | 'lengthen' };
}

export interface VoicedScript {
  audio: Buffer;
  mime: string;
  alignment: Alignment;
  voiceId: string;
  ttsModel: string;
}

export interface DraftDeps {
  writeScript(input: WriteScriptInput): Promise<{ script: string; model: string }>;
  voiceScript(input: { script: string; dialect: Dialect }): Promise<VoicedScript>;
  storeAudio(input: { userId: string; draftId: string; audio: Buffer; mime: string }): Promise<{ key: string; url: string }>;
  repo: {
    insert(row: NewDraftRow): Promise<DraftRow>;
    /** The draft only if `userId` owns it; null otherwise (never reveals existence). */
    getOwned(id: string, userId: string): Promise<DraftRow | null>;
  };
  newId(): string;
}

// ── Errors the UI and agent act on ───────────────────────────────────────────

export class DraftError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

function outOfBand(durationMs: number, script: string): DraftError {
  const secs = (durationMs / 1000).toFixed(1);
  const tooShort = durationMs < MIN_SPEECH_MS;
  return new DraftError(
    422,
    tooShort ? 'SCRIPT_TOO_SHORT' : 'SCRIPT_TOO_LONG',
    tooShort
      ? `The voiced Script runs ${secs} s; a Product Hero Short needs 5–15 s of speech. Lengthen the Script and re-voice.`
      : `The voiced Script runs ${secs} s; a Product Hero Short needs 5–15 s of speech. Shorten the Script and re-voice.`,
    {
      action: tooShort ? 'lengthen' : 'shorten',
      duration_ms: durationMs,
      min_ms: MIN_SPEECH_MS,
      max_ms: MAX_SPEECH_MS,
      script,
    },
  );
}

function assertLive(dialect: Dialect): void {
  if (!LIVE_DIALECTS.has(dialect)) {
    throw new DraftError(
      422,
      'DIALECT_NOT_AVAILABLE',
      `The ${dialect} Dialect is coming soon and cannot be drafted yet. Available: ${[...LIVE_DIALECTS].join(', ')}.`,
      { dialect, available: [...LIVE_DIALECTS] },
    );
  }
}

// ── Duration, measured from the audio ────────────────────────────────────────

const MPEG1_L3_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/**
 * Exact duration of an MPEG Layer III stream, by walking its frames.
 *
 * WHY not the alignment's last timestamp: that is where the last character ends,
 * not where the audio ends, and the render must trim visuals to the AUDIO. WHY not
 * bytes ÷ bitrate: it drifts with ID3 tags and VBR. Walking frames is exact and
 * needs no ffprobe in the API image. Returns 0 when the bytes are not MP3.
 */
export function mp3DurationMs(buf: Buffer): number {
  let i = 0;
  // ID3v2: 10-byte header, syncsafe size.
  if (buf.length >= 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    i = 10 + size + (buf[5] & 0x10 ? 10 : 0);
  }
  let seconds = 0;
  let first = true;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) { i += 1; continue; }
    const version = (buf[i + 1] >> 3) & 0x03; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (buf[i + 1] >> 1) & 0x03; // 1 = Layer III
    const brIdx = (buf[i + 2] >> 4) & 0x0f;
    const srIdx = (buf[i + 2] >> 2) & 0x03;
    const pad = (buf[i + 2] >> 1) & 0x01;
    if (version === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) { i += 1; continue; }
    const mpeg1 = version === 3;
    const kbps = (mpeg1 ? MPEG1_L3_KBPS : MPEG2_L3_KBPS)[brIdx];
    const rate = SAMPLE_RATES[version][srIdx];
    const samples = mpeg1 ? 1152 : 576;
    const len = Math.floor(((mpeg1 ? 144 : 72) * kbps * 1000) / rate) + pad;
    if (len < 4) { i += 1; continue; }
    // A leading Xing/Info frame carries encoder metadata, not speech.
    const tag = first ? buf.toString('latin1', i + 4, Math.min(i + len, buf.length)) : '';
    if (!(first && (tag.includes('Xing') || tag.includes('Info')))) seconds += samples / rate;
    first = false;
    i += len;
  }
  return Math.round(seconds * 1000);
}

// ── Diacritics sanity check on what Claude wrote ─────────────────────────────

const ARABIC_LETTER = /[ء-ي]/g;
const HARAKA = /[ً-ْ]/g;

/**
 * True when a Script looks fully diacritized. Long vowels (ا و ي) and a few
 * letters legitimately carry no mark, so "full" is not one mark per letter;
 * fewer than ~0.4 marks per letter means Claude skipped the تشكيل.
 */
export function looksDiacritized(script: string): boolean {
  const letters = script.match(ARABIC_LETTER)?.length ?? 0;
  const marks = script.match(HARAKA)?.length ?? 0;
  return letters > 0 && marks / letters >= 0.4;
}

// ── The two draft operations ─────────────────────────────────────────────────

interface Measured { voiced: VoicedScript; durationMs: number }

async function voiceAndMeasure(deps: DraftDeps, script: string, dialect: Dialect): Promise<Measured> {
  const voiced = await deps.voiceScript({ script, dialect });
  let durationMs = mp3DurationMs(voiced.audio);
  if (durationMs === 0) {
    // Not MP3 (a different output format was configured): fall back to the
    // alignment's end, which undercounts trailing silence by a few ms at most.
    durationMs = Math.round((voiced.alignment.character_end_times_seconds.at(-1) ?? 0) * 1000);
  }
  return { voiced, durationMs };
}

const inBand = (ms: number) => ms >= MIN_SPEECH_MS && ms <= MAX_SPEECH_MS;

async function persist(
  deps: DraftDeps,
  userId: string,
  fields: Pick<NewDraftRow, 'dialect' | 'brief' | 'script' | 'script_source' | 'parent_draft_id' | 'script_model'>,
  m: Measured,
): Promise<DraftRow> {
  const id = deps.newId();
  const stored = await deps.storeAudio({ userId, draftId: id, audio: m.voiced.audio, mime: m.voiced.mime });
  return deps.repo.insert({
    id,
    user_id: userId,
    preset: PRESET,
    ...fields,
    voice_provider: 'elevenlabs',
    voice_id: m.voiced.voiceId,
    tts_model: m.voiced.ttsModel,
    audio_key: stored.key,
    audio_url: stored.url,
    audio_mime: m.voiced.mime,
    duration_ms: m.durationMs,
    alignment: m.voiced.alignment,
  });
}

/**
 * Brief → Script → voice → draft. If the first voicing misses the 5–15 s band,
 * Claude gets ONE rewrite told the measured length and the direction; a second
 * miss is returned to the user (with the Script, so they can edit it).
 */
export async function createDraftFromBrief(deps: DraftDeps, userId: string, input: CreateDraftInput): Promise<DraftRow> {
  assertLive(input.dialect);
  let request: WriteScriptInput = { brief: input.brief, dialect: input.dialect };
  let last: { script: string; model: string; m: Measured } | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const written = await deps.writeScript(request);
    const script = written.script.trim();
    if (!script || script.length > SCRIPT_MAX_CHARS || !looksDiacritized(script)) {
      throw new DraftError(502, 'SCRIPT_GENERATION_FAILED', 'Could not write a diacritized Script for this Brief. Try again or rephrase the Brief.');
    }
    const m = await voiceAndMeasure(deps, script, input.dialect);
    last = { script, model: written.model, m };
    if (inBand(m.durationMs)) break;
    request = {
      ...request,
      previous: { script, duration_ms: m.durationMs, direction: m.durationMs > MAX_SPEECH_MS ? 'shorten' : 'lengthen' },
    };
  }
  const { script, model, m } = last!;
  if (!inBand(m.durationMs)) throw outOfBand(m.durationMs, script);
  return persist(deps, userId, {
    dialect: input.dialect,
    brief: input.brief,
    script,
    script_source: 'generated',
    parent_draft_id: null,
    script_model: model,
  }, m);
}

/** The user's (edited) Script, voiced verbatim, as a new draft. */
export async function revoiceDraft(deps: DraftDeps, userId: string, input: RevoiceDraftInput): Promise<DraftRow> {
  assertLive(input.dialect);
  let brief = input.brief?.trim() || null;
  if (input.parent_draft_id) {
    const parent = await deps.repo.getOwned(input.parent_draft_id, userId);
    if (!parent) throw new DraftError(404, 'NOT_FOUND', 'Draft not found.');
    brief = parent.brief;
  }
  const m = await voiceAndMeasure(deps, input.script, input.dialect);
  if (!inBand(m.durationMs)) throw outOfBand(m.durationMs, input.script);
  return persist(deps, userId, {
    dialect: input.dialect,
    brief,
    script: input.script,
    script_source: 'edited',
    parent_draft_id: input.parent_draft_id ?? null,
    script_model: null,
  }, m);
}

/** Public shape of a draft (what the API returns and the render phase reads). */
export function toDraftView(row: DraftRow) {
  return {
    id: row.id,
    preset: row.preset,
    dialect: row.dialect,
    brief: row.brief,
    script: row.script,
    script_source: row.script_source,
    parent_draft_id: row.parent_draft_id,
    voice: { provider: row.voice_provider, voice_id: row.voice_id, model: row.tts_model },
    audio_url: row.audio_url,
    audio_mime: row.audio_mime,
    duration_ms: row.duration_ms,
    alignment: row.alignment,
    created_at: row.created_at,
    rendered_at: row.rendered_at,
  };
}
