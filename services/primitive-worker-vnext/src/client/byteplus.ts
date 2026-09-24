// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * BytePlus ModelArk client for Seedance 2.0 (fast variant).
 *
 * TypeScript port of services/media-worker-v2/src/byteplus-client.js.
 * Used by the vNext simple_selfie primitive Activity.
 *
 * Below it (#29, ADR 0003): runModelArkVideo, the Preset render's ModelArk
 * client (Seedance 2.0 Mini person shots), with the failure policy's codes,
 * injectable HTTP and clock, and the two request shapes ModelArk documents:
 * reference-to-video (images with role 'reference_image', named "image 1",
 * "image 2" in the prompt in content order) and image-to-video from a first
 * frame (one image with role 'first_frame'). The two are mutually exclusive in
 * one request (ModelArk docs, "Image Input > Role").
 */

import { CONTENT_POLICY_REFUSED } from '../failure-policy.js';
import { providerFailure } from './provider-failure.js';

const BASE_URL =
  process.env.BYTEPLUS_ARK_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 30 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SubmitVideoParams {
  prompt: string;
  imageUrls: string[];
  duration: 5 | 10 | 15;
  ratio: '9:16' | '1:1' | '16:9';
  generateAudio: boolean;
}

interface ArkContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
  role?: 'reference_image';
}

function buildContent(prompt: string, imageUrls: string[]): ArkContentPart[] {
  const parts: ArkContentPart[] = [{ type: 'text', text: prompt }];
  for (const url of imageUrls) {
    if (!url) continue;
    parts.push({
      type: 'image_url',
      image_url: { url },
      role: 'reference_image',
    });
  }
  return parts;
}

export async function submitVideoTask(
  apiKey: string,
  model: string,
  params: SubmitVideoParams,
): Promise<{ id: string; raw: unknown }> {
  const body = {
    model,
    content: buildContent(params.prompt, params.imageUrls),
    generate_audio: params.generateAudio,
    ratio: params.ratio,
    duration: params.duration,
    watermark: false,
  };
  const resp = await fetch(`${BASE_URL}/contents/generations/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const err = new Error(`byteplus submit ${resp.status}: ${text.slice(0, 400)}`);
    (err as any).status = resp.status;
    throw err;
  }
  const json = (await resp.json()) as { id?: string };
  if (!json.id) throw new Error('byteplus submit returned no task id');
  return { id: json.id, raw: json };
}

export interface PollOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  onPoll?: (status: string) => void;
}

export async function pollVideoTask(
  apiKey: string,
  taskId: string,
  options: PollOptions = {},
): Promise<Record<string, unknown>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    const resp = await fetch(`${BASE_URL}/contents/generations/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) {
      if (resp.status >= 500) {
        await sleep(pollMs);
        continue;
      }
      const text = await resp.text().catch(() => '');
      throw new Error(`byteplus poll ${resp.status}: ${text.slice(0, 400)}`);
    }
    const task = (await resp.json()) as Record<string, unknown>;
    last = task;
    const status = String(task.status ?? '').toLowerCase();
    if (options.onPoll) options.onPoll(status);
    if (status === 'succeeded' || status === 'completed' || status === 'success') {
      return task;
    }
    if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
      const message =
        ((task.error as { message?: string } | undefined)?.message) ??
        (task.error_message as string | undefined) ??
        (task.failure_reason as string | undefined) ??
        JSON.stringify(task).slice(0, 400);
      throw new Error(`byteplus task ${taskId} ${status}: ${message}`);
    }
    await sleep(pollMs);
  }
  throw new Error(
    `byteplus task ${taskId} timed out after ${timeoutMs / 1000}s, last=${JSON.stringify(last).slice(0, 400)}`,
  );
}

export function extractVideoUrl(task: Record<string, unknown>): string | null {
  const direct =
    (task as any)?.content?.video_url ??
    (task as any)?.video_url ??
    (task as any)?.result?.video_url ??
    (task as any)?.output?.video_url ??
    (task as any)?.data?.video_url ??
    (task as any)?.results?.[0]?.video_url ??
    (task as any)?.results?.[0]?.url ??
    null;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const seen = new Set<object>();
  const queue: unknown[] = [task];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || typeof node !== 'object' || seen.has(node as object)) continue;
    seen.add(node as object);
    for (const value of Object.values(node)) {
      if (typeof value === 'string' && /^https?:\/\//.test(value) && /\.mp4(\?|$)/i.test(value)) {
        return value;
      }
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return null;
}

