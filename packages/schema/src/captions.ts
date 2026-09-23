// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Arabic Captions (#10, CONTEXT.md "Captions") — the words and their timing.
 *
 * Captions are timed from the voiced Script's TTS character alignment (the one
 * stored on the draft), never from speech-to-text: the words are exactly the
 * Script's, so a caption can never show a mis-transcription.
 *
 *   alignment ─ strip Delivery Tags ─ words (whitespace) ─ cues (short lines)
 *
 * Pure and deterministic: the worker's render workflow derives the cues from
 * the draft alignment inside the workflow sandbox, and the burn activity only
 * draws them.
 *
 * ── Diacritics on screen ─────────────────────────────────────────────────────
 * A Script carries Targeted Diacritics (ADR 0002): تشكيل only on the few words
 * a VOICE could misread. They are pronunciation hints for the TTS, not for the
 * reader — a native reader reads unmarked dialect spelling without effort, and
 * disambiguates جلد/مسك from context and from hearing the word at the same
 * moment. On screen, marks on two or three words out of fifteen read as
 * inconsistent, and at caption size with a heavy outline they crowd the line
 * (the marks sit above and below the letters, inside the outline). So captions
 * always show the Script's words without their تشكيل (owner decision, #10).
 * Letters are never changed: hamza forms (أ إ آ ؤ ئ ء), the maddah and the
 * tatweel stay.
 */

import { stripDeliveryTagsFromAlignment, type CharacterAlignment } from './delivery-tags.js';

export interface CaptionRules {
  /** Most words on one cue (a cue is one caption line). */
  maxWords: number;
  /** Most characters on one cue (as shown), so a line fits the 9:16 frame. A single longer word still gets a cue. */
  maxChars: number;
  /** A cue's words are spoken within about this long (first word's start to last word's end). */
  maxSeconds: number;
  /** A cue stays up at least this long when the next cue leaves room, so it can be read. */
  minSeconds: number;
  /** A silence at least this long between two words ends the cue. */
  pauseBreakSeconds: number;
  /** A gap between cues shorter than this is bridged (the earlier cue holds) so captions do not flicker. */
  bridgeSeconds: number;
}

/** The rules Arabic Captions are cut by: 3–4 words or ~1.8 s a line, whichever comes first. */
export const ARABIC_CAPTION_RULES: Readonly<CaptionRules> = {
  maxWords: 4,
  maxChars: 24,
  maxSeconds: 1.8,
  minSeconds: 0.8,
  pauseBreakSeconds: 0.45,
  bridgeSeconds: 0.25,
};

/** One spoken word as shown, with when it is spoken (seconds from the start of the audio). */
export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

/** One caption line: its words (in spoken order), the line as shown, and when it is on screen. */
export interface CaptionCue {
  words: string[];
  text: string;
  start: number;
  end: number;
}

/**
 * تشكيل marks: harakat, tanween, shadda, sukun (U+064B–U+0652), the extended
 * marks U+0656–U+065F, the dagger alif (U+0670) and the small honorific marks
 * (U+0610–U+061A). The maddah and combining hamza (U+0653–U+0655) are spelling,
 * not vowelling, and stay.
 */
const DIACRITICS = /[\u0610-\u061A\u064B-\u0652\u0656-\u065F\u0670]/g;

/** Arabic text without its تشكيل; letters, hamza forms, Latin and digits untouched. */
export function stripArabicDiacritics(text: string): string {
  return text.replace(DIACRITICS, '');
}

