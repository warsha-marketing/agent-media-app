// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Arabic Captions (#10): cues timed from the voiced Script's TTS character
 * alignment, never from speech-to-text. The words are the Script's, without
 * its Delivery Tags; the timing is the voice's.
 */

import { describe, it, expect } from 'vitest';
import {
  ARABIC_CAPTION_RULES,
  captionCuesFromAlignment,
  captionWordsFromAlignment,
  groupCaptionCues,
  stripArabicDiacritics,
  type CaptionWord,
} from '../captions.js';
import { stripDeliveryTags, type CharacterAlignment } from '../delivery-tags.js';

/** The Script from the first live Product Hero render (RUMI Royal Rituals, Levantine). */
const LIVE_SCRIPT =
  '[confidently] رومي رويال ريتشوالز، فريش وراقية. [softly] برغموت، فلفل زهري، جِلد ومِسك. [warmly] بتضلّ معك للسهرة. [excited] جرّبها.';

/** One entry per character, `step` seconds each — the shape ElevenLabs returns. */
function alignmentOf(text: string, step = 0.06): CharacterAlignment {
  const chars = [...text];
  return {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => +(i * step).toFixed(3)),
    character_end_times_seconds: chars.map((_, i) => +((i + 1) * step).toFixed(3)),
  };
}

const w = (text: string, start: number, end: number): CaptionWord => ({ text, start, end });

describe('stripArabicDiacritics', () => {
  it('removes تشكيل (harakat, tanween, shadda, sukun, dagger alif) and keeps the letters', () => {
    expect(stripArabicDiacritics('جِلد ومِسك')).toBe('جلد ومسك');
    expect(stripArabicDiacritics('بتضلّ')).toBe('بتضل');
    expect(stripArabicDiacritics('شُكْرًا')).toBe('شكرا');
    expect(stripArabicDiacritics('هٰذا')).toBe('هذا');
  });

  it('never touches hamza letters, maddah, tatweel, Latin or digits', () => {
    expect(stripArabicDiacritics('أإآؤئء')).toBe('أإآؤئء');
    expect(stripArabicDiacritics('آ\u0653')).toBe('آ\u0653');
    expect(stripArabicDiacritics('RUMI ٣ 3 جـميل')).toBe('RUMI ٣ 3 جـميل');
  });
});

describe('captionWordsFromAlignment', () => {
  it('never shows a Delivery Tag', () => {
    const words = captionWordsFromAlignment(alignmentOf(LIVE_SCRIPT));
    for (const word of words) expect(word.text).not.toMatch(/[[\]]|softly|confidently|warmly|excited/);
    expect(words.map((x) => x.text).join(' ')).toBe(stripArabicDiacritics(stripDeliveryTags(LIVE_SCRIPT)));
  });

  it('splits on whitespace (spaces, line breaks) and keeps punctuation attached to its word', () => {
    const words = captionWordsFromAlignment(alignmentOf('فريش، وراقية.\nجرّبها!'));
    expect(words.map((x) => x.text)).toEqual(['فريش،', 'وراقية.', 'جربها!']);
  });

  it("times each word from its first character's start to its last character's end", () => {
    // 'أب جد' → أ[0,.06) ب[.06,.12) ' ' ج[.18,.24) د[.24,.30)
    const words = captionWordsFromAlignment(alignmentOf('أب جد'));
    expect(words).toEqual([w('أب', 0, 0.12), w('جد', 0.18, 0.3)]);
  });

  it('keeps timings through a stripped tag: the first word starts when it is spoken, not at 0', () => {
    const words = captionWordsFromAlignment(alignmentOf('[softly] أب جد'));
    expect(words[0]).toEqual(w('أب', +(9 * 0.06).toFixed(3), +(11 * 0.06).toFixed(3)));
  });

  it('shows the Script without its Targeted Diacritics', () => {
    const a = alignmentOf('[softly] برغموت، جِلد ومِسك.');
    expect(captionWordsFromAlignment(a).map((x) => x.text)).toEqual(['برغموت،', 'جلد', 'ومسك.']);
  });

  it('folds a punctuation-only token into the word before it (or after it, at the start)', () => {
    expect(captionWordsFromAlignment(alignmentOf('مرحبا ! كيفك')).map((x) => x.text)).toEqual(['مرحبا!', 'كيفك']);
    const lead = captionWordsFromAlignment(alignmentOf('« مرحبا'));
    expect(lead.map((x) => x.text)).toEqual(['«مرحبا']);
    expect(lead[0].start).toBe(0);
  });

  it('keeps a Latin brand name the user wrote as one word', () => {
    expect(captionWordsFromAlignment(alignmentOf('جرّب RUMI اليوم')).map((x) => x.text)).toEqual(['جرب', 'RUMI', 'اليوم']);
  });

  it('works when an alignment entry holds more than one code unit', () => {
    const a: CharacterAlignment = {
      characters: ['[softly]', ' ', 'أ', 'ب', ' ', 'جد'],
      character_start_times_seconds: [0, 0.3, 0.4, 0.5, 0.6, 0.7],
      character_end_times_seconds: [0.3, 0.4, 0.5, 0.6, 0.7, 0.9],
    };
    expect(captionWordsFromAlignment(a)).toEqual([w('أب', 0.4, 0.6), w('جد', 0.7, 0.9)]);
  });

  it('gives nothing for an empty or tag-only alignment', () => {
    expect(captionWordsFromAlignment({ characters: [], character_start_times_seconds: [], character_end_times_seconds: [] })).toEqual([]);
    expect(captionWordsFromAlignment(alignmentOf('[softly] '))).toEqual([]);
  });

  it('refuses an alignment whose arrays disagree in length', () => {
    expect(() =>
      captionWordsFromAlignment({ characters: ['أ', 'ب'], character_start_times_seconds: [0], character_end_times_seconds: [0.1, 0.2] }),
    ).toThrow(RangeError);
  });
});