export async function generateSimpleSelfieVideo(
  apiKey: string,
  params: SubmitVideoParams,
): Promise<{ videoUrl: string; taskId: string; raw: Record<string, unknown> }> {
  const model = process.env.BYTEPLUS_SEEDANCE_MODEL || 'dreamina-seedance-2-0-fast-260128';
  const submit = await submitVideoTask(apiKey, model, params);
  const completed = await pollVideoTask(apiKey, submit.id);
  const videoUrl = extractVideoUrl(completed);
  if (!videoUrl) {
    throw new Error(`byteplus task ${submit.id} succeeded but no video URL`);
  }
  return { videoUrl, taskId: submit.id, raw: completed };
}

// ── The Preset render's ModelArk client (#29, ADR 0003) ─────────────────────
//
//   POST {BASE}/contents/generations/tasks   Bearer $ARK_API_KEY
//        { model, content: [text, image_url…], generate_audio: false, ratio, duration, watermark: false }
//        → { id }
//   GET  {BASE}/contents/generations/tasks/{id}   until status succeeded | failed
//        → { status, content: { video_url }, error?: { code, message } }
//
// Failures (codes and policy in ../failure-policy.ts):
//   - a refusal is the one content-policy refusal, CONTENT_POLICY_REFUSED, so
//     the shot's fallback runs: HTTP 400 at submit with an error code such as
//     InputImageSensitiveContentDetected.PrivacyInformation ("input image may
//     contain real person"), or a task that ends failed on a moderation verdict
//     (OutputVideoSensitiveContentDetected, …);
//   - once a task is submitted every failure is final (MODELARK_FAILED, a 4xx,
//     MODELARK_TIMEOUT, MODELARK_BAD_RESPONSE): a Temporal retry would submit
//     the task again, so the shot's fallback model is its only retry;
//   - before it is submitted, a network error, 5xx or 429 is retried here a few
//     times with backoff, then is final too (MODELARK_UNAVAILABLE); another 4xx
//     is final at once (MODELARK_<status>).

/** Inside the clip activity's 20 min start-to-close, with room for the download and upload. */
const MODELARK_TIMEOUT_MS = 15 * 60_000;
const MODELARK_POLL_MS = 5_000;
export const MODELARK_REQUEST_TIMEOUT_MS = 30_000;
const MODELARK_SUBMIT_BACKOFF_MS = [1_500, 4_000, 10_000];

/** How ModelArk (error codes and messages) says it refused an input or an output on content grounds. */
const MODELARK_REFUSAL =
  /SensitiveContent|PrivacyInformation|real person|content[\s_-]*(?:polic|moderat|securit)|moderat|risk[\s_-]*control|copyright|sensitive|nsfw|violat|prohibited/i;

export type ModelArkImageRole = 'reference_image' | 'first_frame';

export interface ModelArkContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
  role?: ModelArkImageRole;
}

export interface ModelArkVideoParams {
  /** The ModelArk model id, e.g. dreamina-seedance-2-0-mini-260615. */
  model: string;
  /** The prompt, naming reference images "image 1", "image 2" in content order. */
  prompt: string;
  /** Reference-to-video: images with role reference_image, in this order (image 1, image 2, …). */
  referenceImages?: readonly string[];
  /** Image-to-video: the clip starts from this frame (role first_frame). Never with referenceImages. */
  firstFrame?: string;
  duration: 5 | 10;
  ratio: '9:16';
}

/** The request body for a ModelArk video task (pure, tested). The model's own audio is always off (ADR 0001). */
export function modelArkVideoBody(p: ModelArkVideoParams): {
  model: string;
  content: ModelArkContentPart[];
  generate_audio: false;
  ratio: '9:16';
  duration: 5 | 10;
  watermark: false;
} {
  const refs = (p.referenceImages ?? []).filter(Boolean);
  if (p.firstFrame && refs.length > 0) {
    throw new Error('ModelArk: a first frame and reference images cannot be mixed in one request');
  }
  if (!p.firstFrame && refs.length === 0) throw new Error('ModelArk: a video task needs a first frame or a reference image');
  const content: ModelArkContentPart[] = [{ type: 'text', text: p.prompt }];
  if (p.firstFrame) content.push({ type: 'image_url', image_url: { url: p.firstFrame }, role: 'first_frame' });
  for (const url of refs) content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
  return { model: p.model, content, generate_audio: false, ratio: p.ratio, duration: p.duration, watermark: false };
}

export interface ModelArkDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface ModelArkVideoRequest {
  apiKey: string;
  body: ReturnType<typeof modelArkVideoBody>;
  /** Defaults to BYTEPLUS_ARK_BASE_URL, else ModelArk's ap-southeast endpoint. */
  baseUrl?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  /** Called on every poll with the task's status (the activity heartbeats here). */
  onPoll?: (status: string) => void;
  deps?: ModelArkDeps;
}

export interface ModelArkVideoResult {
  taskId: string;
  videoUrl: string;
  raw: Record<string, unknown>;
}

