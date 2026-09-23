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
 * Text: the cue text goes in through assPlainText (look-alikes, not escapes;
 * the policy is stated once in ./ass-format.ts), so a Script can never carry an
 * override tag onto the Short.
 *
 * Font: Noto Sans Arabic Bold (SIL Open Font License 1.1), installed in the
 * worker image from Debian's fonts-noto-core package (see the Dockerfile).
 *
 * Placement (9:16, 1080×1920): bottom-centred with its baseline block ending
 * 560 px above the bottom edge — the lower third, but clear of the ~25 % the
 * TikTok / Reels / Shorts overlays cover (caption, handle, sound, progress bar)
 * — and 130 px side margins so a line never runs under the right-side action
 * rail. A line too wide for that box wraps (WrapStyle 0: balanced lines).
 *
 * Styles (#22): the Caption editor picks a position, a size and a colour from
 * the whitelist in @agentmedia/schema (caption-lines.ts). assCaptionStyle maps
 * each to fixed ASS values here; anything off the list is refused, so no user
 * value ever reaches the .ass file except the (sanitised) line text. The
 * default style is exactly the look above.
 */

import { CAPTION_COLOURS, DEFAULT_CAPTION_STYLE, isCaptionStyle, type CaptionLine, type CaptionStyle } from '@agentmedia/schema';
import { assPlainText, assTime, ffmpegFilterValue } from './ass-format.js';

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

/** Font size per caption size (PlayResY 1920). m is #10's size. */
const SIZE_PX = { s: 72, m: ARABIC_CAPTION_STYLE.fontSize, l: 120 } as const;

/**
 * Numpad alignment and vertical margin per position. Lower third is #10's
 * placement; centre sits on the middle of the frame; top hangs 300 px down,
 * below the platform's top bar (Following / For You, ~15 %).
 */
const POSITION = {
  lower_third: { alignment: ARABIC_CAPTION_STYLE.alignment, marginV: ARABIC_CAPTION_STYLE.marginV },
  centre: { alignment: 5, marginV: 0 },
  top: { alignment: 8, marginV: 300 },
} as const;

/** `#RRGGBB` → ASS `&H00BBGGRR` (opaque). */
function assColour(hex: string): string {
  return `&H00${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toUpperCase();
}

/** The ASS values for a whitelisted caption style; throws on anything else. */
export function assCaptionStyle(style: CaptionStyle): { fontSize: number; alignment: number; marginV: number; primaryColour: string } {
  if (!isCaptionStyle(style)) throw new RangeError(`not an allowed caption style: ${JSON.stringify(style)}`);
  return {
    fontSize: SIZE_PX[style.size],
    ...POSITION[style.position],
    primaryColour: assColour(CAPTION_COLOURS[style.colour]),
  };
}

/** U+200F RIGHT-TO-LEFT MARK. */
const RLM = '\u200F';

/**
 * The ASS script for `cues` on the 9:16 canvas, in `style` (the whitelist; #10's
 * look by default). A cue is any line with text and timing: #10's cues or the
 * Caption editor's edited lines.
 */
export function arabicCaptionsAss(cues: readonly CaptionLine[], style: CaptionStyle = DEFAULT_CAPTION_STYLE): string {
  const s = { ...ARABIC_CAPTION_STYLE, ...assCaptionStyle(style) };
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
    .map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Arabic,,0,0,0,,${RLM}${assPlainText(c.text)}`);
  return [...header, ...events, ''].join('\n');
}

/**
 * The ffmpeg arguments that burn `assPath` onto `inPath`. The video is
 * re-encoded (burning needs it) at the mux's quality, frame for frame
 * (timestamps passed through, no rate change); the audio — the draft voice, or
 * the voice with its Music Bed — is copied untouched.
 */
export function captionBurnArgs(p: { inPath: string; assPath: string; outPath: string }): string[] {
  return [
    '-y',
    '-i', p.inPath,
    '-map', '0:v:0',
    '-map', '0:a?',
    // The `ass` filter (not `subtitles`): only it takes the shaping option.
    // The path is escaped for both levels of filtergraph parsing (ffmpegFilterValue).
    '-vf', `ass=filename=${ffmpegFilterValue(p.assPath)}:shaping=complex`,
    '-fps_mode', 'passthrough',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    p.outPath,
  ];
}
