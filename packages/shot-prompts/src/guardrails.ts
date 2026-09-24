// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Guardrails (CONTEXT.md, #26, #28) — the locked lines of a Shot Prompt.
 *
 * A Shot Prompt is the shot's fields (editable, ./shot-fields.ts) plus these
 * lines, which the user sees but can never edit or remove: the fixed product
 * and character references, the no-speaking instruction (ADR 0001: the draft's
 * voice is the only speech), simple hand–object physics, the Modesty Default
 * (#17), no people on a product shot, no text or captions, and the video
 * model's own audio off. The worker builds every final prompt from ITS OWN copy
 * of these lines, whatever a client sent (primitive-worker-vnext
 * workflows/render-preset.ts); api-v2 shows the same lines in the Shot Plan.
 *
 * Per stage (#28): a shot renders in up to two stages, each with its own list —
 *   image — the shot's starting frame (#18), an image edit of the product
 *           photo; only a shot whose kind declares a frame has this stage. A
 *           still has no speech, no motion and no audio: no no-speaking,
 *           simple-physics or audio line, and "only the hands" is said as a
 *           still says it.
 *   video — the clip, every shot.
 * Both stages carry the product (and character) reference, the Modesty
 * Default, nobody on a product shot, and no text. The realism rules (#27,
 * ADR 0003, #29: the look the owner accepted in tests M1b, M2 and M3) are a
 * both-stage Guardrail on every person and hands shot, never a product shot.
 *
 * The person, both stages: pinned to their reference image (person_reference)
 * when the shot's model takes the face, else described in words
 * (person_description, ./person.ts) — ModelArk refuses a re-hosted face.
 *
 * Where a line goes:
 *   before_scene — the references, so "the product" and "the person" in the
 *                  fields are pinned to the images before the fields are read;
 *   after_scene  — the rules, last, so they are the prompt's final word;
 *   request      — enforced by the request itself (generate_audio: false),
 *                  shown to the user but not prompt text.
 *
 * Pure data + pure functions: the workflow sandbox imports this.
 */

import type { Modesty, ShotSubject } from '@agentmedia/schema';
import { MODESTY_PROMPTS } from './modesty.js';
import { REFERENCE_TOKENS } from './references.js';

/** The two prompts a shot may render from: its starting frame's (image), and its clip's (video). */
export type ShotStage = 'image' | 'video';

export type GuardrailId =
  | 'person_reference'
  | 'person_description'
  | 'product_reference'
  | 'start_frame'
  | 'in_use_reference'
  | 'scale_anchor'
  | 'no_speaking'
  | 'hands_only'
  | 'simple_physics'
  | 'realism'
  | 'modesty'
  | 'hijab'
  | 'no_people'
  /** The product's Playbook's negatives (#32), video stage (./playbooks/apply.ts). */
  | 'playbook'
  | 'format'
  | 'audio_off';

export interface Guardrail {
  id: GuardrailId;
  /** A short name for the locked chip. */
  label: string;
  /** The line, with reference tokens (./references.ts) where it names an image. */
  text: string;
  at: 'before_scene' | 'after_scene' | 'request';
}

/** The no-speaking instruction every clip showing a person carries, verbatim (Reaction #19). Video only. */
export const NO_SPEAKING_PERSON =
  'The person never speaks: the mouth stays closed the whole shot, lips gently together, no talking, no mouthing words, no lip movement, no singing, no whispering. They react only with their eyes, eyebrows, a closed-mouth smile and small head movements.';

/** Every hands clip: nothing but hands, and nobody speaks. */
export const HANDS_ONLY = 'Only the hands and forearms are visible: no face, nobody speaks.';

/** Every hands still (a starting frame): nothing but hands. */
export const HANDS_ONLY_FRAME = 'Only the hands and forearms are in frame: no face, no other person.';

/**
 * Every hands and person clip: the hands and the product stay physically
 * simple, however much the camera and the body move (the owner's "alive, not
 * AI" rule: broken hand–object physics is what gives a Short away).
 */
export const SIMPLE_PHYSICS =
  'The hands and the product stay physically simple: one continuous action, the product already in the state it is used in, no parts appearing, vanishing or coming apart. The camera and the body may move freely.';

/**
 * Every hands and person shot, both stages (ADR 0003): the raw phone look the
 * owner accepted. Cinematic light makes Seedance skin waxy, so it is excluded
 * outright. Never on a product shot, which keeps its commercial look.
 */
export const REALISM =
  'Raw unedited iPhone video/photo look, not a commercial, not cinematic; flat soft everyday light (no studio, ring light, dramatic or warm glow, no glare); sharp background, no bokeh; slight handheld motion; real matte skin with visible pores and small natural imperfections, no airbrushing, no waxy or glossy look, no beauty filter.';

/** Every product shot: the product alone. */
export const NO_PEOPLE = 'No people, no hands.';

/** Every clip: Captions are added after the render, never by the video model (#22). */
export const FORMAT = 'No text overlays, no captions. Vertical 9:16.';

/** Every still: no text burned into the frame the clip animates. */
export const FORMAT_FRAME = 'No text overlays, no captions, no watermark.';

/** Every clip: enforced by the request (generate_audio: false), shown as a Guardrail. */
export const AUDIO_OFF = 'The video model’s own audio is off: the draft’s voice is the only sound.';

export const PRODUCT_REFERENCE = `The product is exactly the product in ${REFERENCE_TOKENS.start}: it keeps its exact shape, colours, logo and label text.`;
export const START_FRAME_REFERENCE = `The video starts exactly from the frame in ${REFERENCE_TOKENS.start}, and the product keeps its exact shape, colours, logo and label text.`;
export const PERSON_REFERENCE = `The person is exactly the person in ${REFERENCE_TOKENS.person}: identical face, hair, skin and features.`;

export interface ShotGuardrailContext {
  /** What the shot shows besides the product (PresetDefinition.shotKinds[kind].shows). */
  shows: ShotSubject;
  /** The shot is animated from a generated starting frame (#18), not the product photo. */
  startingFrame: boolean;
  /** The person's reference image goes with the shot (shotHasPersonReference, for the shot's model). */
  personReference: boolean;
  /**
   * The person in words (./person.ts personDescriptionLine), for a person
   * shot whose reference image does NOT go with it. Ignored when it does.
   */
  personDescription?: string | null;
  /** The resolved Modesty Default (#17). */
  modesty: Modesty;
  /**
   * #31 (./product-reference.ts): the In-use Reference line, when the render
   * made one (inUseReferenceLine), and the Scale Anchor line (scaleAnchorLine).
   * Both go on hands and person shots only, both stages; ignored elsewhere.
   */
  inUseReference?: string | null;
  scaleAnchor?: string | null;
}

/** One shot's Guardrails per stage, each list in prompt order. `image` is empty for a shot with no starting frame. */
export interface StageGuardrails {
  image: Guardrail[];
  video: Guardrail[];
}

/** The Guardrails of one stage of one shot, in prompt order. */
export function stageGuardrails(stage: ShotStage, ctx: ShotGuardrailContext): Guardrail[] {
  const video = stage === 'video';
  const person = ctx.shows === 'person';
  const hands = ctx.shows === 'hands';
  const out: Guardrail[] = [];
  // References, both stages: the frame is an edit of the product photo; the clip is animated from the frame, else the photo.
  if (person && ctx.personReference) {
    out.push({ id: 'person_reference', label: 'Same character', text: PERSON_REFERENCE, at: 'before_scene' });
  } else if (person && ctx.personDescription) {
    out.push({ id: 'person_description', label: 'The character, described', text: ctx.personDescription, at: 'before_scene' });
  }
  out.push(
    video && ctx.startingFrame
      ? { id: 'start_frame', label: 'Starts from the frame, exact product', text: START_FRAME_REFERENCE, at: 'before_scene' }
      : { id: 'product_reference', label: 'Exact product', text: PRODUCT_REFERENCE, at: 'before_scene' },
  );
  // #31: the product as it is used, and its real size — where hands or a person handle it.
  if ((person || hands) && ctx.inUseReference) {
    out.push({ id: 'in_use_reference', label: 'Product as used', text: ctx.inUseReference, at: 'before_scene' });
  }
  if ((person || hands) && ctx.scaleAnchor) {
    out.push({ id: 'scale_anchor', label: 'Real size', text: ctx.scaleAnchor, at: 'before_scene' });
  }
  // The rules. The look first (both stages), then speech and motion (the video
  // stage's); a still says "only hands" its own way.
  if (person || hands) out.push({ id: 'realism', label: 'Real phone look', text: REALISM, at: 'after_scene' });
  if (person && video) out.push({ id: 'no_speaking', label: 'Nobody speaks', text: NO_SPEAKING_PERSON, at: 'after_scene' });
  if (hands) {
    out.push(
      video
        ? { id: 'hands_only', label: 'Hands only, nobody speaks', text: HANDS_ONLY, at: 'after_scene' }
        : { id: 'hands_only', label: 'Hands only', text: HANDS_ONLY_FRAME, at: 'after_scene' },
    );
  }
  if ((person || hands) && video) {
    out.push({ id: 'simple_physics', label: 'One simple hand action', text: SIMPLE_PHYSICS, at: 'after_scene' });
  }
  if (person || hands) {
    out.push({
      id: 'modesty',
      label: 'Modest styling',
      text: hands ? MODESTY_PROMPTS.hands[ctx.modesty.arms] : MODESTY_PROMPTS.person[ctx.modesty.arms],
      at: 'after_scene',
    });
  }
  if (person && ctx.modesty.hijab) out.push({ id: 'hijab', label: 'Hijab', text: MODESTY_PROMPTS.hijab, at: 'after_scene' });
  if (!person && !hands) out.push({ id: 'no_people', label: 'No people', text: NO_PEOPLE, at: 'after_scene' });
  out.push(
    video
      ? { id: 'format', label: 'No text or captions, 9:16', text: FORMAT, at: 'after_scene' }
      : { id: 'format', label: 'No text or watermark', text: FORMAT_FRAME, at: 'after_scene' },
  );
  if (video) out.push({ id: 'audio_off', label: 'Model audio off', text: AUDIO_OFF, at: 'request' });
  return out;
}

/** Every stage's Guardrails of one shot: the image stage only when it starts from a frame. */
export function shotGuardrails(ctx: ShotGuardrailContext): StageGuardrails {
  return {
    image: ctx.startingFrame ? stageGuardrails('image', ctx) : [],
    video: stageGuardrails('video', ctx),
  };
}