async function readJson(resp: Response): Promise<unknown> {
  const text = await resp.text().catch(() => '');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** ModelArk's error as "code: message" (either may be missing). */
function arkError(body: unknown): string {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  const e = (body as { error?: unknown }).error ?? body;
  if (typeof e === 'string') return e;
  const { code, message } = e as { code?: unknown; message?: unknown };
  const parts = [code, message].filter((x) => typeof x === 'string' && x) as string[];
  return parts.length ? parts.join(': ') : JSON.stringify(body);
}

const clip400 = (t: string) => t.slice(0, 400);
const isClassified = (err: unknown) => typeof (err as { type?: unknown })?.type === 'string';

/** Submit a ModelArk video task, wait for it, and return its .mp4 URL. */
export async function runModelArkVideo(req: ModelArkVideoRequest): Promise<ModelArkVideoResult> {
  const http = req.deps?.fetch ?? fetch;
  const sleep = req.deps?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = req.deps?.now ?? Date.now;
  const base = (req.baseUrl ?? BASE_URL).replace(/\/+$/, '');
  const model = req.body.model;
  const auth = { Authorization: `Bearer ${req.apiKey}` };
  const refused = (detail: string) => providerFailure(`modelark ${model} refused: ${clip400(detail)}`, CONTENT_POLICY_REFUSED);

  // ── Submit: transient failures retried here, a bounded few times ─────────
  let taskId: string | undefined;
  for (let attempt = 0; ; attempt += 1) {
    let failure: string;
    try {
      const resp = await http(`${base}/contents/generations/tasks`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
        redirect: 'error',
        signal: AbortSignal.timeout(MODELARK_REQUEST_TIMEOUT_MS),
      });
      const body = await readJson(resp);
      if (resp.ok) {
        const id = (body as { id?: unknown } | null)?.id;
        if (typeof id !== 'string' || !id) throw providerFailure(`modelark ${model} submit returned no task id`, 'MODELARK_BAD_RESPONSE');
        taskId = id;
        break;
      }
      const detail = arkError(body);
      if (resp.status === 400 && MODELARK_REFUSAL.test(detail)) throw refused(detail);
      if (resp.status < 500 && resp.status !== 429) {
        throw providerFailure(`modelark ${model} submit ${resp.status}: ${clip400(detail)}`, `MODELARK_${resp.status}`);
      }
      failure = `submit ${resp.status}: ${clip400(detail)}`;
    } catch (err) {
      if (isClassified(err)) throw err;
      failure = `submit failed: ${(err as Error)?.message ?? String(err)}`;
    }
    if (attempt >= MODELARK_SUBMIT_BACKOFF_MS.length) {
      throw providerFailure(`modelark ${model} ${failure}`, 'MODELARK_UNAVAILABLE');
    }
    await sleep(MODELARK_SUBMIT_BACKOFF_MS[attempt]);
  }

  // ── Poll: from here on, every failure is final (a rerun submits again) ───
  const deadline = now() + (req.timeoutMs ?? MODELARK_TIMEOUT_MS);
  const pollMs = req.pollIntervalMs ?? MODELARK_POLL_MS;
  const statusUrl = `${base}/contents/generations/tasks/${encodeURIComponent(taskId)}`;
  for (;;) {
    if (now() > deadline) throw providerFailure(`modelark ${model} task ${taskId} timed out`, 'MODELARK_TIMEOUT');
    let resp: Response;
    try {
      resp = await http(statusUrl, { headers: auth, redirect: 'error', signal: AbortSignal.timeout(MODELARK_REQUEST_TIMEOUT_MS) });
    } catch {
      await sleep(pollMs); // a network blip: poll again, within the deadline
      continue;
    }
    const body = await readJson(resp);
    if (!resp.ok) {
      if (resp.status >= 500 || resp.status === 429) {
        await sleep(pollMs);
        continue;
      }
      throw providerFailure(`modelark ${model} task ${taskId} status ${resp.status}: ${clip400(arkError(body))}`, `MODELARK_${resp.status}`);
    }
    const task = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const status = String(task.status ?? '').toLowerCase();
    req.onPoll?.(status);
    if (status === 'succeeded') {
      const videoUrl = extractVideoUrl(task);
      if (!videoUrl || !/^https:\/\//.test(videoUrl)) {
        throw providerFailure(`modelark ${model} task ${taskId} succeeded with no video URL`, 'MODELARK_BAD_RESPONSE');
      }
      return { taskId, videoUrl, raw: task };
    }
    if (status === 'failed' || status === 'cancelled' || status === 'canceled' || status === 'expired') {
      const detail = arkError(task.error ? { error: task.error } : task);
      if (MODELARK_REFUSAL.test(detail)) throw refused(detail);
      throw providerFailure(`modelark ${model} task ${taskId} ${status}: ${clip400(detail)}`, 'MODELARK_FAILED');
    }
    await sleep(pollMs);
  }
}
