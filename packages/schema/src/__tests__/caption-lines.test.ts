// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Edited caption lines (#22): the Caption editor's lines and style, checked the
 * same way by the export route (api-v2) and the export workflow (worker).
 */

import { describe, it, expect } from 'vitest';
import {
  CAPTION_COLOURS,
  CAPTION_LINE_LIMITS,
  CAPTION_POSITIONS,
  CAPTION_SIZES,
  DEFAULT_CAPTION_STYLE,
  isCaptionStyle,
  normaliseCaptionText,
  suggestedCaptionLines,
  validateCaptionLines,
  type CaptionLine,
} from '../caption-lines.js';
import { captionCuesFromAlignment } from '../captions.js';
import type { CharacterAlignment } from '../delivery-tags.js';

const SCRIPT = '[confidently] رومي رويال، فريش وراقية. [softly] جِلد ومِسك.';
function alignmentOf(text: string, step = 0.08): CharacterAlignment {
  const chars = [...text];
  return {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => +(i * step).toFixed(3)),
    character_end_times_seconds: chars.map((_, i) => +((i + 1) * step).toFixed(3)),
  };
}

const line = (text: string, start: number, end: number): CaptionLine => ({ text, start, end });
const codes = (lines: CaptionLine[], duration = 10) => validateCaptionLines(lines, duration).map((i) => `${i.code}@${i.line}`);

describe('suggestedCaptionLines', () => {
  it("are the draft alignment's cues (#10 rules): no Delivery Tags, no diacritics, line by line", () => {
    const a = alignmentOf(SCRIPT);
    const lines = suggestedCaptionLines(a, 6);
    expect(lines).toEqual(captionCuesFromAlignment(a, { durationSeconds: 6 }).map(({ text, start, end }) => ({ text, start, end })));
    const shown = lines.map((l) => l.text).join(' ');
    expect(shown).not.toMatch(/\[|softly|confidently/);
    expect(shown).toContain('جلد ومسك');
    expect(validateCaptionLines(lines, 6)).toEqual([]);
  });
});

describe('validateCaptionLines', () => {
  it('accepts ordered, non-overlapping lines inside the Short', () => {
    expect(codes([line('أ ب', 0, 1), line('ج د', 1, 2.5), line('هـ', 3, 10)])).toEqual([]);
  });

  it('refuses no lines, and more lines than the cap', () => {
    expect(codes([])).toEqual(['no_lines@null']);
    const many = Array.from({ length: CAPTION_LINE_LIMITS.maxLines + 1 }, (_, i) => line('أ', i * 0.1, i * 0.1 + 0.1));
    expect(codes(many, 100)).toContain('too_many_lines@null');
  });

  it('refuses an empty line and one longer than the cap', () => {
    expect(codes([line('  ', 0, 1)])).toEqual(['empty_text@0']);
    expect(codes([line('أ'.repeat(CAPTION_LINE_LIMITS.maxChars + 1), 0, 1)])).toEqual(['text_too_long@0']);
  });

  it('refuses bad timing: end not after start, too short, outside the Short', () => {
    expect(codes([line('أ', 1, 1)])).toEqual(['invalid_timing@0']);
    expect(codes([line('أ', Number.NaN, 1)])).toEqual(['invalid_timing@0']);
    expect(codes([line('أ', 1, 1 + CAPTION_LINE_LIMITS.minSeconds / 2)])).toEqual(['line_too_short@0']);
    expect(codes([line('أ', -0.5, 1)])).toEqual(['outside_short@0']);
    expect(codes([line('أ', 9, 10.5)])).toEqual(['outside_short@0']);
  });

  it('refuses lines out of order and lines that overlap', () => {
    expect(codes([line('أ', 2, 3), line('ب', 0, 1)])).toEqual(['out_of_order@1']);
    expect(codes([line('أ', 0, 2), line('ب', 1.5, 3)])).toEqual(['overlap@1']);
  });

  it('allows a hair of float drift at the Short’s end', () => {
    expect(codes([line('أ', 9, 10.0004)])).toEqual([]);
  });
});

describe('caption style whitelist', () => {
  it('has three positions, three sizes and a small palette; the default is on it', () => {
    expect([...CAPTION_POSITIONS]).toEqual(['lower_third', 'centre', 'top']);
    expect([...CAPTION_SIZES]).toEqual(['s', 'm', 'l']);
    expect(Object.keys(CAPTION_COLOURS).length).toBeLessThanOrEqual(6);
    for (const hex of Object.values(CAPTION_COLOURS)) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    expect(isCaptionStyle(DEFAULT_CAPTION_STYLE)).toBe(true);
  });

  it('refuses anything off the list, including prototype keys and extra fields', () => {
    expect(isCaptionStyle({ position: 'bottom', size: 'm', colour: 'white' })).toBe(false);
    expect(isCaptionStyle({ position: 'top', size: 'xl', colour: 'white' })).toBe(false);
    expect(isCaptionStyle({ position: 'top', size: 's', colour: '#FF0000' })).toBe(false);
    expect(isCaptionStyle({ position: 'top', size: 's', colour: 'constructor' })).toBe(false);
    expect(isCaptionStyle({ position: 'top', size: 's', colour: 'white', font: 'Comic Sans' })).toBe(false);
    expect(isCaptionStyle(null)).toBe(false);
  });
});

describe('normaliseCaptionText', () => {
  it('trims and folds whitespace and line breaks to single spaces', () => {
    expect(normaliseCaptionText('  جلد\n\n ومسك\t ')).toBe('جلد ومسك');
  });

  it('drops control and bidi-override characters (a line is always right to left)', () => {
    expect(normaliseCaptionText('جلد\u0000\u202E ومسك\u2066')).toBe('جلد ومسك');
  });
});
