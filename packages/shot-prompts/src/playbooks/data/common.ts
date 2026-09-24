// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Building blocks the Playbooks share: pattern pieces (RegExp sources matched
 * on folded text, see ../banned-motion.ts) and the rules more than one
 * Playbook bans. Data only.
 */

import type { BannedMotion } from '../types.js';

/** Not inside a word; an optional و/ف conjunction before it (Arabic, folded). */
export const AR_START = String.raw`(?<!\p{L})[وف]?`;
/** A few words in between, never across a clause (the check splits on punctuation). */
export const gap = (n: number) => String.raw`(?:\S+\s+){0,${n}}?`;
/** A possessive or article before a noun. */
export const DET = String.raw`(?:(?:the|her|his|their|its|a|an|one)\s+)?`;

/** Two-handed part removal, unwrapping and assembling on camera: what video models break (#27). Every Playbook bans it. */
export const TAKING_APART: BannedMotion = {
  id: 'part_removal',
  why: 'the product is already in the state it is used in: nothing is unwrapped, unboxed, taken apart or assembled on camera',
  en: [
    String.raw`\b(?:unwrap(?:s|ping|ped)?|unbox(?:es|ing|ed)?|disassembl\w*|assembl(?:e|es|ing|ed))\b`,
    String.raw`\b(?:tak(?:e|es|ing)|took|pull(?:s|ing|ed)?|break(?:s|ing)?)\s+(?:it\s+|them\s+|the\s+\S+\s+)?apart\b`,
    String.raw`\bwith\s+(?:both|two)\s+hands\s+${gap(2)}(?:remov\w*|pull\w*|twist\w*|tak(?:e|es|ing)\s+off|pri(?:es|ed)|prying)\b`,
    String.raw`\b(?:remov\w*|pull\w*|twist\w*|tak(?:e|es|ing)\s+off|prying|pri(?:es|ed))\s+${gap(3)}with\s+(?:both|two)\s+hands\b`,
  ],
  ar: [
    AR_START + String.raw`(?:تفك|يفك|تفتح|يفتح|تمزق|يمزق)\s+(?:ال)?(?:غلاف|تغليف|كرتون|علبه|صندوق)\S*`,
    AR_START + String.raw`(?:تفكك|يفكك)(?!\p{L})`,
    AR_START + String.raw`(?:تنزع|ينزع|تفك|يفك|تسحب|يسحب|تلوي|يلوي)(?:\s+\S+){0,2}?\s+(?:بكلتا|بكلا)\s+(?:اليدين|يديها|يديه)`,
  ],
};

/** Throwing, tossing or juggling the product: it multiplies, melts or vanishes mid-air. Every Playbook bans it. */
export const THROWING: BannedMotion = {
  id: 'throwing',
  why: 'the product stays in the hand or on a surface: it is never thrown, tossed or juggled',
  en: [String.raw`\b(?:throw(?:s|ing)?|threw|toss(?:es|ing|ed)?|juggl\w*|flip(?:s|ping|ped)?\s+${DET}(?:bottle|product|jar|can|cup|phone|device|box))\b`],
  ar: [AR_START + String.raw`(?:ترمي|يرمي|تقذف|يقذف)\s+(?:ال)?(?:زجاجه|منتج|علبه|قاروره|جهاز|كوب)\S*`],
};
