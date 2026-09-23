// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Every Preset definition, by id. The pipeline looks a Preset up here (or is
 * handed its definition) and never branches on its name. Each Preset's budget
 * is held by tests over this registry.
 */

import type { PresetDefinition } from './preset-definition.js';
import { PRODUCT_HERO } from './product-hero.js';
import { REACTION } from './presets/reaction.js';

export const PRESETS = {
  product_hero: PRODUCT_HERO,
  reaction: REACTION,
} as const satisfies Record<string, PresetDefinition>;

export type PresetId = keyof typeof PRESETS;
