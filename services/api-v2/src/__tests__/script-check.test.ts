// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The Script validator (ADR 0002): allowed Delivery Tags only, Arabic-only
// generated Scripts (an edit may carry a Latin brand name), and
// Targeted Diacritics on product terms and on words with a common second
// reading. The fixture is the Script from the first live Product Hero render
// (RUMI Royal Rituals, Levantine), which sounded right.

import { describe, it, expect } from 'vitest';
import { generatedScriptIssues, scriptTextIssues } from '../drafts/script-check.js';

const LIVE_SCRIPT =
  '[confidently] رومي رويال ريتشوالز، فريش وراقية. [softly] برغموت، فلفل زهري، جِلد ومِسك. [warmly] بتضلّ معك للسهرة. [excited] جرّبها.';
const UNMARKED = LIVE_SCRIPT.replace('جِلد', 'جلد').replace('ومِسك', 'ومسك');
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('scriptTextIssues (every Script)', () => {
  it('accepts the live Script: Arabic plus allowed Delivery Tags', () => {
    expect(scriptTextIssues(LIVE_SCRIPT)).toEqual([]);
  });

  it('refuses an unknown tag like [wisper], naming it', () => {
    const issues = scriptTextIssues(LIVE_SCRIPT.replace('[softly]', '[wisper]'));
    expect(issues).toEqual([expect.objectContaining({ code: 'UNKNOWN_DELIVERY_TAG', found: ['[wisper]'] })]);
  });

  it('accepts Latin words such as a brand name (a user may type RUMI)', () => {
    expect(scriptTextIssues(LIVE_SCRIPT.replace('رومي', 'RUMI'))).toEqual([]);
  });

  it('refuses stray brackets outside tags, naming them', () => {
    expect(scriptTextIssues('جرّبها [softly هلق')).toEqual([expect.objectContaining({ code: 'SCRIPT_STRAY_BRACKETS', found: ['['] })]);
    expect(scriptTextIssues('جرّبها ]] هلق [')).toEqual([expect.objectContaining({ code: 'SCRIPT_STRAY_BRACKETS', found: [']', '['] })]);
  });

  it('refuses a Script with no Arabic to speak', () => {
    expect(codes(scriptTextIssues('[softly]'))).toEqual(['SCRIPT_NO_ARABIC']);
    expect(codes(scriptTextIssues('Try RUMI tonight'))).toEqual(['SCRIPT_NO_ARABIC']);
  });
});

describe('generatedScriptIssues (Targeted Diacritics)', () => {
  it('accepts the live Script with its marked product terms', () => {
    expect(generatedScriptIssues(LIVE_SCRIPT, ['جِلد', 'مِسك'])).toEqual([]);
  });

  it('refuses the same Script with جلد and مسك unmarked', () => {
    const issues = generatedScriptIssues(UNMARKED, ['جلد', 'مسك']);
    expect(issues).toEqual([expect.objectContaining({ code: 'WORD_NOT_MARKED', found: ['جلد', 'ومسك'] })]);
  });

  it('refuses them unmarked even when the writer did not report them (homographs)', () => {
    expect(codes(generatedScriptIssues(UNMARKED, []))).toEqual(['WORD_NOT_MARKED']);
  });

  it('refuses an unmarked product term the writer reported', () => {
    const issues = generatedScriptIssues(LIVE_SCRIPT, ['برغموت']);
    expect(issues).toEqual([expect.objectContaining({ code: 'WORD_NOT_MARKED', found: ['برغموت'] })]);
    expect(generatedScriptIssues(LIVE_SCRIPT.replace('برغموت', 'بِرغموت'), ['برغموت'])).toEqual([]);
  });

  it('refuses a reported term that is not in the Script', () => {
    expect(generatedScriptIssues(LIVE_SCRIPT, ['باتشولي'])).toEqual([
      expect.objectContaining({ code: 'PRODUCT_TERM_MISSING', found: ['باتشولي'] }),
    ]);
  });

  it('matches whole words only: a homograph inside another word is not flagged', () => {
    // تمسك (holds on) contains مسك but is not the word مسك.
    expect(generatedScriptIssues('هيدا العطر بتمسك فيه طول النهار', [])).toEqual([]);
  });

  it('counts a mark on the word itself, not on an attached و', () => {
    expect(codes(generatedScriptIssues('جلد وَمسك', ['جلد']))).toEqual(['WORD_NOT_MARKED']);
    expect(generatedScriptIssues('جِلد ومِسك', [])).toEqual([]);
  });

  it('matches a reported term whatever its hamza, alef maqsura, ta marbuta or tatweel', () => {
    // Reported with a different hamza than the Script uses: found, and marked.
    expect(generatedScriptIssues('عطر بالأمبَر والجِلد', ['امبَر', 'الإمبَر', 'آمبَر'])).toEqual([]);
    // ى / ي and ة / ه at the end of a word, and tatweel.
    expect(generatedScriptIssues('نغمة موسيقَى ناعمة', ['موسيقي'])).toEqual([]);
    expect(generatedScriptIssues('ريحة الفانيلّة بتضل', ['فانيله'])).toEqual([]);
    expect(generatedScriptIssues('عُود ومِسك', ['عـود', 'مـسك'])).toEqual([]);
  });

  it('flags such a term as unmarked (not missing) when the Script leaves it bare', () => {
    expect(generatedScriptIssues('عطر بالأمبر', ['امبر'])).toEqual([
      expect.objectContaining({ code: 'WORD_NOT_MARKED', found: ['بالأمبر'] }),
    ]);
  });

  it('matches homographs across hamza and tatweel spellings too', () => {
    expect(codes(generatedScriptIssues('جـلد ومسـك', []))).toEqual(['WORD_NOT_MARKED']);
  });

  it('counts every Arabic combining mark as a diacritic: shadda, sukun, superscript alef, madda and hamza marks', () => {
    for (const mark of ['\u0651', '\u0652', '\u0670', '\u0653', '\u0654', '\u0655', '\u0656']) {
      expect(generatedScriptIssues(`جل${mark}د`, [`جل${mark}د`]), `U+${mark.codePointAt(0)!.toString(16)}`).toEqual([]);
    }
  });

  it('does not count a hamza that is part of a letter as a mark, even written decomposed', () => {
    // ا + U+0654 is just أ: the word is still bare.
    expect(codes(generatedScriptIssues('عطر بالا\u0654مبر', ['أمبر']))).toEqual(['WORD_NOT_MARKED']);
  });

  it('keeps a generated Script Arabic-only: names are written in Arabic letters as they are said', () => {
    expect(generatedScriptIssues(LIVE_SCRIPT.replace('رومي', 'RUMI'), ['جِلد', 'مِسك'])).toEqual([
      expect.objectContaining({ code: 'SCRIPT_LATIN_TEXT', found: ['RUMI'] }),
    ]);
  });

  it('still applies the text rules', () => {
    expect(codes(generatedScriptIssues(LIVE_SCRIPT.replace('[softly]', '[wisper]'), ['جِلد']))).toEqual(['UNKNOWN_DELIVERY_TAG']);
  });
});
