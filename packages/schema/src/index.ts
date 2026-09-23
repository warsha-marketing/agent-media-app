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
// Product Hero shot plan + cost budget — quote (api-v2) and render
// (primitive-worker-vnext) plan identically. See src/product-hero.ts.
export * from './product-hero.js';
// Presets as data (#16): the definition type, the shared shot planner and
// pricing, and the registry of every Preset. See src/preset-definition.ts.
export * from './preset-definition.js';
export * from './preset-registry.js';
// Delivery Tags — the allowed list and the strip helpers (Captions, viewer display).
export * from './delivery-tags.js';
// Music Bed — per-Preset licensed track set (data) + the on/off/which-track
// decision the quote and the render share. See src/music-bed/.
export * from './music-bed/index.js';
// Dialects — the one list (every Dialect, and the ones a Script can be written in).
export * from './dialects.js';
