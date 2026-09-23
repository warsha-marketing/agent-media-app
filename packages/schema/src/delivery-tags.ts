// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Delivery Tags — bracketed directions inside a Script (CONTEXT.md, ADR 0002).
 *
 *   "[softly] برغموت، فلفل زهري، جِلد ومِسك."
 *
 * A Delivery Tag shapes how the next words are spoken. It is never spoken and
 * never shown in Captions. `eleven_v3` treats tags as direction; any other TTS
 * model would read them aloud, so they are stripped before voicing there.
 *
 * ⚠ This file holds THE allowed list. The Script-writing prompt, the Script
 * validator (api-v2) and the draft API all read DELIVERY_TAGS from here; the
 * web Script editor keeps a mirror (apps/web/lib/product-hero-flow.ts) that
 * scripts/tests/delivery-tags-parity.test.ts holds equal to this one.
 *
 * The strip helpers are for Captions (#10) and for any display of a Script to
 * viewers: the TTS character alignment includes the tag characters, so the
 * alignment is stripped by the same rule as the text, keeping every remaining
 * character's timing.
 */

/**
 * The allowed Delivery Tags. Deliberately small: each one was chosen because
 * `eleven_v3` honours it as direction (the first live Product Hero test used
 * confidently / softly / warmly / excited). A typo like [wisper] is not a tag
 * and would be spoken aloud, so it is refused rather than guessed at.
 */
export const DELIVERY_TAGS = [
  'softly',
  'whispers',
  'warmly',
  'excited',
  'confidently',
  'laughs',
  'sighs',
  'curious',
  'calm',
  'cheerfully',
] as const;
export type DeliveryTag = (typeof DELIVERY_TAGS)[number];

/** TTS models that treat a Delivery Tag as direction instead of speech. */
export const DELIVERY_TAG_MODELS: readonly string[] = ['eleven_v3'];

export function modelHonoursDeliveryTags(ttsModel: string): boolean {
  return DELIVERY_TAG_MODELS.includes(ttsModel);
}

const ALLOWED = new Set<string>(DELIVERY_TAGS);

/** Is `name` (the text between the brackets) an allowed Delivery Tag? Case and surrounding spaces are forgiven. */
export function isDeliveryTag(name: string): name is DeliveryTag {
  return ALLOWED.has(name.trim().toLowerCase());
}

/** One bracketed segment of a Script: `[name]` at [start, end). */
export interface BracketedSegment {
  name: string;
  start: number;
  end: number;
}

/** Every `[…]` segment in a Script (no nesting, no line breaks inside). */
export function bracketedSegments(script: string): BracketedSegment[] {
  const out: BracketedSegment[] = [];
  for (const m of script.matchAll(/\[([^[\]\n]*)\]/g)) {
    out.push({ name: m[1], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** The bracketed segments of a Script that are NOT allowed Delivery Tags, as written (e.g. "[wisper]"). */
export function unknownDeliveryTags(script: string): string[] {
  return bracketedSegments(script)
    .filter((s) => !isDeliveryTag(s.name))
    .map((s) => script.slice(s.start, s.end));
}

// ── Stripping ────────────────────────────────────────────────────────────────

/**
 * The [start, end) ranges a strip removes: each bracketed segment plus the
 * whitespace after it — or, for a segment with nothing but whitespace after it,
 * the whitespace before it — so "a [softly] b" → "a b" and "b. [laughs]" → "b.".
 *
 * Every bracketed segment goes, allowed or not: a Script shown to viewers or
 * burned into Captions never carries brackets (a voiced Script only ever holds
 * allowed tags anyway; the API refuses the rest).
 */
function stripRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const seg of bracketedSegments(text)) {
    let start = seg.start;
    let end = seg.end;
    while (end < text.length && /\s/.test(text[end])) end += 1;
    if (end === text.length) {
      while (start > 0 && /\s/.test(text[start - 1])) start -= 1;
    }
    const prev = ranges.at(-1);
    if (prev && start <= prev[1]) prev[1] = Math.max(prev[1], end);
    else ranges.push([start, end]);
  }
  return ranges;
}

/** A Script without its Delivery Tags, as viewers read it. */
export function stripDeliveryTags(script: string): string {
  let out = '';
  let at = 0;
  for (const [s, e] of stripRanges(script)) {
    out += script.slice(at, s);
    at = e;
  }
  return out + script.slice(at);
}

/** Character-level TTS alignment (ElevenLabs `alignment`), one entry per character of the text sent. */
export interface CharacterAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/**
 * The alignment without the Delivery Tags' characters (and the space the text
 * strip drops with them). Remaining characters keep their own timings, so
 * `stripDeliveryTagsFromAlignment(a).characters.join('')` equals
 * `stripDeliveryTags(a.characters.join(''))`.
 */
export function stripDeliveryTagsFromAlignment(alignment: CharacterAlignment): CharacterAlignment {
  const text = alignment.characters.join('');
  const ranges = stripRanges(text);
  const out: CharacterAlignment = { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] };
  let offset = 0;
  let r = 0;
  alignment.characters.forEach((ch, i) => {
    while (r < ranges.length && ranges[r][1] <= offset) r += 1;
    const dropped = r < ranges.length && offset >= ranges[r][0] && offset < ranges[r][1];
    offset += ch.length;
    if (dropped) return;
    out.characters.push(ch);
    out.character_start_times_seconds.push(alignment.character_start_times_seconds[i]);
    out.character_end_times_seconds.push(alignment.character_end_times_seconds[i]);
  });
  return out;
}
