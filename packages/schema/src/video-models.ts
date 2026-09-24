// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Video models per shot kind (#25) — which video model a Preset's shot renders
 * on, and what that costs, as data.
 *
 * A Preset's shot kind may name its model and a fallback
 * (PresetDefinition.shotKinds[kind].video); a kind that names none renders on
 * Seedance via EvoLink, as every Preset did before. The worker keeps a registry
 * of model id → client + request builder (services/primitive-worker-vnext
 * src/video-models) and dispatches by this data, never by Preset or vendor name.
 *
 * Why per shot kind: the 2026-09-24 hijab bake-off. Seedance on EvoLink blocks
 * the output for hijab-wearing women, and every other Seedance host rejects any
 * realistic face; Kling O3 Pro and Veo 3.1 (on fal) rendered all three probes
 * and the owner accepted both. So person shots move to Kling O3 Pro with Veo 3.1
 * as the fallback, and product and hands shots stay on Seedance.
 *
 * ADR 0003 (#29): person shots move again, to Seedance 2.0 Mini on BytePlus
 * ModelArk (the most real-looking result, with the realism Guardrails), with
 * Kling O3 Pro and then Veo 3.1 as the fallback chain. ModelArk refuses a
 * photoreal face as an input image unless it is the same account's own
 * Seedream output passed on untouched (modelTakesPersonImage), so a shot on
 * ModelArk describes the person in words instead of sending a re-hosted face.
 *
 * ── Pricing: quote == charge across mixed models ────────────────────────────
 * Credits stay duration-based and model-independent (ARCHITECTURE.md, "Credits
 * & spend safety"): every model charges the 5/10 s tier of VIDEO_CLIP_CREDITS
 * for a clip it can render, so switching a shot's model never changes what the
 * user pays. A shot is priced at the MOST any model in its chain charges for
 * its clip length (shotClipCredits), and the worker charges exactly that for
 * the shot whichever model ran — the model, or the fallback after a refusal or
 * failure (the failed attempt is refunded). With today's table the chain's
 * credits are equal, so the max rule changes nothing; it keeps quote == charge
 * true by construction if a model is ever priced apart.
 *
 * USD is our provider-cost estimate (the day cap, each clip's recorded cost,
 * and a Preset's declared budget), per clip, for the seconds the model really
 * renders; a shot's is its worst case, every model of its chain run (a failed
 * primary attempt may still cost us, and then the fallback renders it) — fal's published per-second prices with the model's audio OFF
 * (checked 2026-09-24 on fal.ai's model pages):
 *   kling-o3-pro  fal-ai/kling-video/o3/pro/reference-to-video   $0.112/s
 *   veo-3.1       fal-ai/veo3.1/reference-to-video (720p)        $0.20/s, renders 8 s only
 *   modelark-seedance-2.0-mini  dreamina-seedance-2-0-mini on ModelArk: a
 *                 CONSERVATIVE PLACEHOLDER of $0.60 per 5 s ($0.12/s). ModelArk
 *                 lists Seedance 2.0 Mini at ~$0.0014 per 1K tokens (video
 *                 without input video, a "Discount" price on 2026-09-24), and
 *                 bills only successful tasks (no fee on a moderation failure).
 *                 If a clip costs (width × height × fps × seconds) / 1024
 *                 tokens, as ModelArk's earlier Seedance docs state, a 720×1280
 *                 24 fps 5 s clip is 108,000 tokens ≈ $0.15 — but that formula
 *                 is not confirmed for 2.0 Mini and the discount may end, so the
 *                 placeholder stays until a real invoice confirms it. It is our
 *                 cost estimate only: the credits are the tier, so the quote is
 *                 the charge whatever this number is.
 * A Veo fallback shot (8 s × $0.20 = $1.60) is charged the 5 s tier, 140 credits
 * (~$2.06 of revenue): a thinner margin, accepted because it only runs when
 * Kling refused or failed.
 */

import { VIDEO_CLIP_CREDITS, VIDEO_CLIP_USD, type VideoClipSeconds } from './video-pricing.js';

export const VIDEO_MODEL_IDS = ['seedance-2.0', 'kling-o3-pro', 'veo-3.1', 'modelark-seedance-2.0-mini'] as const;
export type VideoModelId = (typeof VIDEO_MODEL_IDS)[number];

/** What one planned clip costs on a model. A clip length it has no price for, it cannot render. */
export interface VideoModelPrice {
  /** Credits charged per planned clip, by the clip's planned length (a Preset plans 5 and 10 s clips). */
  credits: Readonly<Partial<Record<VideoClipSeconds, number>>>;
  /** Our provider-cost estimate (USD) per planned clip. */
  usd: Readonly<Partial<Record<VideoClipSeconds, number>>>;
  /**
   * How long the model really renders a planned clip, in s, where it differs
   * (Veo 3.1 reference-to-video renders 8 s only). Absent = the planned length.
   * A longer render only runs where the cut trims each shot (onScreenMs).
   */
  renders?: Readonly<Partial<Record<VideoClipSeconds, number>>>;
}

export const VIDEO_MODEL_PRICES: Readonly<Record<VideoModelId, VideoModelPrice>> = {
  /** Seedance 2.0 via EvoLink: the shared clip table. */
  'seedance-2.0': {
    credits: { 5: VIDEO_CLIP_CREDITS[5], 10: VIDEO_CLIP_CREDITS[10] },
    usd: { 5: VIDEO_CLIP_USD[5], 10: VIDEO_CLIP_USD[10] },
  },
  /** Kling O3 Pro on fal: $0.112/s, audio off. */
  'kling-o3-pro': {
    credits: { 5: VIDEO_CLIP_CREDITS[5], 10: VIDEO_CLIP_CREDITS[10] },
    usd: { 5: 0.56, 10: 1.12 },
  },
  /** Veo 3.1 on fal: $0.20/s at 720p, audio off; renders 8 s, so only a 5 s shot fits. */
  'veo-3.1': {
    credits: { 5: VIDEO_CLIP_CREDITS[5] },
    usd: { 5: 1.6 },
    renders: { 5: 8 },
  },
  /**
   * Seedance 2.0 Mini on BytePlus ModelArk (ADR 0003), audio off, 720×1280 24 fps.
   * USD: a CONSERVATIVE PLACEHOLDER, $0.12/s (see the header), not a confirmed price.
   */
  'modelark-seedance-2.0-mini': {
    credits: { 5: VIDEO_CLIP_CREDITS[5], 10: VIDEO_CLIP_CREDITS[10] },
    usd: { 5: 0.6, 10: 1.2 },
  },
};

/**
 * Where a person's reference image came from (ADR 0003):
 *   rehosted        — anything we host ourselves (a saved character's portrait
 *                     or sheet, re-hosted on R2 by api-v2): every character today;
 *   modelark_output — the same ModelArk account's own Seedream output, its
 *                     BytePlus URL passed on untouched (the personas of #33).
 */
export type PersonImageSource = 'rehosted' | 'modelark_output';

/**
 * Which person images a model accepts as a face reference. ModelArk refuses a
 * photoreal face ("input image may contain real person",
 * InputImageSensitiveContentDetected.PrivacyInformation) unless it is the same
 * account's own output; fal's Kling and Veo accept a re-hosted face.
 */
export const VIDEO_MODEL_PERSON_IMAGES: Readonly<Record<VideoModelId, readonly PersonImageSource[]>> = {
  'seedance-2.0': ['rehosted', 'modelark_output'],
  'kling-o3-pro': ['rehosted', 'modelark_output'],
  'veo-3.1': ['rehosted', 'modelark_output'],
  'modelark-seedance-2.0-mini': ['modelark_output'],
};

/**
 * Whether a shot on `model` sends the person's image from `source` as its
 * face reference. When it does not, the shot describes the person in words
 * (@agentmedia/shot-prompts person_description) and sends the product alone —
 * the face never reaches a model that would refuse it, and a refusal is not
 * spent to learn that. The face goes to a fallback model that takes it.
 */
export function modelTakesPersonImage(model: VideoModelId, source: PersonImageSource): boolean {
  return VIDEO_MODEL_PERSON_IMAGES[model].includes(source);
}

/**
 * The video model a shot kind renders on, and what it falls back to when that
 * one refuses or fails: a chain tried in order (ADR 0003: ModelArk Mini, then
 * Kling O3 Pro, then Veo 3.1), always a list. Preset data may leave it out
 * (no fallback); shotVideo reads it back as [] then.
 */
export interface ShotVideo {
  model: VideoModelId;
  fallback?: readonly VideoModelId[];
}

/** A shot kind that names no model renders on Seedance via EvoLink. */
export const DEFAULT_SHOT_VIDEO: ShotVideo = { model: 'seedance-2.0' };

/** The models a shot may run on, in the order they are tried. */
export function shotModelChain(video: ShotVideo | undefined): VideoModelId[] {
  const v = video ?? DEFAULT_SHOT_VIDEO;
  const chain: VideoModelId[] = [v.model];
  for (const m of shotFallbacks(v)) if (!chain.includes(m)) chain.push(m);
  return chain;
}

/** The fallback models of a shot, in the order they are tried, without repeats or the model itself (none: []). */
export function shotFallbacks(video: ShotVideo | undefined): VideoModelId[] {
  const list = video?.fallback ?? [];
  return list.filter((m, i) => m !== video!.model && list.indexOf(m) === i);
}

/** A kind's video as the pipeline reads it: its fallback always a list, normalised (shotFallbacks). */
export function normalizedShotVideo(video: ShotVideo | undefined): ShotVideo & { fallback: VideoModelId[] } {
  const v = video ?? DEFAULT_SHOT_VIDEO;
  return { model: v.model, fallback: shotFallbacks(v) };
}

function priceOf(model: VideoModelId, seconds: VideoClipSeconds, table: 'credits' | 'usd'): number {
  const price = VIDEO_MODEL_PRICES[model]?.[table][seconds];
  if (price === undefined) throw new RangeError(`video model ${model} cannot render a ${seconds} s clip`);
  return price;
}

/** Credits for one planned shot: the most any model in its chain charges for the clip (see the header). */
export function shotClipCredits(video: ShotVideo | undefined, seconds: VideoClipSeconds): number {
  return Math.max(...shotModelChain(video).map((m) => priceOf(m, seconds, 'credits')));
}

/** Our provider-cost estimate (USD) for one attempt of a planned clip on `model`. */
export function modelClipUsd(model: VideoModelId, seconds: VideoClipSeconds): number {
  return priceOf(model, seconds, 'usd');
}

/**
 * Our provider-cost estimate (USD) for one planned shot, worst case: every
 * model in its chain ran — the model failed or refused after costing us, and
 * the fallback then rendered the shot. A Preset's maxProviderUsd budgets this.
 */
export function shotClipUsd(video: ShotVideo | undefined, seconds: VideoClipSeconds): number {
  return shotModelChain(video).reduce((sum, m) => sum + modelClipUsd(m, seconds), 0);
}

/** How long `model` really renders a planned clip of `seconds`. */
export function modelRenderSeconds(model: VideoModelId, seconds: VideoClipSeconds): number {
  return VIDEO_MODEL_PRICES[model].renders?.[seconds] ?? seconds;
}
