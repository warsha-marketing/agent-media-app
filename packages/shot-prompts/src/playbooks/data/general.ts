// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * General (#32) — the conservative Playbook for every category without its own
 * rules yet (fashion & modest wear, home, other): hold it, show it, use it
 * once. It bans only what breaks every product on video: taking it apart,
 * unwrapping it, pouring, cutting and throwing.
 */

import type { Playbook } from '../types.js';
import { AR_START, THROWING, TAKING_APART } from './common.js';

export const GENERAL: Playbook = {
  id: 'general',
  version: 1,
  name: 'General',
  allowed_interactions: [
    'Hold the product in one hand, already in the state it is used in, and turn it slightly toward the camera.',
    'Use it once, in its simplest everyday way, with one continuous motion.',
    'Fabric or soft goods: already unfolded; one hand smooths or lifts it gently, nothing is put on or taken off.',
  ],
  banned_motions: [
    TAKING_APART,
    THROWING,
    {
      id: 'pouring_cutting',
      why: 'nothing is poured or cut on camera: the product is already ready to use',
      en: [String.raw`\b(?:pour(?:s|ing|ed)?|cuts|cutting|slic(?:es|ing|ed)|chop(?:s|ping|ped)?)\b`],
      ar: [AR_START + String.raw`(?:تصب|يصب|تسكب|يسكب|تقص|يقص)(?!\p{L})`],
    },
  ],
  negatives: {
    people: ['One main hand-and-product action in this shot; the product is already in the state it is used in and stays in one piece.'],
  },
  defaults: {
    energy: 'natural',
  },
  patterns: [],
};
