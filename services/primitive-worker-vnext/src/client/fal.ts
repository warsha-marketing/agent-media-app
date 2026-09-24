// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * fal queue client (#25) — the video models the Preset render runs on fal
 * (Kling O3 Pro, Veo 3.1; see ../video-models).
 *
 *   POST {QUEUE}/{endpoint}   Authorization: Key $FAL_KEY, JSON input
 *                             → { request_id, status_url, response_url }
 *   GET  status_url           until status COMPLETED (FAILED / ERROR = failed)
 *   GET  response_url         → { video: { url } }   (an .mp4)
 *
 * The key only ever goes to fal's queue: status_url and response_url must be
 * https://queue.fal.run URLs, or the job is refused before they are fetched.
 * Every request has its own timeout and follows no redirect.
 *
 * Failures (codes and policy in ../failure-policy.ts):
 *   - a content refusal (HTTP 422 from response_url, or a FAILED job, with
 *     fal's detail text: "likenesses of real people", sensitive content, …) is
 *     the one content-policy refusal, CONTENT_POLICY_REFUSED, as an EvoLink
 *     moderation verdict is;
 *   - once a job is submitted, EVERY failure is final (FAILED/ERROR, a 4xx on
 *     the status or the result, a timeout, an unreachable result): a Temporal
 *     retry would submit and pay for the job again, so the shot's fallback
 *     model is its only retry;
 *   - before it is submitted, a network error, 5xx or 429 is retried here a
 *     few times with backoff, then is final too (FAL_UNAVAILABLE); a 4xx is
 *     final at once.
 *
 * HTTP, sleep and the clock are injectable (FalDeps) so the tests run against a
 * fake server with no real waiting.
 */

import { CONTENT_POLICY_REFUSED } from '../failure-policy.js';
import { providerFailure } from './provider-failure.js';

export const FAL_QUEUE_ORIGIN = 'https://queue.fal.run';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
/** Inside the clip activity's 20 min start-to-close, with room for the download and upload. */
const DEFAULT_TIMEOUT_MS = 15 * 60_000;
/** Each HTTP request to fal's queue (submit, status, result). */
export const FAL_REQUEST_TIMEOUT_MS = 30_000;
const SUBMIT_RETRY_BACKOFF_MS = [1_500, 4_000, 10_000];
const RESULT_RETRY_BACKOFF_MS = [2_000, 5_000, 10_000];

/** Words fal uses when it refuses an input or an output on content grounds. */
const REFUSAL = /content[\s_-]*polic|likeness|real (?:people|person)|sensitive|moderat|safety|nsfw|flagged|violat|prohibited|not allowed/i;

export interface FalDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface FalQueueRequest {
  apiKey: string;
  /** e.g. 'fal-ai/kling-video/o3/pro/reference-to-video'. */
  endpoint: string;
  input: Record<string, unknown>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  /** Called on every poll with fal's status (the activity heartbeats here). */
  onPoll?: (status: string) => void;
  deps?: FalDeps;
}

export interface FalQueueResult {
  requestId: string;
  videoUrl: string;
  raw: Record<string, unknown>;
}

/** fal's error detail as text: a string, or FastAPI-style [{ msg }]. */
function detailText(body: unknown): string {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  const b = body as { detail?: unknown; error?: unknown; message?: unknown };
  const d = b.detail ?? b.error ?? b.message;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => (typeof x === 'string' ? x : (x as { msg?: string })?.msg ?? JSON.stringify(x))).join('; ');
  return JSON.stringify(body);
}

async function readBody(resp: Response): Promise<unknown> {
  const text = await resp.text().catch(() => '');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const clip = (text: string) => text.slice(0, 400);

/** A failure already classified here (an ApplicationFailure has a type); anything else is a network error. */
const isClassified = (err: unknown) => typeof (err as { type?: unknown })?.type === 'string';

function refusal(endpoint: string, detail: string) {
  return providerFailure(`fal ${endpoint} refused: ${clip(detail)}`, CONTENT_POLICY_REFUSED);
}

/** A URL fal handed back that we will send the key to: only fal's queue, over https. */
function queueUrl(endpoint: string, field: string, value: unknown): string {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw providerFailure(`fal ${endpoint} returned an invalid ${field}`, 'FAL_BAD_RESPONSE');
  }
  if (url.origin !== FAL_QUEUE_ORIGIN || url.username || url.password) {
    throw providerFailure(
      `fal ${endpoint} returned a ${field} off ${FAL_QUEUE_ORIGIN} (${url.origin}); refusing to send the key there`,
      'FAL_BAD_RESPONSE',
    );
  }
  return url.href;
}

