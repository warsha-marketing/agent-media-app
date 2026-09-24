// Copyright 2026 agent-media contributors. Apache-2.0 license.

import type { WorkerConfig } from '../config.js';
import { makePortraitGpt2Activity } from './portrait-gpt2.js';
import { makeCharacterSheetGpt2Activity } from './character-sheet-gpt2.js';
import { makeSimpleSelfieActivity } from './simple-selfie.js';
import { makeProductInHandsActivity } from './product-in-hands.js';
import { makeComposedSkillStateActivity } from './composed-state.js';
import { makeSubtitlesActivity } from './subtitles.js';
import { makeWireframeGpt2Activity } from './wireframe-gpt2.js';
import { makeLipSyncActivity } from './lip-sync.js';
import { makeExtractLastFrameActivity } from './extract-last-frame.js';
import { makeExtractTailClipActivity } from './extract-tail-clip.js';
import { makeExtractAudioActivity } from './extract-audio.js';
import { makeComposeBrollOverlayActivity } from './compose-broll-overlay.js';
import { makePodcastSceneActivity } from './podcast-scene.js';
import { makePodcastReframeActivity } from './podcast-reframe.js';
import { makeRefundCreditsActivity } from './refund-credits.js';
import { makeMarkPrimitiveRunFailedActivity } from './mark-run-failed.js';
import {
  makeFetchDraftAudioActivity,
  makePresetClipActivity,
  makePresetMuxActivity,
  makeReleaseDraftRenderActivity,
} from './preset-render.js';
// Music Bed (#9) — self-contained; mixed after the Product Hero cut.
import { makeMixMusicBedActivity } from './music-bed.js';
// Arabic Captions (#10) — burned last, from cues the workflow derives from the draft alignment.
import { makeBurnCaptionsActivity } from './captions.js';
// Starting frames (#18) — e.g. Hands-on's product-in-hands image, made before its clip.
import { makePresetStartingFrameActivity } from './preset-frame.js';
// In-use Reference (#31) — the product photo edited into its used state, before any frame or clip.
import { makePresetInUseReferenceActivity } from './in-use-reference.js';

export function createActivities(cfg: WorkerConfig) {
  return {
    refundCredits: makeRefundCreditsActivity(cfg),
    markPrimitiveRunFailed: makeMarkPrimitiveRunFailedActivity(cfg),
    portraitGpt2: makePortraitGpt2Activity(cfg),
    characterSheetGpt2: makeCharacterSheetGpt2Activity(cfg),
    simpleSelfie: makeSimpleSelfieActivity(cfg),
    productInHands: makeProductInHandsActivity(cfg),
    composedSkillState: makeComposedSkillStateActivity(cfg),
    subtitles: makeSubtitlesActivity(cfg),
    wireframeGpt2: makeWireframeGpt2Activity(cfg),
    lipSync: makeLipSyncActivity(cfg),
    extractLastFrame: makeExtractLastFrameActivity(cfg),
    extractTailClip: makeExtractTailClipActivity(cfg),
    extractAudio: makeExtractAudioActivity(cfg),
    composeBrollOverlay: makeComposeBrollOverlayActivity(cfg),
    podcastScene: makePodcastSceneActivity(cfg),
    podcastReframe: makePodcastReframeActivity(cfg),
    fetchDraftAudio: makeFetchDraftAudioActivity(cfg),
    presetClip: makePresetClipActivity(cfg),
    presetMux: makePresetMuxActivity(cfg),
    releaseDraftRender: makeReleaseDraftRenderActivity(cfg),
    mixMusicBed: makeMixMusicBedActivity(cfg),
    burnCaptions: makeBurnCaptionsActivity(cfg),
    presetStartingFrame: makePresetStartingFrameActivity(cfg),
    presetInUseReference: makePresetInUseReferenceActivity(cfg),
  };
}

export type PrimitiveActivities = ReturnType<typeof createActivities>;
