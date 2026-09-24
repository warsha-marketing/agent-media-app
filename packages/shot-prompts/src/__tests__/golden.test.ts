// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// GOLDEN (#28): the default composed Shot Prompts of every Preset, exactly as
// the worker hands them to presetClip / presetStartingFrame (reference tokens
// still in; each provider adapter swaps them for its syntax). A render without
// edits renders these words, composed from each shot's structured fields in
// the fixed order, with the Guardrails per stage.
//
// How they differ from #26's prompts, on purpose (owner feedback from test M3,
// #29 #32 #34, and ADR 0003):
//   - shot ids are roles (hero, detail, reaction, product-closer, hands-use),
//     not #28's kind + ordinal (hero-1, product-1, …);
//   - Hands-on hands frame and clip: the product is already out of its
//     packaging and in its used state, and the hands use it once — no lifting
//     it clear of the packaging, no turning it to a few angles and using it
//     (one main action per shot; the simple_physics Guardrail);
//   - Reaction: the product is never near or brought to the face (#26 had
//     "holds the product near their face"); a smell beat is on the skin of the
//     wrist after the product is set down; no "enjoying the scent" beat;
//   - hands and person shots drop the cinematic wording (shallow depth of
//     field, flattering light) for the realism rules' phone-camera look, sharp
//     background and flat everyday daylight (#26: "Soft natural light"); the
//     Hands-on settings lose golden hour, warm lamplight and a blurred garden;
//   - the perfume Product Interaction starts from the uncapped bottle and sets
//     it down before the wrist rises ("removes the cap, …, brings the wrist to
//     the nose" is gone);
//   - #28's simple-physics line is on every hands and person clip.
//   - #29 (ADR 0003): the realism Guardrail (raw iPhone look, flat everyday
//     light, sharp background, matte skin with pores, no beauty filter) is on
//     every hands and person stage; Reaction's person shot renders on ModelArk
//     Seedance 2.0 Mini, which never gets a re-hosted face: its prompt says who
//     the person is in words and references the product alone ("image 1" once
//     the adapter runs). Its Kling / Veo fallbacks keep the face reference.
//   - #32: a draft with no Product Profile renders under the General
//     Playbook, whose one-main-action line closes every hands and person clip
//     (before the format line); fields and shots unchanged (tested below).
// Product-only shots (Product Hero, the closers) say what #26 said.
//
// A change here changes every Short of that Preset: update the snapshot only on
// purpose (vitest -u), and say why in the commit.

import { describe, it, expect } from 'vitest';
import { HANDS_ON, PRODUCT_HERO, REACTION, shotModelChain, type Modesty } from '@agentmedia/schema';
import {
  HANDS_ON_PROMPTS,
  IMAGE_REFERENCES,
  PRODUCT_HERO_PROMPTS,
  REACTION_PROMPTS,
  REFERENCE_TOKENS,
  GENERAL,
  choosePlaybook,
  composeShotPlan,
  shotPrompt,
  type ShotPlanPreset,
} from '../index.js';

const PERFUME = 'holds the uncapped bottle, sprays once on the inner wrist, sets the bottle down, then raises the wrist to the nose and smiles';
const COVERED: Modesty = { arms: 'covered', hijab: false };
const GULF: Modesty = { arms: 'covered', hijab: true };

const golden = (preset: ShotPlanPreset, ctx: Parameters<typeof composeShotPlan>[1]) =>
  // Under General, as every draft without a Product Profile renders (#32).
  composeShotPlan(preset, { playbook: choosePlaybook(null), ...ctx }).shots.map((s) => {
    const fallbacks = shotModelChain(s.video).slice(1);
    return {
      shot_id: s.shot_id,
      model: s.video.model,
      ...(s.frame_scene !== null ? { image: shotPrompt(s, 'image', IMAGE_REFERENCES) } : {}),
      video: shotPrompt(s, 'video', REFERENCE_TOKENS),
      // A fallback's prompt, where it differs from the model's (the face goes to Kling / Veo).
      ...(fallbacks.length
        ? { fallback_video: Object.fromEntries(fallbacks.map((m) => [m, shotPrompt(s, 'video', REFERENCE_TOKENS, m)])) }
        : {}),
    };
  });

