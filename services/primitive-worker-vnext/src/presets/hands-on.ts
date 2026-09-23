// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Hands-on render definition (#18) — the server-side half of the Hands-on
 * Preset (the public half is HANDS_ON in @agentmedia/schema).
 *
 * Each hands shot starts from a product-in-hands frame: a gpt-image edit of the
 * user's product photo, held by first-person hands in the chosen setting
 * (framePrompts). That frame is then animated silently (shotPrompts.hands,
 * `@image1` = the frame). The product closer animates the product photo itself.
 *
 * `{hands}` and `{setting}` are filled from the render input (promptVars); the
 * Modesty Default is appended to every hands prompt, frame and clip alike, by
 * the shared pipeline. Every prompt keeps the visuals silent: nobody speaks.
 *
 * Pure data: the workflow sandbox imports this.
 */

import {
  HAND_GENDERS,
  HANDS_ON,
  HANDS_ON_SETTINGS,
  type HandGender,
  type HandsOnSetting,
  type HandsOnShotKind,
} from '@agentmedia/schema';
import type { PresetRenderDefinition } from './index.js';

/** Whose hands, as the prompts say it. */
export const HAND_WORDS: Readonly<Record<HandGender, string>> = {
  female: "a woman's hands with neat, natural nails",
  male: "a man's hands",
};

/** Where the hands are, as the prompts say it. */
export const SETTING_WORDS: Readonly<Record<HandsOnSetting, string>> = {
  dressing_table: 'at an elegant dressing table with a softly lit mirror and a few tasteful accessories',
  car: 'inside a modern car, seen from the driver’s seat, daylight coming through the windscreen',
  majlis: 'in a traditional Arabian majlis with floor cushions, patterned rugs and warm lamplight',
  kitchen: 'in a clean, modern home kitchen on a marble counter in soft morning light',
  desk: 'at a tidy modern work desk by a window in soft daylight',
  outdoors: 'outdoors in soft golden-hour daylight with a softly blurred garden behind',
};

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

export const HANDS_ON_RENDER: PresetRenderDefinition<HandsOnShotKind> = {
  ...HANDS_ON,
  framePrompts: {
    hands:
      'Photorealistic first-person (POV) photograph, vertical composition: {hands} have just lifted the exact product from the reference image out of its open packaging and hold it toward the camera, {setting}. ' +
      'The product keeps its exact shape, colours, logo and label text, sharp and in focus, label facing the camera. ' +
      'Only the hands and forearms are in frame: no face, no other person. Natural, flattering light, realistic skin texture, shallow depth of field. No text overlays, no captions, no watermark.',
  },
  shotPrompts: {
    hands:
      'First-person POV product video that starts exactly from the frame in @image1: {hands} lift the product clear of its packaging, turn it slowly to show it from a few angles and use it naturally, {setting}; the shot ends with the product held up toward the camera, label facing the lens. ' +
      'The product keeps its exact shape, colours, logo and label text. Only the hands and forearms are visible: no face, nobody speaks. No text overlays, no captions. Vertical 9:16, natural light, smooth gentle handheld motion.',
    product:
      'Closing product shot of the exact product in @image1, standing on a clean surface {setting}: a slow push-in that settles on a clean three-quarter view of the whole product, soft light gliding across it. ' +
      'The product keeps its exact shape, colours, logo and label text. No people, no hands, no text overlays, no captions. Vertical 9:16, shallow depth of field, smooth cinematic motion.',
  },
  promptVars(input) {
    if (!oneOf(HAND_GENDERS, input.hand_gender)) throw new Error(`Hands-on needs hand_gender male or female; got ${String(input.hand_gender)}`);
    if (!oneOf(HANDS_ON_SETTINGS, input.setting)) throw new Error(`Hands-on needs a setting from the list; got ${String(input.setting)}`);
    return { hands: HAND_WORDS[input.hand_gender], setting: SETTING_WORDS[input.setting] };
  },
};
