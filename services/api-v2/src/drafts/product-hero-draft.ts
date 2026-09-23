// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Product Hero draft — the cheap phase before the cost gate (ADR 0001).
 *
 *   Brief + Product Details + Dialect
 *                   → a writer (Claude) writes a Script in that Dialect: plain dialect
 *                     spelling with Targeted Diacritics and a few Delivery Tags (ADR 0002)
 *                   → the Script is checked (script-check.ts); one rewrite if it fails
 *                   → a Voice speaks it, with character alignment
 *                   → the duration is MEASURED from the audio bytes
 *                   → 5–15 s of speech is a draft; anything else is refused.
 *
 * The draft is persisted so the render phase (#5) ships exactly the audio the
 * user heard: Script, audio object key, duration and alignment are stored, never
 * recomputed. The audio is a private object: the owner hears it through a
 * short-lived signed URL minted on every read, and the render phase reads it by
 * key. Re-voicing an edited Script always makes a NEW draft (in its parent's
 * Dialect), so a draft a render already used can never change underneath it.
 *
 * Drafting charges no credits. It costs us one Claude call and one or two TTS
 * calls, which is why it sits behind a per-user rate limit rather than the
 * credit preflight.
 *
 * The Voice is the user's pick from the catalog (voices/, #7): it must be an
 * Approved Voice of the draft's Dialect at the moment of voicing, or the draft
 * is refused with VOICE_NOT_APPROVED before any provider is paid. The draft
 * stores which catalog Voice spoke it.
 *
 * Only a Qualified Preset (presets/, #8) is drafted: a Dialect Product Hero is
 * not qualified for is refused with PRESET_NOT_QUALIFIED before any provider is
 * paid, on create and re-voice alike, unless the caller is an operator making
 * reviewer samples.
 *
 * Product Details are the facts the Script sells (name, notes, ingredients,
 * benefits); they are stored on the draft and carried over on re-voice.
 * Delivery Tags are voiced only by a TTS model that honours them (eleven_v3);
 * with any other model they are stripped before voicing, and the draft stores
 * the Script exactly as it was spoken.
 *
 * Every provider is injected (DraftDeps) so the route tests run on fakes; the
 * real ones live in ./providers.ts.
 */

import { z } from 'zod';
import { DELIVERY_TAGS, SCRIPT_DIALECTS, formatDeliveryTags, modelHonoursDeliveryTags, stripDeliveryTags, type ScriptDialect } from '@agentmedia/schema';
import { generatedScriptIssues, scriptTextIssues, type ScriptIssue } from './script-check.js';
import { VoiceError, approvedVoiceFor, type VoiceDeps, type VoiceRow } from '../voices/catalog.js';
import { PresetError, assertPresetAvailable, type PresetAccess } from '../presets/qualification.js';

// ── Vocabulary (CONTEXT.md) ──────────────────────────────────────────────────

/** Dialects a Script can be written in (@agentmedia/schema SCRIPT_DIALECTS; each
 *  has a Dialect guide). Which of them a user may draft is a Qualified Preset
 *  question (presets/, #8). */
export type Dialect = ScriptDialect;
export const DialectSchema = z.enum(SCRIPT_DIALECTS);

export const PRESET = 'product_hero' as const;

/** The duration contract: a Product Hero Short speaks for 5–15 s. */
export const MIN_SPEECH_MS = 5_000;
export const MAX_SPEECH_MS = 15_000;

export const BRIEF_MAX_CHARS = 2_000;
/** Room for a full product page description (name, notes, ingredients, benefits). */
export const PRODUCT_DETAILS_MAX_CHARS = 3_000;
/** Well above 15 s of speech (~40 words), well below a runaway TTS bill. */
export const SCRIPT_MAX_CHARS = 600;

export const CreateDraftInputSchema = z
  .object({
    brief: z.string().trim().min(1, 'brief is required').max(BRIEF_MAX_CHARS),
    /** Optional: the facts the Script sells (name, description, notes or ingredients, benefits). */
    product_details: z.string().trim().max(PRODUCT_DETAILS_MAX_CHARS).optional(),
    dialect: DialectSchema,
    /** An Approved Voice of `dialect`, from GET /v1/voices. */
    voice_id: z.string().uuid(),
  })
  .strict();
export type CreateDraftInput = z.infer<typeof CreateDraftInputSchema>;

export const RevoiceDraftInputSchema = z
  .object({
    script: z.string().trim().min(1, 'script is required').max(SCRIPT_MAX_CHARS),
    /** With a parent, must equal the parent's Dialect (DIALECT_MISMATCH otherwise). */
    dialect: DialectSchema,
    /** Optional: the draft this edit came from. Its Brief and Dialect carry over. */
    parent_draft_id: z.string().uuid().optional(),
    /** Only used when there is no parent (a first draft that was refused). */
    brief: z.string().trim().max(BRIEF_MAX_CHARS).optional(),
    /** Only used when there is no parent; with one, the parent's Product Details carry over. */
    product_details: z.string().trim().max(PRODUCT_DETAILS_MAX_CHARS).optional(),
    /** An Approved Voice of `dialect`. Optional with a parent: the parent's Voice is reused. */
    voice_id: z.string().uuid().optional(),
  })
  .strict()
  .refine((v) => v.voice_id || v.parent_draft_id, { message: 'voice_id is required without a parent_draft_id', path: ['voice_id'] });
export type RevoiceDraftInput = z.infer<typeof RevoiceDraftInputSchema>;

/**
 * Character-level alignment of the voiced Script, stored verbatim for Captions (#10).
 * It includes the Delivery Tags' characters: strip them with
 * stripDeliveryTagsFromAlignment (@agentmedia/schema) before timing Captions.
 */
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
  /** The facts the Script sells; null when none were given. */
  product_details: string | null;
  script: string;
  script_source: 'generated' | 'edited';
  parent_draft_id: string | null;
  /** The catalog Voice (voices.id) that spoke it; null only on drafts from before the catalog. */
  voice_catalog_id: string | null;
  voice_provider: string;
  /** The provider's own voice id. */
  voice_id: string;
  tts_model: string;
  script_model: string | null;
  /** Private storage key; never returned to clients (they get a signed URL). */
  audio_key: string;
  audio_mime: string;
  duration_ms: number;
  alignment: Alignment;
  created_at: string;
  /** When a render of this draft first started (then it can never be deleted). */
  render_started_at: string | null;
  /** The skill run rendering it, or that rendered it; null = free to render. */
  render_run_id: string | null;
}

export type NewDraftRow = Omit<DraftRow, 'created_at' | 'render_started_at' | 'render_run_id'>;

// ── Provider seam ────────────────────────────────────────────────────────────

/** Which provider voice speaks: an Approved Voice's provider and provider id. */
export interface VoiceRef {
  provider: string;
  provider_voice_id: string;
}

/** A Script, the Dialect it is spoken in, and the Voice asked to say it. */
export interface SpokenScript {
  script: string;
  dialect: Dialect;
  voice: VoiceRef;
}

export interface WriteScriptInput {
  brief: string;
  /** The facts to sell; null = the Brief is all there is. */
  product_details: string | null;
  dialect: Dialect;
  /** Whether the voice honours Delivery Tags (eleven_v3); without, the writer adds none. */
  delivery_tags: boolean;
  /** Set on the duration rewrite: what the last Script measured and which way to go. */
  previous?: { script: string; duration_ms: number; direction: 'shorten' | 'lengthen' };
  /** Set on the check rewrite: the last Script and why the Script check refused it. */
  rejected?: { script: string; reasons: string[] };
}

export interface WrittenScript {
  script: string;
  /**
   * The words the writer used in the Script for the Product Details' nouns,
   * notes and ingredients that a voice could misread, as written in the Script
   * (with their marks); [] when none. The Script check holds each one to
   * Targeted Diacritics.
   */
  product_terms: string[];
  model: string;
}

export interface VoicedScript {
  audio: Buffer;
  mime: string;
  alignment: Alignment;
  /** Which voice provider spoke it (e.g. 'elevenlabs'); stored on the draft. */
  provider: string;
  voiceId: string;
  ttsModel: string;
}

/** A short-lived read URL for a draft's private audio. */
export interface SignedAudioUrl {
  url: string;
  expires_at: string;
}

export interface DraftDeps {
  writeScript(input: WriteScriptInput): Promise<WrittenScript>;
  voiceScript(input: SpokenScript): Promise<VoicedScript>;
  /** The TTS model voiceScript speaks with: decides whether Delivery Tags are voiced or stripped. */
  ttsModel: string;
  /** Store the audio as a PRIVATE object; returns only its key. */
  storeAudio(input: { userId: string; draftId: string; audio: Buffer; mime: string }): Promise<{ key: string }>;
  /** Mint a short-lived GET URL for a stored audio key. Call only for the owner. */
  signAudioUrl(key: string): Promise<SignedAudioUrl>;
  repo: {
    insert(row: NewDraftRow): Promise<DraftRow>;
    /** The draft only if `userId` owns it; null otherwise (never reveals existence). */
    getOwned(id: string, userId: string): Promise<DraftRow | null>;
  };
  /** The Voice catalog, read at voicing time so a revoked Voice is refused at once. */
  voices: Pick<VoiceDeps['repo'], 'get'>;
  /** Qualified Presets (#8), read per draft so a withdrawn pair is refused at once. */
  presets: PresetAccess;
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
    `The voiced Script runs ${secs} s; a Product Hero Short needs ${MIN_SPEECH_MS / 1000}–${MAX_SPEECH_MS / 1000} s of speech. ` +
      `${tooShort ? 'Lengthen' : 'Shorten'} the Script and re-voice.`,
    {
      action: tooShort ? 'lengthen' : 'shorten',
      duration_ms: durationMs,
      min_ms: MIN_SPEECH_MS,
      max_ms: MAX_SPEECH_MS,
      script,
    },
  );
}