describe('a draft with no Product Profile renders under General', () => {
  // Drafts from before the Product Profile (#30) get the General Playbook
  // (#32): the same shots, the same fields (General sets no energy of its
  // own), and on every hands and person clip one more locked line — one main
  // hand-and-product action — which restates the simple_physics Guardrail.
  const presets = [
    [{ ...PRODUCT_HERO, ...PRODUCT_HERO_PROMPTS } as ShotPlanPreset, { durationMs: 12_500, modesty: COVERED }],
    [{ ...REACTION, ...REACTION_PROMPTS } as ShotPlanPreset, { durationMs: 9_000, modesty: GULF, interaction: PERFUME }],
    [
      { ...HANDS_ON, ...HANDS_ON_PROMPTS } as ShotPlanPreset,
      { durationMs: 9_000, modesty: COVERED, interaction: PERFUME, vars: HANDS_ON_PROMPTS.promptVars!({ hand_gender: 'female', setting: 'dressing_table' }) },
    ],
  ] as const;
  for (const [preset, ctx] of presets) it(`${preset.id}: the shots and fields of no Playbook, plus the one-main-action line`, () => {
    const before = composeShotPlan(preset, { ...ctx, playbook: null });
    const general = composeShotPlan(preset, { ...ctx, playbook: choosePlaybook(null) });
    expect(general.playbook).toEqual({ id: 'general', version: GENERAL.version, pattern: null });
    expect(general.shots.map((s) => s.shot_id)).toEqual(before.shots.map((s) => s.shot_id));
    general.shots.forEach((s, i) => {
      expect(s.fields).toEqual(before.shots[i].fields);
      expect(s.guardrails.image).toEqual(before.shots[i].guardrails.image);
      const added = s.guardrails.video.filter((g) => !before.shots[i].guardrails.video.some((b) => b.id === g.id));
      if (s.shows === 'product') expect(added).toEqual([]);
      else expect(added.map((g) => g.text)).toEqual([GENERAL.negatives.people.join(' ')]);
    });
  });
});

