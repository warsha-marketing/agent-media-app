// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The Script validator (ADR 0002): Arabic text plus allowed Delivery Tags, and
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

  it('refuses Latin text and stray brackets outside tags', () => {
    expect(scriptTextIssues('جرّبها RUMI هلق')).toEqual([expect.objectContaining({ code: 'SCRIPT_NOT_ARABIC', found: ['RUMI'] })]);
    expect(codes(scriptTextIssues('جرّبها [softly هلق'))).toEqual(['SCRIPT_NOT_ARABIC']);
    expect(codes(scriptTextIssues('[softly]'))).toEqual(['SCRIPT_NOT_ARABIC']);
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

  it('still applies the text rules', () => {
    expect(codes(generatedScriptIssues(LIVE_SCRIPT.replace('[softly]', '[wisper]'), ['جِلد']))).toEqual(['UNKNOWN_DELIVERY_TAG']);
  });
});
