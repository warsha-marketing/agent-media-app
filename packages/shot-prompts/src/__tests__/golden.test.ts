// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// GOLDEN (#28): the default composed Shot Prompts of every Preset, exactly as
// the worker hands them to presetClip / presetStartingFrame (reference tokens
// still in; each provider adapter swaps them for its syntax). A render without
// edits renders these words. They say what the #26 prompts said, now composed
// from each shot's structured fields in the fixed order, with the Guardrails
// per stage (and #28's simple-physics line on hands and person clips).
//
// A change here changes every Short of that Preset: update the snapshot only on
// purpose (vitest -u), and say why in the commit.

import { describe, it, expect } from 'vitest';
import { HANDS_ON, PRODUCT_HERO, REACTION, type Modesty } from '@agentmedia/schema';
import {
  HANDS_ON_PROMPTS,
  IMAGE_REFERENCES,
  PRODUCT_HERO_PROMPTS,
  REACTION_PROMPTS,
  REFERENCE_TOKENS,
  composeShotPlan,
  shotPrompt,
  type ShotPlanPreset,
} from '../index.js';

const PERFUME = 'removes the cap, sprays once on the inner wrist, brings the wrist to the nose, smiles';
const COVERED: Modesty = { arms: 'covered', hijab: false };
const GULF: Modesty = { arms: 'covered', hijab: true };

const golden = (preset: ShotPlanPreset, ctx: Parameters<typeof composeShotPlan>[1]) =>
  composeShotPlan(preset, ctx).shots.map((s) => ({
    shot_id: s.shot_id,
    ...(s.frame_scene !== null ? { image: shotPrompt(s, 'image', IMAGE_REFERENCES) } : {}),
    video: shotPrompt(s, 'video', REFERENCE_TOKENS),
  }));

