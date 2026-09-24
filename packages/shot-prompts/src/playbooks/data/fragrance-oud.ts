// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Fragrance & oud (#32) — perfume, oud oil and attar, bakhoor.
 *
 * From test M3 (2026-09-24): the woman smelled the BOTTLE instead of her wrist
 * — too many actions in one 5 s shot, and the bottle still in her hand. So:
 *   - the bottle is never smelled and never brought to the face: it leaves the
 *     hand (set down) before the wrist comes up;
 *   - spray (or dab) and smell are TWO shots, cut on action: the spray on the
 *     wrist, then a close-up of the wrist rising to the nose — ALWAYS (owner,
 *     #32): dab-then-smell when the Profile says oil, attar or a dab (its
 *     interaction verbs, and nothing sprayed), else spray-then-smell; a Preset
 *     that cannot host the split (no person or hands shot) keeps its own shots;
 *   - one main hand-and-product action per shot.
 */

import type { Playbook } from '../types.js';
import { AR_START, DET, THROWING, TAKING_APART, gap } from './common.js';

const MOVE = String.raw`(?:bring(?:s|ing)?|brought|lift(?:s|ing|ed)?|rais(?:e|es|ing|ed)|hold(?:s|ing)?|held|put(?:s|ting)?|mov(?:e|es|ing|ed)|tilt(?:s|ing|ed)?|press(?:es|ing|ed)?)`;
const BOTTLE = String.raw`(?:bottle|perfume|fragrance|flacon|atomi[sz]er|vial|nozzle|sprayer|product|attar)`;
const FACE = String.raw`(?:face|nose|nostrils?|lips?|mouth|cheeks?)`;
const NEAR = String.raw`(?:to|toward|towards|near|under|against|at|by|beside|close\s+to|next\s+to|in\s+front\s+of)`;

const AR_BOTTLE = String.raw`(?:ال)?(?:زجاجه|قاروره|عطر|بخاخ|منتج|دهن)\S*`;
const AR_FACE = String.raw`(?:ال)?(?:انف|وجه|فم|شفا|خد)\S*`;

