// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The banned-motion check (#32): text that goes into a shot — the Product
 * Interaction, an edited shot field — must not ask for a motion the product's
 * Playbook bans (fragrance: the bottle brought to the face; food: pouring; …).
 * Matched like the guardrail check (./../guardrail-check.ts foldForGuardrails:
 * case, diacritics and Arabic letter variants folded), clause by clause. A
 * match a negation GOVERNS ("she never brings the bottle to her face", "does
 * not bring", "لا تقرب", "ما تقرّب") rules the motion out rather than asking
 * for it; a negation that governs another word does not ("without hesitation
 * she brings the bottle to her face" is banned).
 *
 * Pure: the workflow sandbox imports it.
 */

import { foldForGuardrails } from '../guardrail-check.js';
import type { BannedMotion, Playbook } from './types.js';

export interface BannedMotionIssue {
  /** The Playbook whose rule it breaks. */
  playbook: string;
  /** The rule (BannedMotion.id). */
  rule: string;
  /** The words that matched, as folded for matching. */
  matched: string;
  why: string;
}

/**
 * A negation word, folded (English, then Arabic with an optional و/ف before
 * it). ما is also "what": it negates only right before the verb.
 */
const NEGATION = /^(?:never|not|no|nobody|without|nor|cannot|can't|don't|doesn't|didn't|won't|wouldn't|isn't|dont|doesnt|didnt|wont|cant|[وف]?(?:لا|لن|لم|ما|بدون|دون|بلا))$/u;
const NEGATION_MA = /^[وف]?ما$/u;

/**
 * The one word a negation may have between it and the verb it governs: an
 * auxiliary, a pronoun or "ever" ("does not ever bring", "no one brings",
 * "لا هي تقرب"). Never after ما.
 */
const GOVERNED_GAP = /^(?:she|he|they|it|you|we|one|ever|even|do|does|did|will|would|should|can|could|may|might|must|shall|be|is|are|هي|هو|هم|انت|انتي)$/u;

/** A word as the negation check reads it: curly apostrophes straightened, no punctuation around it. */
const bareWord = (w: string) => w.replace(/[’‘]/g, "'").replace(/^[^\p{L}']+|[^\p{L}']+$/gu, '');

const compiled = new WeakMap<BannedMotion, RegExp[]>();

/** A rule's patterns, compiled once (global, Unicode). Throws on a pattern that is not a RegExp. */
export function bannedMotionPatterns(rule: BannedMotion): RegExp[] {
  let res = compiled.get(rule);
  if (!res) {
    res = [...rule.en, ...rule.ar].map((src) => new RegExp(src, 'gu'));
    compiled.set(rule, res);
  }
  return res;
}

/**
 * Whether a negation governs the match at `index` in `clause`: the word right
 * before it negates it ("never brings", "لا تقرب", "ما تقرب"), or the word
 * before that does with one auxiliary or pronoun between ("does not ever
 * bring", "no one brings"). A negation further away governs another verb:
 * "without hesitation she brings the bottle to her face" is still banned.
 */
function negated(clause: string, index: number): boolean {
  const words = clause.slice(0, index).split(/\s+/).map(bareWord).filter(Boolean);
  const last = words.at(-1);
  if (last === undefined) return false;
  if (NEGATION.test(last)) return true;
  const before = words.at(-2);
  return before !== undefined && GOVERNED_GAP.test(last) && NEGATION.test(before) && !NEGATION_MA.test(before);
}

/**
 * The first match of `rule` in `folded` that no negation governs, or null.
 * One motion can match several of a rule's patterns (from its verb, "brings
 * the bottle to her face", and from its noun, "bottle to her face"): a match
 * inside a negated match of the same rule is that same, negated motion.
 */
function ruleMatch(rule: BannedMotion, folded: string): string | null {
  // Clause by clause: a negation in one clause never excuses the next ("never
  // rushes, then brings the bottle to her face" is still banned).
  for (const clause of folded.split(/[,.;:!?،؛]+/)) {
    const found: Array<{ start: number; end: number; text: string; negated: boolean }> = [];
    for (const re of bannedMotionPatterns(rule)) {
      re.lastIndex = 0;
      for (let m = re.exec(clause); m; m = re.exec(clause)) {
        found.push({ start: m.index, end: m.index + m[0].length, text: m[0].trim(), negated: negated(clause, m.index) });
        if (m[0].length === 0) re.lastIndex += 1;
      }
    }
    const excused = found.filter((f) => f.negated);
    const hit = found
      .sort((a, b) => a.start - b.start)
      .find((f) => !f.negated && !excused.some((e) => f.start >= e.start && f.start < e.end));
    if (hit) return hit.text;
  }
  return null;
}

/** The first of `playbook`'s banned motions `text` asks for, or null when it asks for none. */
export function bannedMotionIssue(text: string | null | undefined, playbook: Playbook | null | undefined): BannedMotionIssue | null {
  if (!playbook) return null;
  const folded = foldForGuardrails(text ?? '');
  if (!folded) return null;
  for (const rule of playbook.banned_motions) {
    const matched = ruleMatch(rule, folded);
    if (matched) return { playbook: playbook.id, rule: rule.id, matched, why: rule.why };
  }
  return null;
}

/** The refusal line for a banned motion, naming where it was written ("The Product Interaction", "Scene"). */
export function bannedMotionMessage(where: string, issue: BannedMotionIssue, playbookName: string): string {
  return `${where} asks for a motion the ${playbookName} Playbook bans: "${issue.matched}" — ${issue.why}.`;
}