describe('the default Shot Prompts (golden)', () => {
  it('Product Hero, 12.5 s', () => {
    expect(golden({ ...PRODUCT_HERO, ...PRODUCT_HERO_PROMPTS } as ShotPlanPreset, { durationMs: 12_500, modesty: COVERED })).toMatchInlineSnapshot(`
      [
        {
          "shot_id": "hero",
          "video": "The product is exactly the product in {{start_image}}: it keeps its exact shape, colours, logo and label text. Premium product commercial, hero shot of the product. The product stands centered on a clean, softly lit surface. Calm, unhurried pace. The camera slowly pushes in and orbits a few degrees, smooth cinematic motion. Shallow depth of field. Gentle rim light glides across its surfaces. No people, no hands. No text overlays, no captions. Vertical 9:16.",
        },
        {
          "shot_id": "detail",
          "video": "The product is exactly the product in {{start_image}}: it keeps its exact shape, colours, logo and label text. Premium product commercial, closing detail shot of the product. Its texture, materials and finish are revealed. The shot settles on a clean three-quarter view of the whole product. Calm, unhurried pace. A slow macro slide along the product, smooth cinematic motion. Soft studio light. No people, no hands. No text overlays, no captions. Vertical 9:16.",
        },
      ]
    `);
  });

  it('Reaction, 9 s, a Gulf woman (hijab), with a Product Interaction', () => {
    expect(
      golden({ ...REACTION, ...REACTION_PROMPTS } as ShotPlanPreset, { durationMs: 9_000, modesty: GULF, interaction: PERFUME }),
    ).toMatchInlineSnapshot(`
      [
        {
          "shot_id": "reaction",
          "video": "The person is exactly the person in {{person_image}}: identical face, hair, skin and features. The product is exactly the product in {{start_image}}: it keeps its exact shape, colours, logo and label text. UGC-style reaction shot, medium close-up. The person reacts to the product. The person holds the product near their face. They react silently with ONE natural reaction: a warm genuine smile, a small approving nod, a moment of pleasant surprise, or eyes closing briefly while enjoying the scent. How the product is used, as a real person uses it: removes the cap, sprays once on the inner wrist, brings the wrist to the nose, smiles. Natural, everyday pace, like a real moment caught on a phone. Gentle handheld feel. Shallow depth of field. Soft natural light. The person never speaks: the mouth stays closed the whole shot, lips gently together, no talking, no mouthing words, no lip movement, no singing, no whispering. They react only with their eyes, eyebrows, a closed-mouth smile and small head movements. The hands and the product stay physically simple: one continuous action, the product already in the state it is used in, no parts appearing, vanishing or coming apart. The camera and the body may move freely. Modest styling: the person wears loose, modest clothing with long sleeves reaching the wrists and a high neckline; no bare arms or shoulders. She wears a neat hijab that fully covers her hair, ears and neck, the same in every frame. No text overlays, no captions. Vertical 9:16.",
        },
        {
          "shot_id": "product-closer",
          "video": "The product is exactly the product in {{start_image}}: it keeps its exact shape, colours, logo and label text. Premium product commercial shot of the product. The product stands on a clean, softly lit surface. The shot settles on a clean three-quarter view. Calm, unhurried pace. The camera slowly pushes in and glides a few degrees around it, smooth cinematic motion. Shallow depth of field. Gentle light moves across its surfaces. No people, no hands. No text overlays, no captions. Vertical 9:16.",
        },
      ]
    `);
  });

  it('Hands-on, 9 s, a woman’s hands at the dressing table, with a Product Interaction', () => {
    expect(
      golden({ ...HANDS_ON, ...HANDS_ON_PROMPTS } as ShotPlanPreset, {
        durationMs: 9_000,
        modesty: COVERED,
        vars: HANDS_ON_PROMPTS.promptVars!({ hand_gender: 'female', setting: 'dressing_table' }),
        interaction: PERFUME,
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "image": "The product is exactly the product in the reference image: it keeps its exact shape, colours, logo and label text. Photorealistic first-person (POV) photograph, vertical composition: a woman's hands with neat, natural nails have just lifted the product out of its open packaging and hold it toward the camera, at an elegant dressing table with a softly lit mirror and a few tasteful accessories. The product is sharp and in focus, label facing the camera. Natural, flattering light, realistic skin texture, shallow depth of field. How the product is used, as a real person uses it: removes the cap, sprays once on the inner wrist, brings the wrist to the nose, smiles. Only the hands and forearms are in frame: no face, no other person. Modest styling: the arms are covered by long sleeves reaching the wrists; no bare forearms. No text overlays, no captions, no watermark.",
          "shot_id": "hands-use",
          "video": "The video starts exactly from the frame in {{start_image}}, and the product keeps its exact shape, colours, logo and label text. First-person POV product video. A woman's hands with neat, natural nails lift the product clear of its packaging, turn it slowly to show it from a few angles and use it naturally. The shot ends with the product held up toward the camera, label facing the lens. The hands use it at an elegant dressing table with a softly lit mirror and a few tasteful accessories. How the product is used, as a real person uses it: removes the cap, sprays once on the inner wrist, brings the wrist to the nose, smiles. Natural, everyday pace, like a real moment caught on a phone. Smooth, gentle handheld motion. Natural light. Only the hands and forearms are visible: no face, nobody speaks. The hands and the product stay physically simple: one continuous action, the product already in the state it is used in, no parts appearing, vanishing or coming apart. The camera and the body may move freely. Modest styling: the arms are covered by long sleeves reaching the wrists; no bare forearms. No text overlays, no captions. Vertical 9:16.",
        },
        {
          "shot_id": "product-closer",
          "video": "The product is exactly the product in {{start_image}}: it keeps its exact shape, colours, logo and label text. Closing product shot of the product. The shot settles on a clean three-quarter view of the whole product. The product stands on a clean surface at an elegant dressing table with a softly lit mirror and a few tasteful accessories. Calm, unhurried pace. A slow push-in, smooth cinematic motion. Shallow depth of field. Soft light glides across it. No people, no hands. No text overlays, no captions. Vertical 9:16.",
        },
      ]
    `);
  });
});