/** Submit a job to fal's queue, wait for it, and return its video URL. */
export async function runFalQueue(req: FalQueueRequest): Promise<FalQueueResult> {
  const http = req.deps?.fetch ?? fetch;
  const sleep = req.deps?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = req.deps?.now ?? Date.now;
  const auth = { Authorization: `Key ${req.apiKey}` };
  const get = (url: string) => http(url, { headers: auth, redirect: 'error', signal: AbortSignal.timeout(FAL_REQUEST_TIMEOUT_MS) });

  // ── Submit: transient failures retried here, a bounded few times ─────────
  let submitted: { request_id?: string; status_url?: string; response_url?: string } | undefined;
  for (let attempt = 0; ; attempt += 1) {
    let failure: string;
    try {
      const resp = await http(`${FAL_QUEUE_ORIGIN}/${req.endpoint}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(req.input),
        redirect: 'error',
        signal: AbortSignal.timeout(FAL_REQUEST_TIMEOUT_MS),
      });
      if (resp.ok) {
        submitted = (await readBody(resp)) as typeof submitted;
        break;
      }
      const detail = detailText(await readBody(resp));
      if (resp.status === 422 && REFUSAL.test(detail)) throw refusal(req.endpoint, detail);
      if (resp.status < 500 && resp.status !== 429) {
        throw providerFailure(`fal ${req.endpoint} submit ${resp.status}: ${clip(detail)}`, `FAL_${resp.status}`);
      }
      failure = `submit ${resp.status}: ${clip(detail)}`;
    } catch (err) {
      if (isClassified(err)) throw err;
      failure = `submit failed: ${(err as Error)?.message ?? String(err)}`;
    }
    if (attempt >= SUBMIT_RETRY_BACKOFF_MS.length) {
      throw providerFailure(`fal ${req.endpoint} ${failure}`, 'FAL_UNAVAILABLE');
    }
    await sleep(SUBMIT_RETRY_BACKOFF_MS[attempt]);
  }
  const requestId = submitted?.request_id;
  if (!requestId) throw providerFailure(`fal ${req.endpoint} submit returned no request id`, 'FAL_BAD_RESPONSE');
  const statusUrl = queueUrl(req.endpoint, 'status_url', submitted?.status_url);
  const responseUrl = queueUrl(req.endpoint, 'response_url', submitted?.response_url);

  // ── Poll: from here on, every failure is final (a rerun pays again) ──────
  const deadline = now() + (req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const pollMs = req.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  for (;;) {
    if (now() > deadline) {
      throw providerFailure(`fal ${req.endpoint} request ${requestId} timed out`, 'FAL_TIMEOUT');
    }
    let resp: Response;
    try {
      resp = await get(statusUrl);
    } catch {
      await sleep(pollMs); // a network blip: poll again, within the deadline
      continue;
    }
    if (!resp.ok) {
      if (resp.status >= 500 || resp.status === 429) {
        await sleep(pollMs);
        continue;
      }
      throw providerFailure(
        `fal ${req.endpoint} status ${resp.status}: ${clip(detailText(await readBody(resp)))}`,
        `FAL_${resp.status}`,
      );
    }
    const st = (await readBody(resp)) as { status?: string; error?: unknown };
    const status = String(st?.status ?? '').toUpperCase();
    req.onPoll?.(status);
    if (status === 'COMPLETED') break;
    if (status === 'FAILED' || status === 'ERROR') {
      const detail = detailText(st);
      if (REFUSAL.test(detail)) throw refusal(req.endpoint, detail);
      throw providerFailure(`fal ${req.endpoint} request ${requestId} ${status}: ${clip(detail)}`, 'FAL_FAILED');
    }
    await sleep(pollMs);
  }

  // ── Result: a transient failure is retried a few times, then final ───────
  for (let attempt = 0; ; attempt += 1) {
    let failure: string;
    try {
      const resp = await get(responseUrl);
      const body = await readBody(resp);
      if (resp.ok) {
        const raw = (body ?? {}) as Record<string, unknown>;
        const videoUrl = (raw.video as { url?: unknown } | null | undefined)?.url;
        if (typeof videoUrl !== 'string' || !/^https:\/\//.test(videoUrl)) {
          throw providerFailure(`fal ${req.endpoint} request ${requestId} completed with no video URL`, 'FAL_BAD_RESPONSE');
        }
        return { requestId, videoUrl, raw };
      }
      const detail = detailText(body);
      // fal answers a refused input or output with 422 on the result.
      if (resp.status === 422 && REFUSAL.test(detail)) throw refusal(req.endpoint, detail);
      if (resp.status < 500 && resp.status !== 429) {
        throw providerFailure(`fal ${req.endpoint} result ${resp.status}: ${clip(detail)}`, `FAL_${resp.status}`);
      }
      failure = `result ${resp.status}: ${clip(detail)}`;
    } catch (err) {
      if (isClassified(err)) throw err;
      failure = `result failed: ${(err as Error)?.message ?? String(err)}`;
    }
    if (attempt >= RESULT_RETRY_BACKOFF_MS.length) {
      throw providerFailure(`fal ${req.endpoint} request ${requestId} ${failure}`, 'FAL_UNAVAILABLE');
    }
    await sleep(RESULT_RETRY_BACKOFF_MS[attempt]);
  }
}
