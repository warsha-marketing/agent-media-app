// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * What a Script must look like before anyone pays to voice it (ADR 0002).
 *
 * Every Script (generated or edited by the user):
 *   - is Arabic text plus allowed Delivery Tags only: no other bracketed text
 *     (a typo like [wisper] would be spoken aloud) and no Latin letters.
 *
 * A generated Script also has Targeted Diacritics:
 *   - every product term the writer reports — the words it used for the
 *     Product Details' nouns, notes and ingredients that a voice could misread
 *     — appears in the Script and carries at least one mark;
 *   - every word with a common second reading from HOMOGRAPHS carries at least
 *     one mark wherever it appears, whatever the writer reported.
 *
 * WHY the writer reports its product terms instead of this file finding them:
 * Product Details are usually in English ("Leather, Musk") while the Script is
 * Arabic (جِلد، مِسك); matching them would need a translator in the validator.
 * The writer already knows which Arabic words it used for which fact, so it
 * returns them next to the Script (structured output) and this check holds it
 * to them. HOMOGRAPHS is the backstop that does not depend on the writer: the
 * words that were actually misread in the live test (جلد → jald "whipping",
 * مسك → masak "took") are refused unmarked even if the writer forgot to list
 * them. Loanwords with a single reading (برغموت) may stay plain, as they did
 * in the live Script that sounded right.
 *
 * A user's edited Script gets only the first rule: the user is the judge of
 * their own marks, and there is no writer to report terms.
 */

import { bracketedSegments, unknownDeliveryTagMessage, unknownDeliveryTags } from '@agentmedia/schema';

export interface ScriptIssue {
  code: 'UNKNOWN_DELIVERY_TAG' | 'SCRIPT_NOT_ARABIC' | 'PRODUCT_TERM_MISSING' | 'WORD_NOT_MARKED';
  message: string;
  /** The offending tags, Latin text or words, as written. */
  found: string[];
}

/**
 * Words a voice commonly reads the wrong way without a mark (bare spelling).
 * Grow this from live tests; each entry forces a mark on every occurrence in a
 * generated Script, so keep it to words whose second reading is common.
 */
export const HOMOGRAPHS: readonly string[] = [
  'جلد', // jild (leather) / jald (whipping)
  'مسك', // misk (musk) / masak (took)
  'عود', // oud (agarwood) / 'awd (return)
  'سكر', // sukkar (sugar) / sakar (closed, Levantine)
];

const HARAKA = /[\u064B-\u0652\u0670]/;
const TATWEEL = '\u0640';
const ARABIC_LETTER = /[\u0621-\u064A\u0671-\u06D3]/;
const LATIN = /[A-Za-z\u00C0-\u024F]+/g;
/** Letters that may be attached in front of a word: و/ف, then ب/ل/ك, then the article. */
const PROCLITICS = /^(?:[وف])?(?:[بلك])?(?:ال|ل)?$/;

// ── Arabic text plus allowed Delivery Tags ──────────────────────────────────

/** Issues with any Script: unknown bracketed tags, Latin letters, stray brackets, no Arabic. */
export function scriptTextIssues(script: string): ScriptIssue[] {
  const issues: ScriptIssue[] = [];
  const unknown = unknownDeliveryTags(script);
  if (unknown.length) {
    issues.push({
      code: 'UNKNOWN_DELIVERY_TAG',
      message: unknownDeliveryTagMessage(unknown),
      found: unknown,
    });
  }
  // What is left once every bracketed segment is gone must be Arabic.
  let rest = script;
  for (const seg of bracketedSegments(script).reverse()) rest = rest.slice(0, seg.start) + ' ' + rest.slice(seg.end);
  const latin = rest.match(LATIN) ?? [];
  const stray = /[[\]]/.test(rest) ? ['[ or ]'] : [];
  if (latin.length || stray.length || !ARABIC_LETTER.test(rest)) {
    issues.push({
      code: 'SCRIPT_NOT_ARABIC',
      message: latin.length || stray.length
        ? `The Script must be Arabic text and Delivery Tags only; found ${[...latin, ...stray].join(', ')}. Write names in Arabic letters as they are said.`
        : 'The Script has no Arabic text to speak.',
      found: [...latin, ...stray],
    });
  }
  return issues;
}

// ── Targeted Diacritics ─────────────────────────────────────────────────────

/** A Script with marks and tatweel removed, and where each bare character came from. */
function bareWithMap(text: string): { bare: string; from: number[] } {
  let bare = '';
  const from: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (HARAKA.test(ch) || ch === TATWEEL) continue;
    bare += ch;
    from.push(i);
  }
  return { bare, from };
}

const bareOf = (s: string) => bareWithMap(s).bare.replace(/\s+/g, ' ').trim();

/**
 * Every place `term` (mark-insensitive) is a whole word of the Script, allowing
 * attached proclitics in front (ومِسك matches مِسك), with whether that span
 * carries at least one mark.
 */
function occurrences(script: string, term: string): Array<{ text: string; marked: boolean }> {
  const target = bareOf(term);
  if (!target) return [];
  const { bare, from } = bareWithMap(script.replace(/\s+/g, ' '));
  const src = script.replace(/\s+/g, ' ');
  const out: Array<{ text: string; marked: boolean }> = [];
  for (let at = bare.indexOf(target); at !== -1; at = bare.indexOf(target, at + 1)) {
    const end = at + target.length;
    if (end < bare.length && ARABIC_LETTER.test(bare[end])) continue;
    let wordStart = at;
    while (wordStart > 0 && ARABIC_LETTER.test(bare[wordStart - 1])) wordStart -= 1;
    if (!PROCLITICS.test(bare.slice(wordStart, at))) continue;
    let spanEnd = from[end - 1] + 1;
    while (spanEnd < src.length && (HARAKA.test(src[spanEnd]) || src[spanEnd] === TATWEEL)) spanEnd += 1;
    const span = src.slice(from[at], spanEnd);
    out.push({ text: src.slice(from[wordStart], spanEnd), marked: HARAKA.test(span) });
  }
  return out;
}

/**
 * Issues with a Script the writer generated: the text rules, then Targeted
 * Diacritics on the writer's product terms and on HOMOGRAPHS.
 */
export function generatedScriptIssues(script: string, productTerms: readonly string[]): ScriptIssue[] {
  const issues = scriptTextIssues(script);
  const missing: string[] = [];
  const unmarked = new Set<string>();
  for (const term of productTerms) {
    if (!bareOf(term)) continue;
    const found = occurrences(script, term);
    if (found.length === 0) missing.push(term);
    for (const o of found) if (!o.marked) unmarked.add(o.text);
  }
  for (const word of HOMOGRAPHS) {
    for (const o of occurrences(script, word)) if (!o.marked) unmarked.add(o.text);
  }
  if (missing.length) {
    issues.push({
      code: 'PRODUCT_TERM_MISSING',
      message: `The product terms ${missing.join('، ')} were reported but do not appear in the Script.`,
      found: missing,
    });
  }
  if (unmarked.size) {
    const words = [...unmarked];
    issues.push({
      code: 'WORD_NOT_MARKED',
      message: `These words need at least one diacritic so the voice cannot misread them: ${words.join('، ')}.`,
      found: words,
    });
  }
  return issues;
}
