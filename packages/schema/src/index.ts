// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * @agent-media/schema — Single source of truth for all enums, types,
 * and validation schemas in the agent-media platform.
 */

export * from './video.js';
export * from './generators.js';
export * from './actors.js';
export * from './account.js';
export * from './errors.js';
export * from './tooling/contracts.js';
// Shared take planner — quote (api-v2) and execution (primitive-worker-vnext)
// MUST plan identically. See src/take-planner.ts.
export * from './take-planner.js';
// Clip prices (credits + provider USD) — the one table quote and charge share.
export * from './video-pricing.js';
export * from './video-models.js';
// Product Hero shot plan + cost budget — quote (api-v2) and render
// (primitive-worker-vnext) plan identically. See src/product-hero.ts.
export * from './product-hero.js';
// Presets as data (#16): the definition type, the shared shot planner and
// pricing, and the registry of every Preset. See src/preset-definition.ts.
export * from './preset-definition.js';
export * from './preset-registry.js';
// Reaction Preset (#19): a silent reacting face intercut with the product.
export * from './presets/reaction.js';
// Starting frames (#18): shots animated from a generated frame, priced with the clips.
export * from './starting-frames.js';
// Hands-on (#18): the definition, hand genders and the setting list.
export * from './presets/hands-on.js';
// Modesty Default (#17): levels, the per-Preset rule, the user-facing choice and its resolution.
export * from './modesty.js';
// Delivery Tags — the allowed list and the strip helpers (Captions, viewer display).
export * from './delivery-tags.js';
// Product Interaction (#25) — its limit and how it is tidied (api-v2, worker and web share them).
export * from './product-interaction.js';
// Arabic Captions (#10) — words and cues from the voiced Script's alignment (no speech-to-text).
export * from './captions.js';
// Edited caption lines (#22) — the Caption editor's lines and style, checked by the export route and workflow.
export * from './caption-lines.js';
// Music Bed — per-Preset licensed track set (data) + the on/off/which-track
// decision the quote and the render share. See src/music-bed/.
export * from './music-bed/index.js';
// Dialects — the one list (every Dialect, and the ones a Script can be written in).
export * from './dialects.js';
// Product Profile (#30) — the vision understanding of one product (category, size, parts, used state, risks).
export * from './product-profile.js';
