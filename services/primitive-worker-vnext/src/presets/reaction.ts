// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Reaction render definition (#19) — the server-side half of the Reaction
 * Preset: its shot prompts. The public half (shot plan, face-shot maximum,
 * budget) is REACTION in @agentmedia/schema.
 *
 * `@image1` is the product photo on every shot. Reaction shots also get the
 * saved character's reference as `@image2` (the pipeline passes it on shots
 * that show a person, and only those). The Modesty Default is appended to every
 * reaction prompt by the pipeline (presetShotPrompt).
 *
 * A Voice-over Short, never a Talking-head Short: the voice-over carries every
 * word, so the face must never look like it speaks (a moving mouth under an
 * Arabic voice reads as a bad dub). Every reaction prompt therefore carries
 * SILENT_REACTION, and each face stays on screen at most REACTION_MAX_SHOT_MS.
 *
 * Pure data: the workflow sandbox imports this.
 */

import { REACTION, type ReactionShotKind } from '@agentmedia/schema';
import type { PresetRenderDefinition } from './index.js';

/** The no-speaking instruction every reaction prompt carries, verbatim. */
export const SILENT_REACTION =
  'The person never speaks: the mouth stays closed the whole shot, lips gently together, no talking, no mouthing words, no lip movement, no singing, no whispering. They react only with their eyes, eyebrows, a closed-mouth smile and small head movements.';

export const REACTION_RENDER: PresetRenderDefinition<ReactionShotKind> = {
  ...REACTION,
  shotPrompts: {
    reaction:
      'Vertical 9:16 UGC-style reaction shot, medium close-up. The person in @image2 — exactly this person, identical face, hair, skin and features — holds the exact product in @image1 near their face and reacts to it silently with ONE natural reaction: a warm genuine smile, a small approving nod, a moment of pleasant surprise, or eyes closing briefly while enjoying the scent. ' +
      `${SILENT_REACTION} ` +
      'The product keeps its exact shape, colours, logo and label text. Soft natural light, gentle handheld feel, shallow depth of field. No text overlays, no captions.',
    product:
      'Premium product commercial shot of the exact product in @image1: the product stands on a clean, softly lit surface, the camera slowly pushes in and glides a few degrees around it, gentle light moving across its surfaces, settling on a clean three-quarter view. The product keeps its exact shape, colours, logo and label text. No people, no hands, no text overlays, no captions. Vertical 9:16, shallow depth of field, smooth cinematic motion.',
  },
};
