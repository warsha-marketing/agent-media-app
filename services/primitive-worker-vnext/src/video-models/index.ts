// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Video model registry (#25) — model id → client + request builder.
 *
 * A Preset's shot kind names its model (and a fallback) as data
 * (@agentmedia/schema video-models.ts, PresetDefinition.shotKinds[kind].video);
 * the render pipeline passes the id to presetClip, which looks the model up
 * here. Nothing upstream branches on a vendor: adding a model is its price in
 * the schema table plus one entry here.
 *
 * Every model is asked for a silent 9:16 clip (`generate_audio: false`: the
 * draft's voice is the only audio, ADR 0001) from the shot's start image, plus
 * the person's reference on a shot that shows one. A Shot Prompt names those
 * images with provider-neutral tokens (#26, @agentmedia/shot-prompts
 * REFERENCE_TOKENS); each model's adapter puts in its own syntax (promptFor):
 * EvoLink's `@image1` / `@image2`, on fal "the first / second reference
 * image", the wording the 2026-09-24 bake-off rendered with, and on ModelArk
 * "image 1" / "image 2" (its documented wording, in content order).
 *
 * ModelArk Seedance 2.0 Mini (#29, ADR 0003) is sent the person's image only
 * when it is the same account's own output (@agentmedia/schema
 * modelTakesPersonImage): the Preset render never hands it a re-hosted face,
 * and its prompt then describes the person in words.
 *
 * Content refusals map to the one content-policy refusal
 * (CONTENT_POLICY_REFUSED, ../failure-policy.ts) whichever provider refused.
 * A model whose job a rerun would submit and pay for again
 * (`resubmitOnRetry: false`, every fal model) fails finally: its shot's
 * fallback model is the retry.
 */

import { ApplicationFailure } from '@temporalio/activity';
import type { VideoModelId } from '@agentmedia/schema';
import { withReferences, type ReferenceWords } from '@agentmedia/shot-prompts';
import { generateSimpleSelfieEvolink } from '../client/evolink.js';
import { runFalQueue } from '../client/fal.js';
import { modelArkVideoBody, runModelArkVideo, type ModelArkVideoParams } from '../client/byteplus.js';
import { providerFailure } from '../client/provider-failure.js';

/** One shot, as every model is asked for it. */
export interface VideoShotRequest {
  /** The Shot Prompt already in this model's reference syntax (promptFor): generate() sends it as is. */
  prompt: string;
  /** The image the shot is animated from (`@image1`): its starting frame, else the product photo. */
  startImageUrl: string;
  /** The person's reference (`@image2`), on a shot that shows one. */
  characterImageUrl?: string;
  /**
   * The start image is the shot's generated starting frame (#18), not the
   * product photo. ModelArk then animates it as the clip's first frame
   * (image-to-video, role first_frame) when no person image goes with it.
   */
  startImageIsFrame?: boolean;
  /** The planned clip length. */
  seconds: 5 | 10;
  /** Always false: the video model never speaks (ADR 0001). */
  generateAudio: false;
  /** Progress from the provider's poll loop (the activity heartbeats here). */
  onProgress?: (stage: string) => void;
}

export interface GeneratedVideo {
  videoUrl: string;
  taskId: string;
}

/** A fal request: the queue endpoint and its JSON input. */
export interface FalRequest {
  endpoint: string;
  input: FalInput;
}

type FalInput = Record<string, unknown> & { generate_audio: false };

export interface VideoModelClient {
  id: VideoModelId;
  /** Recorded on provider_tasks and the clip's artifact. */
  provider: string;
  /** The provider's model name, recorded on the clip's artifact. */
  modelName(): string;
  /**
   * Whether Temporal may rerun a failed clip on this model, submitting its job
   * again. False on fal: every failure there is final and the shot's fallback
   * model is its only retry (#25).
   */
  resubmitOnRetry: boolean;
  /** A Shot Prompt in this model's reference syntax: exactly what generate() sends (idempotent). */
  promptFor(prompt: string): string;
  generate(shot: VideoShotRequest): Promise<GeneratedVideo>;
}

/** EvoLink's reference syntax: the start image is `@image1`, the person `@image2` (the order of image_urls). */
export const EVOLINK_REFERENCES: ReferenceWords = { start: '@image1', person: '@image2' };

/** fal has no reference syntax: the images are named by their order in image_urls. */
export const FAL_REFERENCES: ReferenceWords = { start: 'the first reference image', person: 'the second reference image' };

/**
 * ModelArk's reference wording: "image 1" is the start image, "image 2" the
 * person (when their image is sent), the order of the content's images.
 */
export const MODELARK_REFERENCES: ReferenceWords = { start: 'image 1', person: 'image 2' };

/** A video model on fal's queue: its endpoint, and the request it sends for a shot (pure, tested). */
export interface FalVideoModel extends VideoModelClient {
  provider: 'fal';
  endpoint: string;
  buildRequest(shot: VideoShotRequest): FalRequest;
}

/**
 * A prompt as fal gets it: the reference tokens in fal's words, and any
 * EvoLink `@image1` / `@image2` too. Kept for workflow history: a presetClip
 * scheduled by a render that started before #26 (fal models shipped with #25)
 * still carries an `@image` prompt in its recorded input, and a retry of it
 * runs this worker's activity with that input.
 */
export function falPrompt(prompt: string): string {
  return withReferences(prompt, FAL_REFERENCES)
    .replace(/@image1\b/g, FAL_REFERENCES.start)
    .replace(/@image2\b/g, FAL_REFERENCES.person);
}

function references(shot: VideoShotRequest): string[] {
  return shot.characterImageUrl ? [shot.startImageUrl, shot.characterImageUrl] : [shot.startImageUrl];
}

function falKey(): string {
  const key = process.env.FAL_KEY?.trim();
  // Fail fast: every fal model (and so a fal fallback) would fail the same way.
  if (!key) throw providerFailure('FAL_KEY not configured on primitive-worker-vnext', 'PROVIDER_UNCONFIGURED');
  return key;
}

function falModel(id: VideoModelId, endpoint: string, buildInput: (shot: VideoShotRequest) => FalInput): FalVideoModel {
  const buildRequest = (shot: VideoShotRequest): FalRequest => ({ endpoint, input: buildInput(shot) });
  return {
    id,
    provider: 'fal',
    endpoint,
    modelName: () => endpoint,
    resubmitOnRetry: false,
    promptFor: falPrompt,
    buildRequest,
    async generate(shot) {
      const { input } = buildRequest(shot);
      const out = await runFalQueue({ apiKey: falKey(), endpoint, input, onPoll: (s) => shot.onProgress?.(s) });
      return { videoUrl: out.videoUrl, taskId: out.requestId };
    },
  };
}

const seedance: VideoModelClient = {
  id: 'seedance-2.0',
  provider: 'seedance-2-0',
  modelName: () => process.env.EVOLINK_SEEDANCE_MODEL || 'seedance-2.0-mini-reference-to-video',
  // EvoLink's transient failures (a 5xx, a timeout) have always been retried.
  resubmitOnRetry: true,
  promptFor: (prompt) => withReferences(prompt, EVOLINK_REFERENCES),
  async generate(shot) {
    const evolinkKey = process.env.EVOLINK_API_KEY?.trim() || process.env.EVOLINK_API_KEYS?.trim();
    if (!evolinkKey) {
      throw providerFailure('EVOLINK_API_KEY not configured on primitive-worker-vnext', 'PROVIDER_UNCONFIGURED');
    }
    try {
      const result = await generateSimpleSelfieEvolink({
        // Already in EvoLink's syntax: presetClip sent it through promptFor.
        prompt: shot.prompt,
        // @image1 the start image; @image2 the person, on a shot that shows one.
        imageUrls: references(shot),
        duration: shot.seconds,
        aspectRatio: '9:16',
        generateAudio: false,
        quality: '720p',
      });
      return { videoUrl: result.videoUrl, taskId: result.taskId };
    } catch (err) {
      // A moderation verdict arrives from the poll as a non-retryable
      // content-policy failure — pass it through untouched.
      if (err instanceof ApplicationFailure) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number })?.status;
      // 429 / 402 are transient; other 4xx are caller faults (incl. a photo
      // refused at submit) and must not be resubmitted.
      if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429 && status !== 402) {
        throw providerFailure(`evolink ${status}: ${msg}`, `EVOLINK_${status}`);
      }
      throw err instanceof Error ? err : new Error(msg);
    }
  },
};

