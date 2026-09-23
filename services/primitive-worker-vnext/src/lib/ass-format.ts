// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * What both ASS generators share: the time format, how event text is made
 * safe, and how an .ass path is handed to ffmpeg's `ass` filter.
 *   - ./ass.ts                 English captions (Whisper words, karaoke styles)
 *   - ./arabic-captions-ass.ts Arabic Captions (the Script's own words, #10)
 */

/**
 * Seconds → ASS time `h:mm:ss.cc`, rounded to the nearest centisecond with the
 * carry done on the whole value (59.996 s is `0:01:00.00`, never `…:59.100`).
 * The tiny epsilon makes an exact half centisecond stored in binary (2.755 is
 * 2.75499…) round up as written.
 */
export function assTime(seconds: number): string {
  const cs = Math.round(Math.max(0, seconds) * 100 + 1e-9);
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs % 360_000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/*
 * ── ASS event text: the escaping policy ──────────────────────────────────────
 * In an ASS Dialogue line, `{` opens an override block (`{\b1}`, `{\pos(…)}`,
 * `{\fs200}`) and `\` starts an escape (`\N` line break, `\h` hard space). Text
 * that reaches the renderer as-is can therefore restyle, move or break a line.
 *
 * English captions (assEscapeText) backslash-escape `\`, `{` and `}`. That is
 * the historical behaviour of the Whisper path and is kept as is. It relies on
 * the renderer honouring those escapes, which is renderer-specific: libass
 * reads `\{` and `\}` as literal braces, but has no escape for a backslash
 * itself, so an escaped `\\N` can still end in a live `\N`.
 *
 * Arabic Captions (assPlainText) replace instead of escape: `\` becomes the
 * full-width reverse solidus, `{` `}` become `(` `)`, and line breaks become
 * spaces. The result contains no character libass treats specially, so no
 * renderer version can read an override or an escape into it. The text is a
 * user-edited Script burned into a Short the user publishes, so this path must
 * not depend on escape support; and none of these characters belongs in an
 * Arabic caption, so a look-alike costs nothing on screen.
 */

/** ASS text with `\`, `{`, `}` backslash-escaped (English captions; see the policy above). */
export function assEscapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
}

/** ASS text with no override, escape or line break possible (Arabic Captions; see the policy above). */
export function assPlainText(s: string): string {
  return s
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '＼')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .trim();
}

/*
 * ── A path inside an ffmpeg filter ───────────────────────────────────────────
 * `-vf "ass=filename=<path>:shaping=complex"` is parsed twice:
 *   1. the filtergraph parser splits filters and chains on `[ ] , ;` (and reads
 *      `\` and `'` as escape and quote), then
 *   2. the filter's option parser splits `key=value` pairs on `:` (again with
 *      `\` and `'` as escape and quote).
 * So a value is escaped for level 2 first (`\ ' :`), and that result for level
 * 1 (`\ ' [ ] , ;`). A single level (the old `\:`) is undone by level 1, and
 * the option parser then splits the path at its `:`.
 */

/** `value` escaped for use as one option value inside an ffmpeg filtergraph (`-vf` / `-filter_complex`). */
export function ffmpegFilterValue(value: string): string {
  const optionLevel = value.replace(/[\\':]/g, (c) => `\\${c}`);
  return optionLevel.replace(/[\\'[\],;]/g, (c) => `\\${c}`);
}