const WHITESPACE = /^\s+$/u;
const HAS_LETTER = /[\p{L}\p{N}]/u;
/** Punctuation that closes a clause: the cue ends after a word carrying it. */
const CLAUSE_END = /[.!?؟،,؛;:…]["'»”)\]]*$/u;

const ms = (s: number) => Math.round(s * 1000) / 1000;

/**
 * The spoken words of a voiced Script, from its TTS character alignment:
 * Delivery Tags stripped, split on whitespace, تشكيل removed (see the header),
 * each word timed from its first character's start to its last character's
 * end. Punctuation stays attached to its word; a token of punctuation alone
 * joins the word before it (or the one after it, at the start).
 */
export function captionWordsFromAlignment(alignment: CharacterAlignment): CaptionWord[] {
  const n = alignment.characters.length;
  if (alignment.character_start_times_seconds.length !== n || alignment.character_end_times_seconds.length !== n) {
    throw new RangeError(
      `alignment arrays disagree: ${n} characters, ${alignment.character_start_times_seconds.length} starts, ${alignment.character_end_times_seconds.length} ends`,
    );
  }
  const spoken = stripDeliveryTagsFromAlignment(alignment);

  const tokens: CaptionWord[] = [];
  let cur: CaptionWord | null = null;
  spoken.characters.forEach((ch, i) => {
    if (WHITESPACE.test(ch)) {
      cur = null;
      return;
    }
    const start = spoken.character_start_times_seconds[i];
    const end = spoken.character_end_times_seconds[i];
    if (!cur) {
      cur = { text: '', start, end };
      tokens.push(cur);
    }
    cur.text += ch;
    cur.end = Math.max(cur.end, end);
  });

  // Fold punctuation-only tokens into a neighbouring word.
  const words: CaptionWord[] = [];
  let pending: CaptionWord | null = null; // leading punctuation waiting for a word
  for (const t of tokens) {
    if (HAS_LETTER.test(t.text)) {
      if (pending) {
        words.push({ text: pending.text + t.text, start: pending.start, end: t.end });
        pending = null;
      } else words.push({ ...t });
    } else if (words.length) {
      const prev = words[words.length - 1];
      prev.text += t.text;
      prev.end = Math.max(prev.end, t.end);
    } else {
      pending = pending ? { text: pending.text + t.text, start: pending.start, end: t.end } : { ...t };
    }
  }

  return words
    .map((x) => ({
      text: stripArabicDiacritics(x.text),
      start: ms(x.start),
      end: ms(Math.max(x.start, x.end)),
    }))
    .filter((x) => x.text.trim() !== '');
}

/**
 * Group spoken words into caption cues. A cue takes the next word unless that
 * would exceed `maxWords`, `maxChars` or `maxSeconds` of speech, or a pause of
 * `pauseBreakSeconds` comes first; a cue also ends after clause punctuation.
 * A word is never split, so a single long word gets a cue of its own.
 *
 * Display time: a cue appears when its first word is spoken and stays until its
 * last word ends — held to at least `minSeconds` when the next cue leaves room,
 * bridged to the next cue across a gap under `bridgeSeconds`, never overlapping
 * the next cue, and never past `durationSeconds` (the Short's length) if given.
 */
export function groupCaptionCues(
  words: readonly CaptionWord[],
  opts: { rules?: Partial<CaptionRules>; durationSeconds?: number } = {},
): CaptionCue[] {
  const rules: CaptionRules = { ...ARABIC_CAPTION_RULES, ...opts.rules };
  const groups: CaptionWord[][] = [];
  let group: CaptionWord[] = [];
  for (const word of words) {
    if (group.length) {
      const first = group[0];
      const last = group[group.length - 1];
      const chars = group.map((x) => x.text).join(' ').length + 1 + word.text.length;
      const full =
        group.length >= rules.maxWords ||
        chars > rules.maxChars ||
        word.end - first.start > rules.maxSeconds ||
        word.start - last.end >= rules.pauseBreakSeconds ||
        CLAUSE_END.test(last.text);
      if (full) {
        groups.push(group);
        group = [];
      }
    }
    group.push(word);
  }
  if (group.length) groups.push(group);

  const limit = opts.durationSeconds;
  return groups.map((g, i) => {
    const start = g[0].start;
    const spokenEnd = g[g.length - 1].end;
    const next = groups[i + 1]?.[0].start;
    let end = Math.max(spokenEnd, start + rules.minSeconds);
    if (next !== undefined) {
      if (next - end < rules.bridgeSeconds) end = next;
      end = Math.min(end, next);
    }
    if (limit !== undefined) end = Math.min(end, limit);
    return { words: g.map((x) => x.text), text: g.map((x) => x.text).join(' '), start: ms(start), end: ms(end) };
  });
}

/** The caption cues of a voiced Script, straight from its TTS alignment (see the two steps above). */
export function captionCuesFromAlignment(
  alignment: CharacterAlignment,
  opts: { rules?: Partial<CaptionRules>; durationSeconds?: number } = {},
): CaptionCue[] {
  const words = captionWordsFromAlignment(alignment);
  return groupCaptionCues(words, opts);
}