/** A video model on BytePlus ModelArk: the task body it sends for a shot (pure, tested). */
export interface ModelArkVideoModel extends VideoModelClient {
  provider: 'byteplus-modelark';
  buildRequest(shot: VideoShotRequest): ReturnType<typeof modelArkVideoBody>;
}

function arkKey(): string {
  const key = process.env.ARK_API_KEY?.trim();
  if (!key) throw providerFailure('ARK_API_KEY not configured on primitive-worker-vnext', 'PROVIDER_UNCONFIGURED');
  return key;
}

/**
 * The ModelArk request for a shot. Reference-to-video by default: the start
 * image as image 1 (the product photo, or the In-use Reference), and the
 * person as image 2 only when presetClip passes their image (a trusted
 * ModelArk output). A shot animated from its own starting frame, with no
 * person image, is image-to-video from that first frame (ModelArk's
 * documented role; the two modes never mix in one request).
 */
export function modelArkParams(model: string, shot: VideoShotRequest): ModelArkVideoParams {
  const base = { model, prompt: shot.prompt, duration: shot.seconds, ratio: '9:16' as const };
  if (shot.startImageIsFrame && !shot.characterImageUrl) return { ...base, firstFrame: shot.startImageUrl };
  return { ...base, referenceImages: references(shot) };
}

