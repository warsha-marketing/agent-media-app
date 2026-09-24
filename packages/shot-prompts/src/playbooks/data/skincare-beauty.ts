// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Skincare & beauty (#32) — creams, serums, pumps and droppers, lipsticks.
 * One small amount, applied once: repeated pumping multiplies nozzles and
 * drops, and fingers dug deep into a jar melt into the cream.
 */

import type { Playbook } from '../types.js';
import { AR_START, THROWING, TAKING_APART, gap } from './common.js';

export const SKINCARE_BEAUTY: Playbook = {
  id: 'skincare_beauty',
  version: 1,
  name: 'Skincare & beauty',
  allowed_interactions: [
    'Cream in a jar: the lid is already off; one fingertip takes a small amount from the surface and smooths it onto the back of the other hand.',
    'Pump or dropper bottle: already open; one press (or one drop) onto the fingertips or the back of the hand, then it is rubbed in gently.',
    'Lipstick or balm: already uncapped and twisted up; held up to the camera, or one short stroke on the back of the hand.',
  ],
  banned_motions: [
    {
      id: 'repeated_pumping',
      why: 'one press of the pump (or one drop) only: repeated pumping multiplies the nozzle and the drops',
      en: [
        String.raw`\b(?:pump|press|squeez|squirt)(?:s|es|ing|ed|e)?\s+${gap(3)}(?:twice|two|three|four|several|multiple|many|a\s+few|repeatedly|again|more)\b`,
        String.raw`\b(?:two|three|four|several|multiple|many|a\s+few)\s+(?:pumps|presses|squirts|drops)\b`,
      ],
      ar: [
        AR_START + String.raw`(?:تضغط|يضغط|تعصر|يعصر)(?:\s+\S+){0,2}?\s+(?:مرتين|مرات|عده|ثلاث|اكثر)\S*`,
        String.raw`(?<!\p{L})(?:ضغطتين|ضغطات|عده\s+ضغطات)`,
      ],
    },
    {
      id: 'deep_dipping',
      why: 'one fingertip takes a small amount from the surface: fingers are never dipped deep or a big scoop taken',
      en: [
        String.raw`\b(?:dip|dips|dipping|dipped|plung\w*|dig(?:s|ging)?|dug|sink(?:s|ing)?|push(?:es|ing|ed)?)\s+${gap(3)}(?:deep|deeply|all\s+the\s+way|whole\s+hand|fingers?\s+in(?:to)?|hand\s+in(?:to)?)\b`,
        String.raw`\b(?:large|big|huge|generous|thick|heaping)\s+(?:scoop|dollop|glob|amount|layer|handful)s?\b|\bhandfuls?\s+of\b`,
      ],
      ar: [
        AR_START + String.raw`(?:تغمس|يغمس|تغرس|يغرس|تدخل|يدخل)\s+(?:ال)?(?:اصابع|اصبع|يد)\S*`,
        String.raw`(?<!\p{L})(?:كميه\s+كبيره|كثير\s+من\s+الكريم)`,
      ],
    },
    TAKING_APART,
    THROWING,
  ],
  negatives: {
    people: [
      'One small amount, applied once: one press, one drop or one fingertip; no repeated pumping, no fingers dipped deep.',
      'The lid or cap is already off and out of sight; nothing is opened or closed on camera.',
    ],
    product: ['The product stays exactly as in the product photo; no cream or liquid leaves it.'],
  },
  defaults: {
    energy: 'calm',
    performance: 'A soft, pleased closed-mouth smile while the product is smoothed in; eyes on the hands, then a glance to camera.',
  },
  patterns: [],
};

