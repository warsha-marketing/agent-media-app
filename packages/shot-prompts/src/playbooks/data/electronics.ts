// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Electronics (#32) — phones, earbuds, gadgets. The device is already out of
 * its box with its films off; one press or one tap. Peeling films and typing
 * long text invent screens and fingers.
 */

import type { Playbook } from '../types.js';
import { AR_START, THROWING, TAKING_APART, gap } from './common.js';

export const ELECTRONICS: Playbook = {
  id: 'electronics',
  version: 1,
  name: 'Electronics',
  allowed_interactions: [
    'A device already out of its box, films already off: hold it and press one button or tap the screen once.',
    'Earbuds or a wearable: already out of the case; put one on in one smooth move, or hold it toward the camera.',
    'The screen, if on, shows a plain lock screen or a simple colour, never readable text.',
  ],
  banned_motions: [
    {
      id: 'unboxing_peel',
      why: 'the device is already out of its box with its films off: nothing is unboxed or peeled on camera',
      en: [
        String.raw`\bpeel(?:s|ing|ed)?\s+(?:off\s+|away\s+|back\s+)?${gap(2)}(?:film|protector|sticker|plastic|wrap|wrapping|seal|cover|layer)s?\b`,
        String.raw`\bopen(?:s|ing|ed)?\s+(?:the\s+|its\s+|a\s+)?(?:box|packaging|package|carton)\b`,
        String.raw`\b(?:lift(?:s|ing|ed)?|pull(?:s|ing|ed)?|slid(?:e|es|ing))\s+(?:off\s+)?(?:the\s+)?(?:box\s+)?lid\b`,
      ],
      ar: [
        AR_START + String.raw`(?:تقشر|يقشر|تنزع|ينزع|تزيل|يزيل|تشيل|يشيل)\s+(?:ال)?(?:لاصق|غلاف|بلاستيك|نايلون|حمايه|ستيكر)\S*`,
        AR_START + String.raw`(?:تفتح|يفتح)\s+(?:ال)?(?:علبه|كرتون|صندوق)\S*`,
      ],
    },
    {
      id: 'long_typing',
      why: 'one press or one tap only: no typing, and no readable text on the screen',
      en: [
        String.raw`\btyp(?:e|es|ing|ed)\s+${gap(3)}(?:message|messages|text|texts|email|emails|paragraph|sentence|words?|essay|note|notes|long|out|away|quickly|fast)\b`,
        String.raw`\b(?:texting|typing)\b`,
        String.raw`\b(?:scroll(?:s|ing|ed)?)\s+${gap(2)}(?:feed|through|down|up)\b`,
      ],
      ar: [AR_START + String.raw`(?:تكتب|يكتب|تطبع|يطبع)(?!\p{L})`],
    },
    TAKING_APART,
    THROWING,
  ],
  negatives: {
    people: [
      'The device is already out of its box, films off: one press or one tap, no typing and no scrolling.',
      'The screen shows no readable text: off, a plain lock screen or a simple colour.',
    ],
    product: ['The screen shows no readable text: off, a plain lock screen or a simple colour.'],
  },
  defaults: {
    energy: 'natural',
    performance: 'A quick impressed look: raised eyebrows and a small closed-mouth smile at the device.',
  },
  patterns: [
    {
      id: 'one-tap',
      presets: {
        hands_on: {
          roles: {
            'hands-use': {
              scene: '{hands} hold the device, already out of its box, and tap it once.',
              action: 'One tap on the screen or one press of a button; the screen shows no readable text.',
            },
          },
        },
      },
    },
  ],
};