/** The ModelArk model id (activated on the account 2026-09-24); MODELARK_SEEDANCE_MINI_MODEL pins another. */
const modelArkModelName = () => process.env.MODELARK_SEEDANCE_MINI_MODEL?.trim() || 'dreamina-seedance-2-0-mini-260615';

/** Seedance 2.0 Mini on ModelArk (ADR 0003): 720×1280, 24 fps, ~5.04 s for a 5 s shot; audio off. */
const modelArkSeedanceMini: ModelArkVideoModel = {
  id: 'modelark-seedance-2.0-mini',
  provider: 'byteplus-modelark',
  modelName: () => modelArkModelName(),
  // Like fal: a submitted task is never resubmitted; the shot's fallback is its retry.
  resubmitOnRetry: false,
  promptFor: (prompt) => withReferences(prompt, MODELARK_REFERENCES),
  buildRequest: (shot) => modelArkVideoBody(modelArkParams(modelArkModelName(), shot)),
  async generate(shot) {
    const body = modelArkVideoBody(modelArkParams(modelArkModelName(), shot));
    const out = await runModelArkVideo({ apiKey: arkKey(), body, onPoll: (s) => shot.onProgress?.(s) });
    return { videoUrl: out.videoUrl, taskId: out.taskId };
  },
};

/** Kling O3 Pro on fal: 1080×1920, 24 fps, the planned length (it renders 3–15 s). */
const klingO3Pro = falModel('kling-o3-pro', 'fal-ai/kling-video/o3/pro/reference-to-video', (shot) => ({
  prompt: shot.prompt,
  image_urls: references(shot),
  aspect_ratio: '9:16',
  duration: String(shot.seconds),
  generate_audio: false,
}));

/** Veo 3.1 on fal: 720×1280, 8 s only — a 5 s shot renders 8 s and the cut trims it. */
const veo31 = falModel('veo-3.1', 'fal-ai/veo3.1/reference-to-video', (shot) => {
  if (shot.seconds > 8) throw ApplicationFailure.nonRetryable(`veo-3.1 renders 8 s; a ${shot.seconds} s shot does not fit`, 'INVALID_INPUT');
  return {
    prompt: shot.prompt,
    image_urls: references(shot),
    aspect_ratio: '9:16',
    resolution: '720p',
    duration: '8s',
    generate_audio: false,
  };
});

export const VIDEO_MODELS = {
  'seedance-2.0': seedance,
  'kling-o3-pro': klingO3Pro,
  'veo-3.1': veo31,
  'modelark-seedance-2.0-mini': modelArkSeedanceMini,
} as const satisfies Readonly<Record<VideoModelId, VideoModelClient>>;

/** The client for `id`; throws on a model the worker does not know. */
export function videoModel(id: VideoModelId): VideoModelClient {
  if (!Object.hasOwn(VIDEO_MODELS, id)) throw new Error(`unknown video model: ${String(id)}`);
  return VIDEO_MODELS[id] as VideoModelClient;
}
