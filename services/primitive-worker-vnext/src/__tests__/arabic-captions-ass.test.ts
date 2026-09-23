// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The ASS script Arabic Captions are burned from (#10): an Arabic-capable font,
// right-to-left paragraphs, lower-third placement inside the 9:16 safe area, and
// exactly one event per cue with the cue's own timing.

import { describe, it, expect } from 'vitest';
import { CAPTION_COLOURS, CAPTION_POSITIONS, CAPTION_SIZES, DEFAULT_CAPTION_STYLE, type CaptionCue, type CaptionStyle } from '@agentmedia/schema';
import { ARABIC_CAPTION_STYLE, arabicCaptionsAss, assCaptionStyle, captionBurnArgs } from '../lib/arabic-captions-ass.js';
import { assTime } from '../lib/ass-format.js';

/** RIGHT-TO-LEFT MARK: a strong RTL character that makes the line's paragraph right-to-left, even when it starts with a Latin word. */
const RLM = '\u200F';

const cues: CaptionCue[] = [
  { words: ['رومي', 'رويال،'], text: 'رومي رويال،', start: 1.12, end: 1.9 },
  { words: ['فريش', 'وراقية.'], text: 'فريش وراقية.', start: 1.9, end: 2.755 },
];

const dialogue = (ass: string) => ass.split('\n').filter((l) => l.startsWith('Dialogue:'));

describe('assTime', () => {
  it('formats h:mm:ss.cc and never rounds to 100 centiseconds', () => {
    expect(assTime(0)).toBe('0:00:00.00');
    expect(assTime(1.12)).toBe('0:00:01.12');
    expect(assTime(59.996)).toBe('0:01:00.00');
    expect(assTime(3725.5)).toBe('1:02:05.50');
  });
});

describe('arabicCaptionsAss', () => {
  const ass = arabicCaptionsAss(cues);

  it('draws on the 9:16 canvas in the bundled Arabic font', () => {
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
    const style = ass.split('\n').find((l) => l.startsWith('Style: '))!;
    expect(style.split(',')[1]).toBe(ARABIC_CAPTION_STYLE.fontName);
    expect(ARABIC_CAPTION_STYLE.fontName).toBe('Noto Sans Arabic');
  });

  it('lets libass pick the paragraph direction (Encoding -1), so Arabic lines are right-to-left', () => {
    const style = ass.split('\n').find((l) => l.startsWith('Style: '))!;
    expect(style.split(',').at(-1)).toBe('-1');
  });

  it('sits in the lower third, above the platform UI and clear of the side rail', () => {
    const style = ass.split('\n').find((l) => l.startsWith('Style: '))!.split(',');
    const [alignment, marginL, marginR, marginV] = style.slice(-5, -1).map(Number);
    expect(alignment).toBe(2); // bottom centre
    expect(marginV).toBeGreaterThanOrEqual(1920 * 0.25); // above bottom UI (caption, handle, sound)
    expect(1920 - marginV).toBeGreaterThanOrEqual(1920 * 2 / 3 - 60); // still the lower third
    expect(marginL).toBeGreaterThanOrEqual(100);
    expect(marginR).toBe(marginL); // centred
  });

  it('has one event per cue, with its times, each line opening right-to-left', () => {
    const lines = dialogue(ass);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`Dialogue: 0,0:00:01.12,0:00:01.90,Arabic,,0,0,0,,${RLM}رومي رويال،`);
    expect(lines[1]).toContain('0:00:01.90,0:00:02.76');
  });

  it('cannot be steered by the text: override braces and backslashes are neutralised, line breaks flattened', () => {
    const [line] = dialogue(arabicCaptionsAss([{ text: 'أ {\\b1} ب\\Nج\nد', start: 0, end: 1 }]));
    const text = line.split(',').slice(9).join(',');
    expect(text).not.toMatch(/[{}\\\n]/);
    expect(text).toContain('أ');
    expect(text).toContain('د');
  });

  it('skips a cue with no time on screen', () => {
    expect(dialogue(arabicCaptionsAss([{ text: 'أ', start: 1, end: 1 }]))).toHaveLength(0);
  });
});