describe('groupCaptionCues', () => {
  it(`holds at most ${ARABIC_CAPTION_RULES.maxWords} words per cue and never splits a word`, () => {
    const words = Array.from({ length: 10 }, (_, i) => w(`كلمة${i}`, i * 0.3, i * 0.3 + 0.25));
    const cues = groupCaptionCues(words);
    for (const c of cues) expect(c.words.length).toBeLessThanOrEqual(ARABIC_CAPTION_RULES.maxWords);
    expect(cues.flatMap((c) => c.words)).toEqual(words.map((x) => x.text));
  });

  it(`holds a cue's speech to about ${ARABIC_CAPTION_RULES.maxSeconds} s`, () => {
    // Slow words: 0.7 s each. Two fit in 1.8 s; a third would not.
    const words = Array.from({ length: 6 }, (_, i) => w(`ك${i}`, i * 0.75, i * 0.75 + 0.7));
    const cues = groupCaptionCues(words);
    expect(cues.map((c) => c.words.length)).toEqual([2, 2, 2]);
  });

  it('gives a single word longer than the cap a cue of its own', () => {
    const cues = groupCaptionCues([w('أ', 0, 0.3), w('طوييييل', 0.4, 2.8), w('ب', 2.9, 3.1)]);
    expect(cues.map((c) => c.words)).toEqual([['أ'], ['طوييييل'], ['ب']]);
  });

  it('keeps a line to a readable width (characters)', () => {
    const long = 'ريتشوالزززز';
    const cues = groupCaptionCues([w(long, 0, 0.2), w(long, 0.2, 0.4), w(long, 0.4, 0.6)]);
    for (const c of cues) {
      if (c.words.length > 1) expect(c.text.length).toBeLessThanOrEqual(ARABIC_CAPTION_RULES.maxChars);
    }
    expect(cues.length).toBeGreaterThan(1);
  });

  it('ends a cue at clause punctuation (، . ! ؟ ؛)', () => {
    const cues = groupCaptionCues([w('برغموت،', 0, 0.3), w('فلفل', 0.35, 0.6), w('زهري،', 0.62, 0.9), w('جلد', 0.95, 1.1)]);
    expect(cues.map((c) => c.text)).toEqual(['برغموت،', 'فلفل زهري،', 'جلد']);
  });

  it('ends a cue at a pause in the speech', () => {
    const cues = groupCaptionCues([w('أ', 0, 0.2), w('ب', 0.25, 0.4), w('ج', 1.2, 1.4)]);
    expect(cues.map((c) => c.words)).toEqual([['أ', 'ب'], ['ج']]);
  });

  it(`shows each cue for at least ${ARABIC_CAPTION_RULES.minSeconds} s when there is room, never overlapping the next`, () => {
    const cues = groupCaptionCues([w('أ.', 0, 0.2), w('ب.', 1.5, 1.6), w('ج.', 1.9, 2.0)]);
    expect(cues[0].start).toBe(0);
    expect(cues[0].end).toBeCloseTo(ARABIC_CAPTION_RULES.minSeconds);
    // Not enough room before the next cue: it ends where the next begins.
    expect(cues[1].end).toBeCloseTo(1.9);
    for (let i = 1; i < cues.length; i += 1) expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].end);
  });

  it('bridges a tiny gap between cues so the captions do not flicker', () => {
    const cues = groupCaptionCues([w('أ،', 0, 0.9), w('ب', 1.0, 1.8)]);
    expect(cues[0].end).toBeCloseTo(1.0);
  });

  it('never runs past the Short', () => {
    const cues = groupCaptionCues([w('أ', 0, 0.5), w('ب.', 4.8, 4.9)], { durationSeconds: 5 });
    expect(cues.at(-1)!.end).toBeLessThanOrEqual(5);
    expect(cues.at(-1)!.end).toBeCloseTo(5);
  });

  it('takes rule overrides', () => {
    const words = Array.from({ length: 6 }, (_, i) => w(`ك${i}`, i * 0.2, i * 0.2 + 0.15));
    expect(groupCaptionCues(words, { rules: { maxWords: 2 } }).map((c) => c.words.length)).toEqual([2, 2, 2]);
  });
});

describe('captionCuesFromAlignment — the live Script', () => {
  const alignment = alignmentOf(LIVE_SCRIPT, 0.07);
  const cues = captionCuesFromAlignment(alignment);

  it('shows exactly the Script without Delivery Tags, in order, split only between words', () => {
    expect(cues.map((c) => c.text).join(' ')).toBe(stripArabicDiacritics(stripDeliveryTags(LIVE_SCRIPT)));
    expect(cues.map((c) => c.text).join(' ')).not.toMatch(/\[|\]/);
  });

  it('is in time order with no overlaps, within the speech', () => {
    const lastEnd = alignment.character_end_times_seconds.at(-1)!;
    for (let i = 0; i < cues.length; i += 1) {
      expect(cues[i].end).toBeGreaterThan(cues[i].start);
      if (i > 0) expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].end);
    }
    expect(cues[0].start).toBeCloseTo('[confidently] '.length * 0.07);
    expect(cues.at(-1)!.end).toBeLessThanOrEqual(lastEnd + ARABIC_CAPTION_RULES.minSeconds);
  });

  it('keeps each cue short', () => {
    for (const c of cues) {
      expect(c.words.length).toBeLessThanOrEqual(ARABIC_CAPTION_RULES.maxWords);
      expect(c.words.length).toBeGreaterThan(0);
    }
  });
});