describe('the default Shot Prompts (golden)', () => {
  it('Product Hero, 12.5 s', () => {
    expect(golden({ ...PRODUCT_HERO, ...PRODUCT_HERO_PROMPTS } as ShotPlanPreset, { durationMs: 12_500, modesty: COVERED })).toMatchInlineSnapshot(`
      [
        {
          "model": "seedance-2.0",
          "shot_id": "hero",
          "video": "The product is exactly the product in {{start_image}}: it keeps its exact shape, colours, logo and label text. Premium product commercial, hero shot of the product. The product stands centered on a clean, softly lit surface. Calm, unhurried pace. The camera slowly pushes in and orbits a few degrees, smooth cinematic motion. Shallow depth of field. Gentle rim light glides across its surfaces. No people, no hands. No text overlays, no captions. Vertical 9:16.",
        },
        {
          "model": "seedance-2.0",
          "shot_id": "detail",
          "video": "The product is exactly the product in {{start_image}}: it keeps its exact shape, colours, logo and label text. Premium product commercial, closing detail shot of the product. Its texture, materials and finish are revealed. The shot settles on a clean three-quarter view of the whole product. Calm, unhurried pace. A slow macro slide along the product, smooth cinematic motion. Soft studio light. No people, no hands. No text overlays, no captions. Vertical 9:16.",
        },
      ]
    `);
  });

  it('Reaction, 9 s, a Gulf woman (hijab), with a Product Interaction', () => {
    expect(
      golden({ ...REACTION, ...REACTION_PROMPTS } as ShotPlanPreset, {
        durationMs: 9_000,
        modesty: GULF,
        interaction: PERFUME,
        person: { gender: 'female', description: 'a Gulf woman in her late twenties with warm brown eyes and light everyday makeup' },
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "fallback_video": {
            "kling-o3-pro": "The person is exactly the person in {{person_image}}: identical face, hair, skin and features. The product is exactly the product in {{start_image}}: it keeps its exact shape, colours, logo and label text. UGC-style reaction shot, medium close-up, filmed on a phone. The person reacts to the product. The product stays at chest height or on the surface in front of them, never near the face and never brought to the face. To smell it, they first set the product down, then smell the skin of the inner wrist. They react silently with ONE natural reaction: a warm genuine smile, a small approving nod or a moment of pleasant surprise. How the product is used, as a real person uses it: holds the uncapped bottle, sprays once on the inner wrist, sets the bottle down, then raises the wrist to the nose and smiles. Natural, everyday pace, like a real moment caught on a phone. Handheld phone camera with a slight natural sway. Everyday phone-camera look, the background in focus. Flat, even everyday daylight. Raw unedited iPhone video/photo look, not a commercial, not cinematic; flat soft everyday light (no studio, ring light, dramatic or warm glow, no glare); sharp background, no bokeh; slight handheld motion; real matte skin with visible pores and small natural imperfections, no airbrushing, no waxy or glossy look, no beauty filter. The person never speaks: the mouth stays closed the whole shot, lips gently together, no talking, no mouthing words, no lip movement, no singing, no whispering. They react only with their eyes, eyebrows, a closed-mouth smile and small head movements. The hands and the product stay physically simple: one continuous action, the product already in the state it is used in, no parts appearing, vanishing or coming apart. The camera and the body may move freely. Modest styling: the person wears loose, modest clothing with long sleeves reaching the wrists and a high neckline; no bare arms or shoulders. She wears a neat hijab that fully covers her hair, ears and neck, the same in every frame. One main hand-and-product action in this shot; the product is already in the state it is used in and stays in one piece. No text overlays, no captions. Vertical 9:16.",
            "veo-3.1": "The person is exactly the person in {{person_image}}: identical face, hair, skin and features. The product is exactly the product in {{start_image}}: it keeps its exact shape, colours, logo and label text. UGC-style reaction shot, medium close-up, filmed on a phone. The person reacts to the product. The product stays at chest height or on the surface in front of them, never near the face and never brought to the face. To smell it, they first set the product down, then smell the skin of the inner wrist. They react silently with ONE natural reaction: a warm genuine smile, a small approving nod or a moment of pleasant surprise. How the product is used, as a real person uses it: holds the uncapped bottle, sprays once on the inner wrist, sets the bottle down, then raises the wrist to the nose and smiles. Natural, everyday pace, like a real moment caught on a phone. Handheld phone camera with a slight natural sway. Everyday phone-camera look, the background in focus. Flat, even everyday daylight. Raw unedited iPhone video/photo look, not a commercial, not cinematic; flat soft everyday light (no studio, ring light, dramatic or warm glow, no glare); sharp background, no bokeh; slight handheld motion; real matte skin with visible pores and small natural imperfections, no airbrushing, no waxy or glossy look, no beauty filter. The person never speaks: the mouth stays closed the whole shot, lips gently together, no talking, no mouthing words, no lip movement, no singing, no whispering. They react only with their eyes, eyebrows, a closed-mouth smile and small head movements. The hands and the product stay physically simple: one continuous action, the product already in the state it is used in, no parts appearing, vanishing or coming apart. The camera and the body may move freely. Modest styling: the person wears loose, modest clothing with long sleeves reaching the wrists and a high neckline; no bare arms or shoulders. She wears a neat hijab that fully covers her hair, ears and neck, the same in every frame. One main hand-and-product action in this shot; the product is already in the state it is used in and stays in one piece. No text overlays, no captions. Vertical 9:16.",
          },
          "model": "modelark-seedance-2.0-mini",
          "shot_id": "reaction",
          "video": "The person is a woman: a Gulf woman in her late twenties with warm brown eyes and light everyday makeup. The same person in every shot. The product is exactly the product in {{start_image}}: it keeps its exact shape, colours, logo and label text. UGC-style reaction shot, medium close-up, filmed on a phone. The person reacts to the product. The product stays at chest height or on the surface in front of them, never near the face and never brought to the face. To smell it, they first set the product down, then smell the skin of the inner wrist. They react silently with ONE natural reaction: a warm genuine smile, a small approving nod or a moment of pleasant surprise. How the product is used, as a real person uses it: holds the uncapped bottle, sprays once on the inner wrist, sets the bottle down, then raises the wrist to the nose and smiles. Natural, everyday pace, like a real moment caught on a phone. Handheld phone camera with a slight natural sway. Everyday phone-camera look, the background in focus. Flat, even everyday daylight. Raw unedited iPhone video/photo look, not a commercial, not cinematic; flat soft everyday light (no studio, ring light, dramatic or warm glow, no glare); sharp background, no bokeh; slight handheld motion; real matte skin with visible pores and small natural imperfections, no airbrushing, no waxy or glossy look, no beauty filter. The person never speaks: the mouth stays closed the whole shot, lips gently together, no talking, no mouthing words, no lip movement, no singing, no whispering. They react only with their eyes, eyebrows, a closed-mouth smile and small head movements. The hands and the product stay physically simple: one continuous action, the product already in the state it is used in, no parts appearing, vanishing or coming apart. The camera and the body may move freely. Modest styling: the person wears loose, modest clothing with long sleeves reaching the wrists and a high neckline; no bare arms or shoulders. She wears a neat hijab that fully covers her hair, ears and neck, the same in every frame. One main hand-and-product action in this shot; the product is already in the state it is used in and stays in one piece. No text overlays, no captions. Vertical 9:16.",
        },
        {
          "model": "seedance-2.0",
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
          "image": "The product is exactly the product in the reference image: it keeps its exact shape, colours, logo and label text. Photorealistic first-person (POV) photograph, vertical composition: a woman's hands with neat, natural nails hold the product toward the camera, at an elegant dressing table with a softly lit mirror and a few tasteful accessories. The product is already out of any packaging and in the state it is used in, sharp and in focus, label facing the camera. Everyday daylight, realistic skin texture, the background in focus. How the product is used, as a real person uses it: holds the uncapped bottle, sprays once on the inner wrist, sets the bottle down, then raises the wrist to the nose and smiles. Raw unedited iPhone video/photo look, not a commercial, not cinematic; flat soft everyday light (no studio, ring light, dramatic or warm glow, no glare); sharp background, no bokeh; slight handheld motion; real matte skin with visible pores and small natural imperfections, no airbrushing, no waxy or glossy look, no beauty filter. Only the hands and forearms are in frame: no face, no other person. Modest styling: the arms are covered by long sleeves reaching the wrists; no bare forearms. No text overlays, no captions, no watermark.",
          "model": "seedance-2.0",
          "shot_id": "hands-use",
          "video": "The video starts exactly from the frame in {{start_image}}, and the product keeps its exact shape, colours, logo and label text. First-person POV product video. A woman's hands with neat, natural nails hold the product, already out of its packaging and in the state it is used in, and use it once. The label stays toward the camera. The hands use it at an elegant dressing table with a softly lit mirror and a few tasteful accessories. How the product is used, as a real person uses it: holds the uncapped bottle, sprays once on the inner wrist, sets the bottle down, then raises the wrist to the nose and smiles. Natural, everyday pace, like a real moment caught on a phone. Handheld phone camera with a slight natural sway. Everyday phone-camera look, the background in focus. Everyday daylight. Raw unedited iPhone video/photo look, not a commercial, not cinematic; flat soft everyday light (no studio, ring light, dramatic or warm glow, no glare); sharp background, no bokeh; slight handheld motion; real matte skin with visible pores and small natural imperfections, no airbrushing, no waxy or glossy look, no beauty filter. Only the hands and forearms are visible: no face, nobody speaks. The hands and the product stay physically simple: one continuous action, the product already in the state it is used in, no parts appearing, vanishing or coming apart. The camera and the body may move freely. Modest styling: the arms are covered by long sleeves reaching the wrists; no bare forearms. One main hand-and-product action in this shot; the product is already in the state it is used in and stays in one piece. No text overlays, no captions. Vertical 9:16.",
        },
        {
          "model": "seedance-2.0",
          "shot_id": "product-closer",
          "video": "The product is exactly the product in {{start_image}}: it keeps its exact shape, colours, logo and label text. Closing product shot of the product. The shot settles on a clean three-quarter view of the whole product. The product stands on a clean surface at an elegant dressing table with a softly lit mirror and a few tasteful accessories. Calm, unhurried pace. A slow push-in, smooth cinematic motion. Shallow depth of field. Soft light glides across it. No people, no hands. No text overlays, no captions. Vertical 9:16.",
        },
      ]
    `);
  });
});
