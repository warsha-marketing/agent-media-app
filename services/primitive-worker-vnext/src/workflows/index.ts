// Copyright 2026 agent-media contributors. Apache-2.0 license.

// Single entry point for Temporal's workflow bundler. All workflows in
// this worker must be re-exported here.

export { portraitGpt2Workflow } from './portrait-gpt2.js';
export { characterSheetGpt2Workflow } from './character-sheet-gpt2.js';
export { simpleSelfieWorkflow } from './simple-selfie.js';
export { productInHandsWorkflow } from './product-in-hands.js';
export { makeUgcVideoWorkflow } from './make-ugc-video.js';
export { subtitlesWorkflow } from './subtitles.js';
export { wireframeGpt2Workflow } from './wireframe-gpt2.js';
export { lipSyncWorkflow } from './lip-sync.js';
export { brollTalkingHeadWorkflow } from './broll-talking-head.js';
export { makePodcastWorkflow } from './make-podcast.js';
// Only the per-Preset wrappers are workflow types; the shared pipeline they call
// (./render-preset.ts, renderPreset) is internal and must never be exported here.
export { makeProductHeroWorkflow } from './make-product-hero.js';
export { makeReactionWorkflow } from './make-reaction.js';
// Caption export (#22): burns the Caption editor's lines onto a clean Short.
export { captionExportWorkflow } from './caption-export.js';