describe('caption styles (#22): the whitelist mapped to ASS', () => {
  const styleLine = (style: CaptionStyle) => arabicCaptionsAss(cues, style).split('\n').find((l) => l.startsWith('Style: '))!.split(',');

  it('the default style draws exactly #10\'s look', () => {
    expect(arabicCaptionsAss(cues, DEFAULT_CAPTION_STYLE)).toBe(arabicCaptionsAss(cues));
    expect(assCaptionStyle(DEFAULT_CAPTION_STYLE)).toMatchObject({
      fontSize: ARABIC_CAPTION_STYLE.fontSize,
      alignment: ARABIC_CAPTION_STYLE.alignment,
      marginV: ARABIC_CAPTION_STYLE.marginV,
      primaryColour: ARABIC_CAPTION_STYLE.primaryColour,
    });
  });

  it('position: lower third (bottom centre), centre (middle centre), top (top centre, below the status bar)', () => {
    const at = (position: CaptionStyle['position']) => styleLine({ ...DEFAULT_CAPTION_STYLE, position }).slice(-5, -1).map(Number);
    expect(at('lower_third')[0]).toBe(2);
    expect(at('centre')[0]).toBe(5);
    const [align, , , marginV] = at('top');
    expect(align).toBe(8);
    expect(marginV).toBeGreaterThanOrEqual(1920 * 0.12); // below the platform's top bar
  });

  it('size: small < medium < large', () => {
    const size = (s: CaptionStyle['size']) => Number(styleLine({ ...DEFAULT_CAPTION_STYLE, size: s })[2]);
    expect(size('s')).toBeLessThan(size('m'));
    expect(size('m')).toBeLessThan(size('l'));
    expect(size('l')).toBeLessThanOrEqual(128); // a line still fits the frame
  });

  it('colour: the palette hex as ASS &H00BBGGRR (fill and karaoke colour), outline stays black', () => {
    const line = styleLine({ ...DEFAULT_CAPTION_STYLE, colour: 'yellow' });
    const hex = CAPTION_COLOURS.yellow; // #RRGGBB
    const ass = `&H00${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`;
    expect(line[3]).toBe(ass);
    expect(line[4]).toBe(ass);
    expect(line[5]).toBe(ARABIC_CAPTION_STYLE.outlineColour);
  });

  it('every whitelisted style maps; anything else is refused before an .ass is written', () => {
    for (const position of CAPTION_POSITIONS)
      for (const size of CAPTION_SIZES)
        for (const colour of Object.keys(CAPTION_COLOURS) as CaptionStyle['colour'][]) expect(() => assCaptionStyle({ position, size, colour })).not.toThrow();
    expect(() => arabicCaptionsAss(cues, { ...DEFAULT_CAPTION_STYLE, colour: '&H000000FF' } as unknown as CaptionStyle)).toThrow(/caption style/);
    expect(() => arabicCaptionsAss(cues, { ...DEFAULT_CAPTION_STYLE, size: 'constructor' } as unknown as CaptionStyle)).toThrow(/caption style/);
  });

  it('draws edited lines (text + timing, no words) the same way as cues', () => {
    const [line] = dialogue(arabicCaptionsAss([{ text: 'جلد ومسك', start: 0.5, end: 1.25 }]));
    expect(line).toBe(`Dialogue: 0,0:00:00.50,0:00:01.25,Arabic,,0,0,0,,${RLM}جلد ومسك`);
  });
});

describe('captionBurnArgs', () => {
  const args = captionBurnArgs({ inPath: '/w/in.mp4', assPath: '/w/captions.ass', outPath: '/w/out.mp4' });

  it('burns with complex (HarfBuzz) shaping and copies the audio untouched', () => {
    const vf = args[args.indexOf('-vf') + 1];
    expect(vf).toMatch(/^ass=filename=\/w\/captions\.ass/);
    expect(vf).toContain('shaping=complex');
    expect(args[args.indexOf('-c:a') + 1]).toBe('copy');
  });

  it('keeps every frame: no rate change, timestamps passed through', () => {
    expect(args).not.toContain('-r');
    expect(args[args.indexOf('-fps_mode') + 1]).toBe('passthrough');
  });

  it('escapes a path with `:` and `,` for both filtergraph levels, so it cannot add options or filters', () => {
    const odd = captionBurnArgs({ inPath: '/w/in.mp4', assPath: "/tmp/a:b,c[d];e'f\\g/captions.ass", outPath: '/w/out.mp4' });
    const vf = odd[odd.indexOf('-vf') + 1];
    expect(vf).toBe("ass=filename=/tmp/a\\\\:b\\,c\\[d\\]\\;e\\\\\\'f\\\\\\\\g/captions.ass:shaping=complex");
    // Exactly one filter with exactly two options, the path intact.
    expect(parseFilterOptions(vf)).toEqual({ filter: 'ass', options: { filename: "/tmp/a:b,c[d];e'f\\g/captions.ass", shaping: 'complex' } });
  });
});

/**
 * ffmpeg's two parsing levels for `-vf` (libavutil av_get_token), enough to
 * check the escaping: level 1 splits filters on `,` `;` (and labels on `[ ]`),
 * level 2 splits the options on `:`. Both read `\x` as a literal x and `'…'` as
 * a quoted run. Throws if the graph has more than one filter.
 */
function parseFilterOptions(graph: string): { filter: string; options: Record<string, string> } {
  const token = (s: string, i: number, stops: string): [string, number] => {
    let out = '';
    for (; i < s.length && !stops.includes(s[i]); i++) {
      if (s[i] === '\\') out += s[++i] ?? '';
      else if (s[i] === "'") for (i++; i < s.length && s[i] !== "'"; i++) out += s[i];
      else out += s[i];
    }
    return [out, i];
  };
  const [name, afterName] = token(graph, 0, '=,;[');
  if (graph[afterName] !== '=') throw new Error('no options');
  const [args, end] = token(graph, afterName + 1, '[],;');
  if (end !== graph.length) throw new Error(`more than one filter: ${graph.slice(end)}`);
  const options: Record<string, string> = {};
  let i = 0;
  while (i < args.length) {
    const [key, k] = token(args, i, '=:');
    const [value, v] = token(args, k + 1, ':');
    options[key] = value;
    i = v + 1;
  }
  return { filter: name, options };
}