/** The Approved Voice of `dialect` with this id, or VOICE_NOT_APPROVED. */
async function approvedVoice(deps: DraftDeps, voiceId: string, dialect: Dialect): Promise<VoiceRow> {
  try {
    return await approvedVoiceFor(deps.voices, voiceId, dialect);
  } catch (err) {
    if (err instanceof VoiceError) throw new DraftError(err.status, err.code, err.message, err.details);
    throw err;
  }
}

function voiceRef(voice: VoiceRow): VoiceRef {
  return { provider: voice.provider, provider_voice_id: voice.provider_voice_id };
}

/**
 * Only a Qualified Preset may be drafted (PRESET_NOT_QUALIFIED otherwise); an
 * operator may draft any pair, to make the sample Shorts native reviewers judge.
 */
async function assertQualified(deps: DraftDeps, userId: string, dialect: Dialect): Promise<void> {
  try {
    await assertPresetAvailable(deps.presets, userId, PRESET, dialect);
  } catch (err) {
    if (err instanceof PresetError) throw new DraftError(err.status, err.code, err.message, err.details);
    throw err;
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

// ── The Script check ─────────────────────────────────────────────────────────

/** A Script as the draft's voice will speak it: Delivery Tags only where the model honours them. */
function forVoice(deps: DraftDeps, script: string): string {
  return modelHonoursDeliveryTags(deps.ttsModel) ? script : stripDeliveryTags(script).trim();
}

/** What each refusal of an edited Script tells the user, most specific first. */
const EDIT_REFUSALS: ReadonlyArray<ScriptIssue['code']> = ['UNKNOWN_DELIVERY_TAG', 'SCRIPT_STRAY_BRACKETS', 'SCRIPT_NO_ARABIC'];

/**
 * A user's Script that failed the rules for every Script, refused before any
 * voicing. The error code is picked by issue code (EDIT_REFUSALS order), and
 * every issue rides along in `issues`.
 */
function refuseEditedScript(issues: ScriptIssue[]): DraftError {
  const code = EDIT_REFUSALS.find((c) => issues.some((i) => i.code === c)) ?? issues[0].code;
  const issue = issues.find((i) => i.code === code)!;
  if (code === 'UNKNOWN_DELIVERY_TAG') {
    return new DraftError(
      422,
      code,
      `${issue.message} Use one of the Delivery Tags ${formatDeliveryTags()}, or remove it.`,
      { tags: issue.found, allowed: [...DELIVERY_TAGS], issues },
    );
  }
  return new DraftError(422, code, issue.message, { found: issue.found, issues });
}

// ── The two draft operations ─────────────────────────────────────────────────

/** One voicing of a Script, with the duration measured from its audio. */
interface VoiceTake { spoken: SpokenScript; voiced: VoicedScript; durationMs: number; catalogVoiceId: string }

async function voiceAndMeasure(deps: DraftDeps, spoken: SpokenScript, catalogVoiceId: string): Promise<VoiceTake> {
  const voiced = await deps.voiceScript(spoken);
  let durationMs = mp3DurationMs(voiced.audio);
  if (durationMs === 0) {
    // Not MP3 (a different output format was configured): fall back to the
    // alignment's end, which undercounts trailing silence by a few ms at most.
    durationMs = Math.round((voiced.alignment.character_end_times_seconds.at(-1) ?? 0) * 1000);
  }
  return { spoken, voiced, durationMs, catalogVoiceId };
}

const inBand = (ms: number) => ms >= MIN_SPEECH_MS && ms <= MAX_SPEECH_MS;

function assertInBand(take: VoiceTake): void {
  if (!inBand(take.durationMs)) throw outOfBand(take.durationMs, take.spoken.script);
}

async function persist(
  deps: DraftDeps,
  userId: string,
  fields: Pick<NewDraftRow, 'brief' | 'product_details' | 'script_source' | 'parent_draft_id' | 'script_model'>,
  take: VoiceTake,
): Promise<DraftRow> {
  const id = deps.newId();
  const { voiced } = take;
  const stored = await deps.storeAudio({ userId, draftId: id, audio: voiced.audio, mime: voiced.mime });
  return deps.repo.insert({
    id,
    user_id: userId,
    preset: PRESET,
    ...fields,
    dialect: take.spoken.dialect,
    script: take.spoken.script,
    voice_catalog_id: take.catalogVoiceId,
    voice_provider: voiced.provider,
    voice_id: voiced.voiceId,
    tts_model: voiced.ttsModel,
    audio_key: stored.key,
    audio_mime: voiced.mime,
    duration_ms: take.durationMs,
    alignment: voiced.alignment,
  });
}

/** One writer call, trimmed, with its Script as the voice will speak it. */
async function write(deps: DraftDeps, request: WriteScriptInput): Promise<WrittenScript> {
  const written = await deps.writeScript(request);
  const script = forVoice(deps, written.script.trim());
  if (!script || script.length > SCRIPT_MAX_CHARS) {
    throw new DraftError(502, 'SCRIPT_GENERATION_FAILED', 'Could not write a Script for this Brief. Try again or rephrase the Brief.');
  }
  return { ...written, script };
}

/**
 * Ask the writer for a Script and hold it to the Script check (Arabic-only,
 * allowed Delivery Tags, Targeted Diacritics). A refused Script gets ONE
 * rewrite told why; a second refusal goes back to the user with the Script and
 * the reasons, so they can fix it in the editor and re-voice.
 */
async function writeChecked(deps: DraftDeps, request: WriteScriptInput): Promise<WrittenScript> {
  let written = await write(deps, request);
  let issues = generatedScriptIssues(written.script, written.product_terms);
  if (issues.length === 0) return written;
  written = await write(deps, { ...request, rejected: { script: written.script, reasons: issues.map((i) => i.message) } });
  issues = generatedScriptIssues(written.script, written.product_terms);
  if (issues.length === 0) return written;
  throw new DraftError(
    422,
    'SCRIPT_CHECK_FAILED',
    `The written Script did not pass the Script check: ${issues.map((i) => i.message).join(' ')} ` +
      'Fix it in the editor and re-voice, or add Product Details and write again.',
    { script: written.script, issues },
  );
}

/** Write a checked Script, then voice and measure it. */
async function writeAndVoice(deps: DraftDeps, request: WriteScriptInput, voice: VoiceRow): Promise<VoiceTake & { model: string }> {
  const written = await writeChecked(deps, request);
  const take = await voiceAndMeasure(deps, { script: written.script, dialect: request.dialect, voice: voiceRef(voice) }, voice.id);
  return { ...take, model: written.model };
}

/**
 * Brief → Script → voice → draft. If the first voicing misses the 5–15 s band,
 * the writer gets ONE rewrite told the measured length and the direction; a
 * second miss is returned to the user (with the Script, so they can edit it).
 */
export async function createDraftFromBrief(deps: DraftDeps, userId: string, input: CreateDraftInput): Promise<DraftRow> {
  await assertQualified(deps, userId, input.dialect);
  const voice = await approvedVoice(deps, input.voice_id, input.dialect);
  const productDetails = input.product_details?.trim() || null;
  const request: WriteScriptInput = {
    brief: input.brief,
    product_details: productDetails,
    dialect: input.dialect,
    delivery_tags: modelHonoursDeliveryTags(deps.ttsModel),
  };
  let take = await writeAndVoice(deps, request, voice);
  if (!inBand(take.durationMs)) {
    take = await writeAndVoice(deps, {
      ...request,
      previous: {
        script: take.spoken.script,
        duration_ms: take.durationMs,
        direction: take.durationMs > MAX_SPEECH_MS ? 'shorten' : 'lengthen',
      },
    }, voice);
  }
  assertInBand(take);
  return persist(deps, userId, {
    brief: input.brief,
    product_details: productDetails,
    script_source: 'generated',
    parent_draft_id: null,
    script_model: take.model,
  }, take);
}

/**
 * The user's (edited) Script, voiced verbatim, as a new draft. With a parent,
 * the Brief, Product Details and Dialect are the parent's: a request naming
 * another Dialect is refused rather than silently voiced in the wrong one.
 * Without a voice_id the parent's Voice speaks again, provided it is still an
 * Approved Voice.
 *
 * The user may add marks, Delivery Tags and Latin words (a brand as they spell
 * it) anywhere; a bracket must still hold an allowed Delivery Tag, so a typo
 * like [wisper] is refused (UNKNOWN_DELIVERY_TAG) instead of being spoken
 * aloud, as is a stray bracket (SCRIPT_STRAY_BRACKETS) or a Script with no
 * Arabic to speak (SCRIPT_NO_ARABIC).
 */
export async function revoiceDraft(deps: DraftDeps, userId: string, input: RevoiceDraftInput): Promise<DraftRow> {
  let brief = input.brief?.trim() || null;
  let productDetails = input.product_details?.trim() || null;
  let voiceId = input.voice_id ?? null;
  if (input.parent_draft_id) {
    const parent = await deps.repo.getOwned(input.parent_draft_id, userId);
    if (!parent) throw new DraftError(404, 'NOT_FOUND', 'Draft not found.');
    if (input.dialect !== parent.dialect) {
      throw new DraftError(
        422,
        'DIALECT_MISMATCH',
        `A re-voice keeps its parent draft's Dialect (${parent.dialect}); this request asked for ${input.dialect}. ` +
          'Send the same Dialect, or write a new Script from the Brief to change Dialect.',
        { dialect: input.dialect, parent_dialect: parent.dialect },
      );
    }
    brief = parent.brief;
    productDetails = parent.product_details ?? null;
    voiceId ??= parent.voice_catalog_id;
  }
  await assertQualified(deps, userId, input.dialect);
  const issues = scriptTextIssues(input.script);
  if (issues.length) throw refuseEditedScript(issues);
  if (!voiceId) {
    throw new DraftError(400, 'VOICE_REQUIRED', 'Pick an Approved Voice for this Dialect (voice_id) and re-voice.');
  }
  const voice = await approvedVoice(deps, voiceId, input.dialect);
  const take = await voiceAndMeasure(deps, { script: forVoice(deps, input.script), dialect: input.dialect, voice: voiceRef(voice) }, voice.id);
  assertInBand(take);
  return persist(deps, userId, {
    brief,
    product_details: productDetails,
    script_source: 'edited',
    parent_draft_id: input.parent_draft_id ?? null,
    script_model: null,
  }, take);
}

/**
 * Public shape of a draft (what the API returns). `audio` is a signed URL for
 * the owner, minted at read time; the storage key never leaves the server.
 */
export function toDraftView(row: DraftRow, audio: SignedAudioUrl) {
  return {
    id: row.id,
    preset: row.preset,
    dialect: row.dialect,
    brief: row.brief,
    product_details: row.product_details ?? null,
    script: row.script,
    script_source: row.script_source,
    parent_draft_id: row.parent_draft_id,
    voice: { id: row.voice_catalog_id, provider: row.voice_provider, provider_voice_id: row.voice_id, model: row.tts_model },
    audio_url: audio.url,
    audio_url_expires_at: audio.expires_at,
    audio_mime: row.audio_mime,
    duration_ms: row.duration_ms,
    alignment: row.alignment,
    created_at: row.created_at,
    render_started_at: row.render_started_at ?? null,
    render_run_id: row.render_run_id ?? null,
  };
}
export type DraftView = ReturnType<typeof toDraftView>;
