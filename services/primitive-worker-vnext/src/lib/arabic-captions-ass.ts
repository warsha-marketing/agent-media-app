// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Arabic Captions (#10) — the ASS script and the ffmpeg burn.
 *
 * The cues (words + timing) come from @agentmedia/schema captionCuesFromAlignment:
 * the voiced Script's own alignment, never speech-to-text. This file only draws
 * them. The English Whisper captions (./ass.ts, activities/subtitles.ts) are a
 * separate path and are not used for Arabic.
 *
 * Right-to-left and shaping:
 *   - libass shapes with HarfBuzz (mandatory since libass 0.15) and orders
 *     with FriBidi; the burn asks for complex shaping explicitly
 *     (ass=…:shaping=complex), so Arabic letters join and take their
 *     positional forms and the marks attach.
 *   - The style's Encoding is -1, which makes libass resolve each line's base
 *     direction from its text instead of assuming left-to-right; and every line
 *     starts with a RIGHT-TO-LEFT MARK, a strong RTL character, so a line is
 *     right-to-left even when it opens with a Latin brand name, and trailing
 *     punctuation (، . !) lands at the line's left end, where Arabic ends.
 *
 * Font: Noto Sans Arabic Bold (SIL Open Font License 1.1), installed in the
 * worker image from Debian's fonts-noto-core package (see the Dockerfile).
 *
 * Placement (9:16, 1080×1920): bottom-centred with its baseline block ending
 * 560 px above the bottom edge — the lower third, but clear of the ~25 % the
 * TikTok / Reels / Shorts overlays cover (caption, handle, sound, progress bar)
 * — and 130 px side margins so a line never runs under the right-side action
 * rail. A line too wide for that box wraps (WrapStyle 0: balanced lines).
 */

import type { CaptionCue } from '@agentmedia/schema';

export const ARABIC_CAPTION_STYLE = {
  fontName: 'Noto Sans Arabic',
  fontSize: 96,
  bold: true,
  primaryColour: '&H00FFFFFF', // white
  outlineColour: '&H00000000', // black
  backColour: '&H80000000', // shadow: half-transparent black
  outline: 6,
  shadow: 2,
  /** Numpad alignment: 2 = bottom centre. */
  alignment: 2,
  marginL: 130,
  marginR: 130,
  marginV: 560,
} as const;

const CANVAS = { x: 1080, y: 1920 };

/** U+200F RIGHT-TO-LEFT MARK. */
const RLM = '\u200F';

/** Seconds → ASS time `h:mm:ss.cc` (rounded to the centisecond, carried correctly). */
export function assTime(seconds: number): string {
  const cs = Math.round(Math.round(Math.max(0, seconds) * 1000) / 10);
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs % 360_000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/**
 * Caption text as ASS event text that cannot carry an override: braces open
 * override blocks and backslashes start escapes (\N, \h), so they are swapped
 * for look-alikes; line breaks are flattened (a cue is one line; libass wraps).
 */
function assText(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\uFF3C')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .trim();
}

/** The ASS script for `cues` on the 9:16 canvas. */
export function arabicCaptionsAss(cues: readonly CaptionCue[]): string {
  const s = ARABIC_CAPTION_STYLE;
  const header = [
    '[Script Info]',
    'Title: Arabic Captions',
    'ScriptType: v4.00+',
    `PlayResX: ${CANVAS.x}`,
    `PlayResY: ${CANVAS.y}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Encoding -1: libass resolves each line's direction from its text (RTL for Arabic).
    `Style: Arabic,${s.fontName},${s.fontSize},${s.primaryColour},${s.primaryColour},${s.outlineColour},${s.backColour},${s.bold ? -1 : 0},0,0,0,100,100,0,0,1,${s.outline},${s.shadow},${s.alignment},${s.marginL},${s.marginR},${s.marginV},-1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events = cues
    .filter((c) => assTime(c.end) !== assTime(c.start) && c.end > c.start)
    .map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Arabic,,0,0,0,,${RLM}${assText(c.text)}`);
  return [...header, ...events, ''].join('\n');
}

/** ffmpeg filter-option escaping for a path inside `ass=filename=…`. */
function filterPath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,');
}

/**
 * The ffmpeg arguments that burn `assPath` onto `inPath`. The video is
 * re-encoded (burning needs it) at the mux's quality, frame for frame
 * (timestamps passed through, no rate change); the audio — the draft voice, or
 * the voice with its Music Bed — is copied untouched.
 */
export function captionBurnArgs(p: { inPath: string; assPath: string; outPath: string; fontsDir?: string }): string[] {
  const opts = [`filename=${filterPath(p.assPath)}`, 'shaping=complex'];
  if (p.fontsDir) opts.push(`fontsdir=${filterPath(p.fontsDir)}`);
  return [
    '-y',
    '-i', p.inPath,
    '-map', '0:v:0',
    '-map', '0:a?',
    // The `ass` filter (not `subtitles`): only it takes the shaping option.
    '-vf', `ass=${opts.join(':')}`,
    '-fps_mode', 'passthrough',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    p.outPath,
  ];
}
