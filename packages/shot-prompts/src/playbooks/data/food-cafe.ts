// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Food & café (#32) — drinks, desserts, snacks. One bite or one sip, from food
 * already served: liquid poured between containers and knives cutting food are
 * what video models break (streams that never land, food that heals itself).
 */

import type { Playbook } from '../types.js';
import { AR_START, THROWING, TAKING_APART } from './common.js';

export const FOOD_CAFE: Playbook = {
  id: 'food_cafe',
  version: 1,
  name: 'Food & café',
  allowed_interactions: [
    'A drink: already served in its cup or glass; lift it, take one sip, lower it.',
    'Food: already plated or already out of its wrapper, bite-sized; take one bite, or hold it up to the camera.',
    'A dessert: already served; one spoonful from the surface, then a satisfied smile.',
  ],
  banned_motions: [
    {
      id: 'pouring',
      why: 'the drink is already served: nothing is poured, stirred in or topped up on camera',
      en: [String.raw`\b(?:pour(?:s|ing|ed)?|refill(?:s|ing|ed)?|top(?:s|ping|ped)?\s+up|drizzl\w*|decant\w*)\b`],
      ar: [AR_START + String.raw`(?:تصب|يصب|تسكب|يسكب|تملا|يملا|تعبي|يعبي)(?!\p{L})`],
    },
    {
      id: 'cutting',
      why: 'the food is already served in bite-sized pieces: nothing is cut, sliced or chopped on camera',
      en: [
        String.raw`\b(?:cuts|cutting|slic(?:es|ing|ed)|chop(?:s|ping|ped)?|dic(?:es|ing|ed)|carv(?:e|es|ing|ed))\b`,
        String.raw`\b(?:cut|slice|dice)\s+(?:into|through|up|off|open|the|it|a|an|her|his)\b`,
      ],
      ar: [
        AR_START + String.raw`(?:تقطع|يقطع|تقطيع|تشرح|يشرح|تفرم|يفرم)\s+(?:ال)?(?:كيك|كعك|خبز|فاكه|لحم|قطع|تفاح|شوكولا|حلا|طعام|اكل)\S*`,
      ],
    },
    TAKING_APART,
    THROWING,
  ],
  negatives: {
    people: [
      'One bite or one sip, from food or drink already served: nothing is poured, cut or unwrapped on camera.',
      'The cup, glass or plate keeps the same amount and shape until the one bite or sip.',
    ],
    product: ['Nothing is poured or cut; no liquid moves between containers.'],
  },
  defaults: {
    energy: 'lively',
    performance: 'One real, happy reaction after the bite or sip: eyes light up, a small closed-mouth smile and a nod.',
  },
  patterns: [],
};