export const FRAGRANCE_OUD: Playbook = {
  id: 'fragrance_oud',
  version: 2,
  name: 'Fragrance & oud',
  allowed_interactions: [
    'Perfume: the bottle is already uncapped; hold it at chest height, spray once onto the inner wrist and set the bottle down. Smelling is a separate shot: with empty hands, the wrist rises to the nose.',
    'Oud oil or attar: the bottle is already open; dab one drop onto the inner wrist and set the bottle down. Smelling is a separate shot, the wrist, never the bottle.',
    'Bakhoor: the incense is already smoking in the burner on a surface; one hand gently wafts the smoke. Nobody leans the face into the smoke.',
  ],
  banned_motions: [
    {
      id: 'bottle_to_face',
      why: 'the bottle never comes to the face or nose: it is set down first, then the wrist is raised and smelled',
      en: [
        String.raw`\b${MOVE}\s+(?:up\s+)?${DET}(?:\S+\s+)?${BOTTLE}\s+${gap(3)}${NEAR}\s+${DET}${FACE}\b`,
        String.raw`\b${BOTTLE}\s+(?:is\s+)?(?:held\s+|kept\s+|stays\s+|brought\s+|raised\s+|lifted\s+)?(?:up\s+)?${NEAR}\s+${DET}${FACE}\b`,
        String.raw`\b(?:smell(?:s|ing|ed)?|smelt|sniff(?:s|ing|ed)?|inhal(?:e|es|ing|ed))\s+${DET}(?:\S+\s+)?(?:bottle|flacon|atomi[sz]er|nozzle|cap|vial|sprayer)\b`,
      ],
      ar: [
        AR_START + String.raw`(?:تقرب|يقرب|ترفع|يرفع|تضع|يضع|تمسك|يمسك|تحمل|يحمل|تدني|يدني)\s+${AR_BOTTLE}(?:\s+\S+){0,2}?\s+(?:من|الي|نحو|علي|عند|تحت|قرب|بجانب|امام)\s+${AR_FACE}`,
        AR_START + String.raw`(?:تشم|يشم|تستنشق|يستنشق)\s+(?:ال)?(?:زجاجه|قاروره|بخاخ|غطاء)\S*`,
        String.raw`(?<!\p{L})(?:ال)?(?:زجاجه|قاروره)\S*\s+(?:قرب|عند|امام|بجانب|تحت)\s+${AR_FACE}`,
      ],
    },
    {
      id: 'spray_at_face',
      why: 'the spray goes once onto the inner wrist, never toward the face',
      en: [
        String.raw`\b(?:spray|spritz|mist)(?:s|es|ing|ed)?\s+${gap(3)}(?:at|on|onto|into|in|toward|towards|across|over)\s+${DET}(?:\S+\s+)?(?:face|eyes?|nose|mouth|lips)\b`,
        String.raw`\b(?:spray|spritz|mist)(?:s|es|ing|ed)?\s+(?:her|his|their|the)\s+(?:own\s+)?face\b`,
      ],
      ar: [
        AR_START + String.raw`(?:ترش|يرش|تبخ|يبخ)(?:\s+\S+){0,2}?\s+(?:علي|في|نحو|باتجاه)\s+(?:ال)?(?:وجه|عين|انف|فم)\S*`,
        AR_START + String.raw`(?:ترش|يرش|تبخ|يبخ)\s+(?:ال)?(?:وجه|عين)\S*`,
      ],
    },
    {
      id: 'cap_removal',
      why: 'the bottle is already uncapped when the shot starts: the cap never comes off or goes back on on camera',
      en: [
        String.raw`\b(?:remov(?:e|es|ing|ed)|tak(?:e|es|ing)\s+off|took\s+off|twist(?:s|ing|ed)?\s+off|pull(?:s|ing|ed)?\s+off|pop(?:s|ping|ped)?\s+off|lift(?:s|ing|ed)?\s+off|unscrew(?:s|ing|ed)?|screw(?:s|ing|ed)?\s+off)\s+${DET}(?:\S+\s+)?(?:cap|lid|stopper|top)\b`,
        String.raw`\b(?:twist|pull|pop|take|lift|screw|put|place|snap)\w*\s+${DET}(?:\S+\s+)?(?:cap|lid|stopper)\s+(?:off|back\s+on|on)\b`,
        String.raw`\buncap(?:s|ping)?\b`,
        String.raw`\bopen(?:s|ing|ed)?\s+(?:the|her|his|their|its|a)\s+(?:\S+\s+)?(?:bottle|perfume|flacon|vial)\b`,
      ],
      ar: [AR_START + String.raw`(?:تفتح|يفتح|تنزع|ينزع|تشيل|يشيل|تزيل|يزيل|تفك|يفك|تخلع|يخلع)\s+(?:ال)?(?:غطاء|غطا|سداده)\S*`],
    },
    TAKING_APART,
    THROWING,
  ],
  negatives: {
    people: [
      'The person never brings the bottle itself to their face or nose: the bottle leaves the hand, set down, before the wrist comes up.',
      'The cap is already off and out of sight: no cap appears, comes off or goes back on.',
      'No spray toward the face: at most one spray, onto the inner wrist.',
    ],
    product: ['No spray or mist leaves the bottle; the bottle stays exactly as in the product photo.'],
  },
  defaults: {
    energy: 'calm',
    performance: 'One small genuine reaction: a soft closed-mouth smile or a slow approving nod, eyes relaxed.',
  },
  patterns: [
    {
      id: 'dab-then-smell',
      // Oil or attar, dabbed — unless the Profile says it is sprayed.
      when: {
        verbs_any: ['dab', 'dabs', 'apply', 'rub', 'anoint', 'dot', 'roll', 'oil', 'attar'],
        unless: { verbs_any: ['spray', 'spritz', 'mist'], risks_any: ['liquid_spray'] },
      },
      presets: {
        reaction: {
          order: [
            { role: 'reaction-apply', kind: 'reaction' },
            { role: 'reaction-smell', kind: 'reaction' },
            { role: 'product-cutaway', kind: 'product' },
          ],
          last: { role: 'product-closer', kind: 'product' },
          roles: {
            'reaction-apply': {
              framing: 'UGC-style medium shot, filmed on a phone.',
              scene: 'The person dabs one drop of the oil onto the inner wrist.',
              blocking: 'The open bottle stays at chest height, well away from the face; then it is set down on the surface in front of them and let go.',
              action: 'The person dabs one drop from the already open bottle onto the inner wrist, then sets the bottle down and lets go of it.',
            },
            'reaction-smell': {
              framing: 'UGC-style close-up on the wrist and the face, filmed on a phone.',
              scene: 'The person smells the oil on the inner wrist.',
              blocking:
                'The bottle is already set down, out of the hands and out of frame. The shot starts with the wrist already rising toward the nose, cut on the action.',
              action: 'With empty hands, the person raises the inner wrist to the nose, smells the skin there and smiles.',
            },
          },
        },
        hands_on: {
          roles: {
            'hands-use': {
              scene: '{hands} hold the open bottle and dab one drop onto the inner wrist.',
              action: 'One drop dabbed onto the inner wrist, then the bottle is set down on the surface.',
            },
          },
        },
      },
    },
    {
      id: 'spray-then-smell',
      // Always, when the Profile says no oil, attar or dab: the default split.
      presets: {
        reaction: {
          order: [
            { role: 'reaction-spray', kind: 'reaction' },
            { role: 'reaction-smell', kind: 'reaction' },
            { role: 'product-cutaway', kind: 'product' },
          ],
          last: { role: 'product-closer', kind: 'product' },
          roles: {
            'reaction-spray': {
              framing: 'UGC-style medium shot, filmed on a phone.',
              scene: 'The person sprays the perfume once onto the inner wrist.',
              blocking:
                'The uncapped bottle stays at chest height, well away from the face. The spray happens right at the start of the shot; then the bottle is set down on the surface in front of them and let go.',
              action: 'The person holds the uncapped bottle at chest height, sprays once onto the inner wrist, then sets the bottle down and lets go of it.',
            },
            'reaction-smell': {
              framing: 'UGC-style close-up on the wrist and the face, filmed on a phone.',
              scene: 'The person smells the perfume on the inner wrist.',
              blocking:
                'The bottle is already set down, out of the hands and out of frame. The shot starts with the wrist already rising toward the nose, cut on the action.',
              action: 'With empty hands, the person raises the inner wrist to the nose, smells the skin there and smiles.',
            },
          },
        },
        hands_on: {
          roles: {
            'hands-use': {
              scene: '{hands} hold the uncapped bottle and spray it once onto the inner wrist.',
              action: 'One spray onto the inner wrist, then the bottle is set down on the surface.',
            },
          },
        },
      },
    },
  ],
};
