// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The banned-motion check (#32): text that goes into a shot — the Product
 * Interaction, an edited shot field — must not ask for a motion the product's
 * Playbook bans (fragrance: the bottle brought to the face; food: pouring; …).
 * Matched like the guardrail check (./../guardrail-check.ts foldForGuardrails:
 * case, diacritics and Arabic letter variants folded), clause by clause, and a
 * match right after a negation ("she never brings the bottle to her face")
 * states the rule rather than breaking it.
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

/** Words that negate what follows them within a few words (English, then Arabic folded). */
const NEGATION = /(?:^|[^\p{L}])(?:never|not|no|without|don't|doesn't|dont|doesnt|nor|لا|لن|لم|ما|بدون|دون|ابدا|بلا)(?:[^\p{L}]|$)/u;

/** How far before a match a negation still negates it, in words. */
const NEGATION_WINDOW = 4;

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

/** Whether the words just before `index` in `clause` negate it. */
function negated(clause: string, index: number): boolean {
  const before = clause.slice(0, index).split(/\s+/).filter(Boolean).slice(-NEGATION_WINDOW).join(' ');
  return NEGATION.test(before);
}

/** The first match of `rule` in `folded` that is not negated, or null. */
function ruleMatch(rule: BannedMotion, folded: string): string | null {
  // Clause by clause: a negation in one clause never excuses the next ("never
  // rushes, then brings the bottle to her face" is still banned).
  for (const clause of folded.split(/[,.;:!?،؛]+/)) {
    for (const re of bannedMotionPatterns(rule)) {
      re.lastIndex = 0;
      for (let m = re.exec(clause); m; m = re.exec(clause)) {
        if (!negated(clause, m.index)) return m[0].trim();
        if (m[0].length === 0) re.lastIndex += 1;
      }
    }
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
