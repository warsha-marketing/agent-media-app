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
 * A content refusal comes back as HTTP 422 from response_url, with fal's detail
 * text ("likenesses of real people", sensitive content, …). It maps to the
 * existing non-retryable content-policy failure (CONTENT_POLICY_FAILURE), as an
 * EvoLink moderation verdict does: resubmitting pays for the same refusal.
 *
 * HTTP, sleep and the clock are injectable (FalDeps) so the tests run against a
 * fake server with no real waiting.
 */

import { ApplicationFailure } from '@temporalio/activity';

const QUEUE_URL = 'https://queue.fal.run';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
/** Inside the clip activity's 20 min start-to-close, with room for the download and upload. */
const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const SUBMIT_RETRY_BACKOFF_MS = [1_500, 4_000, 10_000];

/**
 * The failure type every provider's content refusal maps to. Its name dates
 * from EvoLink, the first provider, and stays: the render pipeline lists it as
 * non-retryable and persisted runs carry it as their error_code.
 */
export const CONTENT_POLICY_FAILURE = 'EVOLINK_CONTENT_POLICY_VIOLATION';

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

function refusal(endpoint: string, detail: string): ApplicationFailure {
  return ApplicationFailure.nonRetryable(`fal ${endpoint} refused: ${detail.slice(0, 400)}`, CONTENT_POLICY_FAILURE);
}

/** Submit a job to fal's queue, wait for it, and return its video URL. */
export async function runFalQueue(req: FalQueueRequest): Promise<FalQueueResult> {
  const http = req.deps?.fetch ?? fetch;
  const sleep = req.deps?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = req.deps?.now ?? Date.now;
  const auth = { Authorization: `Key ${req.apiKey}` };

  // ── Submit (a transient 5xx / 429 is retried with backoff; other 4xx are final) ──
  let submitted: { request_id?: string; status_url?: string; response_url?: string };
  for (let attempt = 0; ; attempt += 1) {
    const resp = await http(`${QUEUE_URL}/${req.endpoint}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(req.input),
    });
    if (resp.ok) {
      submitted = (await readBody(resp)) as typeof submitted;
      break;
    }
    const body = await readBody(resp);
    const status = resp.status;
    if ((status >= 500 || status === 429) && attempt < SUBMIT_RETRY_BACKOFF_MS.length) {
      await sleep(SUBMIT_RETRY_BACKOFF_MS[attempt]);
      continue;
    }
    const detail = detailText(body);
    if (status === 422 && REFUSAL.test(detail)) throw refusal(req.endpoint, detail);
    if (status >= 400 && status < 500 && status !== 429) {
      throw ApplicationFailure.nonRetryable(`fal ${req.endpoint} submit ${status}: ${detail.slice(0, 400)}`, `FAL_${status}`);
    }
    throw new Error(`fal ${req.endpoint} submit ${status}: ${detail.slice(0, 400)}`);
  }
  const requestId = submitted.request_id;
  if (!requestId || !submitted.status_url || !submitted.response_url) {
    throw new Error(`fal ${req.endpoint} submit returned no request id / status_url / response_url`);
  }

  // ── Poll ──────────────────────────────────────────────────────────────────
  const deadline = now() + (req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const pollMs = req.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  for (;;) {
    if (now() > deadline) {
      throw ApplicationFailure.nonRetryable(`fal ${req.endpoint} request ${requestId} timed out`, 'FAL_TIMEOUT');
    }
    const resp = await http(submitted.status_url, { headers: auth });
    if (!resp.ok) {
      if (resp.status >= 500 || resp.status === 429) {
        await sleep(pollMs);
        continue;
      }
      throw new Error(`fal ${req.endpoint} status ${resp.status}: ${detailText(await readBody(resp)).slice(0, 400)}`);
    }
    const st = (await readBody(resp)) as { status?: string; error?: unknown };
    const status = String(st?.status ?? '').toUpperCase();
    req.onPoll?.(status);
    if (status === 'COMPLETED') break;
    if (status === 'FAILED' || status === 'ERROR') {
      const detail = detailText(st);
      if (REFUSAL.test(detail)) throw refusal(req.endpoint, detail);
      throw new Error(`fal ${req.endpoint} request ${requestId} ${status}: ${detail.slice(0, 400)}`);
    }
    await sleep(pollMs);
  }

  // ── Result ────────────────────────────────────────────────────────────────
  const resp = await http(submitted.response_url, { headers: auth });
  const body = await readBody(resp);
  if (!resp.ok) {
    const detail = detailText(body);
    // fal answers a refused input or output with 422 on the result.
    if (resp.status === 422) {
      if (REFUSAL.test(detail)) throw refusal(req.endpoint, detail);
      throw ApplicationFailure.nonRetryable(`fal ${req.endpoint} result 422: ${detail.slice(0, 400)}`, 'FAL_422');
    }
    throw new Error(`fal ${req.endpoint} result ${resp.status}: ${detail.slice(0, 400)}`);
  }
  const raw = (body ?? {}) as Record<string, unknown>;
  const videoUrl = (raw.video as { url?: unknown } | null | undefined)?.url;
  if (typeof videoUrl !== 'string' || !/^https?:\/\//.test(videoUrl)) {
    throw new Error(`fal ${req.endpoint} request ${requestId} completed with no video URL`);
  }
  return { requestId, videoUrl, raw };
}
