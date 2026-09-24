// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The fal queue client (#25), against a fake HTTP server: submit, poll until
// COMPLETED, fetch the result; a refusal (422 from the result) is the
// non-retryable content-policy failure; a job that never finishes times out.

import { describe, it, expect } from 'vitest';
import { runFalQueue, type FalDeps } from '../client/fal.js';
import { CONTENT_POLICY_REFUSED, NON_RETRYABLE_TYPES, failurePolicy } from '../failure-policy.js';

const ENDPOINT = 'fal-ai/kling-video/o3/pro/reference-to-video';
const STATUS_URL = `https://queue.fal.run/${ENDPOINT}/requests/req-1/status`;
const RESPONSE_URL = `https://queue.fal.run/${ENDPOINT}/requests/req-1`;
const INPUT = { prompt: 'p', image_urls: ['https://r2/p.png', 'https://r2/c.png'], aspect_ratio: '9:16', duration: '5', generate_audio: false };

interface Req { method: string; url: string; headers: Record<string, string>; body?: unknown; signal?: AbortSignal | null; redirect?: RequestRedirect }

/** A fake fal: each URL answers from its own queue of responses (the last repeats). */
function fakeFal(routes: Record<string, Array<[number, unknown]>>) {
  const requests: Req[] = [];
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    requests.push({ method: init.method ?? 'GET', url, headers, body: init.body ? JSON.parse(String(init.body)) : undefined, signal: init.signal, redirect: init.redirect });
    const queue = routes[url];
    if (!queue) return new Response('not found', { status: 404 });
    const [status, body] = queue.length > 1 ? queue.shift()! : queue[0];
    if (status === 0) throw new TypeError('fetch failed'); // a network error
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  let clock = 0;
  const deps: FalDeps = {
    fetch,
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, requests };
}

const submitted: [number, unknown] = [200, { request_id: 'req-1', status_url: STATUS_URL, response_url: RESPONSE_URL }];
const video = { video: { url: 'https://v3.fal.media/files/out.mp4', content_type: 'video/mp4' } };

describe('runFalQueue', () => {
  it('submits the input with the key, polls the status until COMPLETED, and returns the video URL', async () => {
    const { deps, requests } = fakeFal({
      [`https://queue.fal.run/${ENDPOINT}`]: [submitted],
      [STATUS_URL]: [[202, { status: 'IN_QUEUE' }], [200, { status: 'IN_PROGRESS' }], [200, { status: 'COMPLETED' }]],
      [RESPONSE_URL]: [[200, video]],
    });
    const out = await runFalQueue({ apiKey: 'k-1', endpoint: ENDPOINT, input: INPUT, deps });
    expect(out).toMatchObject({ requestId: 'req-1', videoUrl: 'https://v3.fal.media/files/out.mp4' });

    const [submit, ...rest] = requests;
    expect(submit).toMatchObject({ method: 'POST', url: `https://queue.fal.run/${ENDPOINT}`, body: INPUT });
    expect(submit.headers.Authorization).toBe('Key k-1');
    expect(rest.map((r) => r.url)).toEqual([STATUS_URL, STATUS_URL, STATUS_URL, RESPONSE_URL]);
    for (const r of rest) expect(r.headers.Authorization).toBe('Key k-1');
  });

  it('maps a refusal (422 from the result) to the non-retryable content-policy failure, with fal’s detail', async () => {
    const { deps } = fakeFal({
      [`https://queue.fal.run/${ENDPOINT}`]: [submitted],
      [STATUS_URL]: [[200, { status: 'COMPLETED' }]],
      [RESPONSE_URL]: [[422, { detail: [{ msg: 'The input may contain likenesses of real people.', type: 'content_policy_violation' }] }]],
    });
    await expect(runFalQueue({ apiKey: 'k', endpoint: ENDPOINT, input: INPUT, deps })).rejects.toMatchObject({
      type: CONTENT_POLICY_REFUSED,
      nonRetryable: true,
      message: expect.stringContaining('likenesses of real people'),
    });
  });

  it('maps a job that FAILED on a sensitive-content verdict to the content-policy failure too', async () => {
    const { deps } = fakeFal({
      [`https://queue.fal.run/${ENDPOINT}`]: [submitted],
      [STATUS_URL]: [[200, { status: 'FAILED', error: 'Output flagged as sensitive content' }]],
    });
    await expect(runFalQueue({ apiKey: 'k', endpoint: ENDPOINT, input: INPUT, deps })).rejects.toMatchObject({
      type: CONTENT_POLICY_REFUSED,
      nonRetryable: true,
    });
  });

  it.each(['ERROR', 'FAILED'])('makes an ordinary %s job final (FAL_FAILED): a rerun would pay again, the fallback is the retry', async (status) => {
    const { deps, requests } = fakeFal({
      [`https://queue.fal.run/${ENDPOINT}`]: [submitted],
      [STATUS_URL]: [[200, { status, error: 'worker crashed' }]],
    });
    const err = await runFalQueue({ apiKey: 'k', endpoint: ENDPOINT, input: INPUT, deps }).catch((e) => e);
    expect(err).toMatchObject({ type: 'FAL_FAILED', nonRetryable: true, message: expect.stringContaining('worker crashed') });
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1);
    expect(failurePolicy('FAL_FAILED')).toEqual({ retryable: false, fallbackable: true });
  });

  it('makes a non-5xx status poll error final', async () => {
    const { deps } = fakeFal({
      [`https://queue.fal.run/${ENDPOINT}`]: [submitted],
      [STATUS_URL]: [[404, { detail: 'Request not found' }]],
    });
    await expect(runFalQueue({ apiKey: 'k', endpoint: ENDPOINT, input: INPUT, deps })).rejects.toMatchObject({ type: 'FAL_404', nonRetryable: true });
  });

  it('keeps polling through a network blip or a 5xx on the status', async () => {
    const { deps } = fakeFal({
      [`https://queue.fal.run/${ENDPOINT}`]: [submitted],
      [STATUS_URL]: [[0, null], [503, 'busy'], [200, { status: 'COMPLETED' }]],
      [RESPONSE_URL]: [[200, video]],
    });
    await expect(runFalQueue({ apiKey: 'k', endpoint: ENDPOINT, input: INPUT, deps })).resolves.toMatchObject({ requestId: 'req-1' });
  });

  it('retries a transient result failure a few times, then makes it final (never resubmitting)', async () => {
    const flaky = fakeFal({
      [`https://queue.fal.run/${ENDPOINT}`]: [submitted],
      [STATUS_URL]: [[200, { status: 'COMPLETED' }]],
      [RESPONSE_URL]: [[502, 'bad gateway'], [0, null], [200, video]],
    });
    await expect(runFalQueue({ apiKey: 'k', endpoint: ENDPOINT, input: INPUT, deps: flaky.deps })).resolves.toMatchObject({ requestId: 'req-1' });

    const down = fakeFal({
      [`https://queue.fal.run/${ENDPOINT}`]: [submitted],
      [STATUS_URL]: [[200, { status: 'COMPLETED' }]],
      [RESPONSE_URL]: [[503, 'down']],
    });
    await expect(runFalQueue({ apiKey: 'k', endpoint: ENDPOINT, input: INPUT, deps: down.deps })).rejects.toMatchObject({ type: 'FAL_UNAVAILABLE', nonRetryable: true });
    expect(down.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  it('bounds pre-submit network errors: a few tries with backoff, then final', async () => {
    const { deps, requests } = fakeFal({ [`https://queue.fal.run/${ENDPOINT}`]: [[0, null]] });
    await expect(runFalQueue({ apiKey: 'k', endpoint: ENDPOINT, input: INPUT, deps })).rejects.toMatchObject({
      type: 'FAL_UNAVAILABLE',
      nonRetryable: true,
      message: expect.stringContaining('fetch failed'),
    });
    expect(requests).toHaveLength(4);

    const recovers = fakeFal({
      [`https://queue.fal.run/${ENDPOINT}`]: [[0, null], submitted],
      [STATUS_URL]: [[200, { status: 'COMPLETED' }]],
      [RESPONSE_URL]: [[200, video]],
    });
    await expect(runFalQueue({ apiKey: 'k', endpoint: ENDPOINT, input: INPUT, deps: recovers.deps })).resolves.toMatchObject({ requestId: 'req-1' });
  });

  it('makes a 5xx submit that never recovers final too', async () => {
    const { deps, requests } = fakeFal({ [`https://queue.fal.run/${ENDPOINT}`]: [[503, 'busy']] });
    await expect(runFalQueue({ apiKey: 'k', endpoint: ENDPOINT, input: INPUT, deps })).rejects.toMatchObject({ type: 'FAL_UNAVAILABLE', nonRetryable: true });
    expect(requests).toHaveLength(4);
  });

  it('lists every fal failure it builds as non-retryable for the render', () => {
    for (const code of ['FAL_FAILED', 'FAL_TIMEOUT', 'FAL_UNAVAILABLE', 'FAL_BAD_RESPONSE', 'FAL_400', 'FAL_404', 'FAL_422', CONTENT_POLICY_REFUSED]) {
      expect(NON_RETRYABLE_TYPES).toContain(code);
    }
  });

  it('times out a job that never completes (non-retryable: resubmitting pays again, the fallback is the retry)', async () => {
    const { deps } = fakeFal({
      [`https://queue.fal.run/${ENDPOINT}`]: [submitted],
      [STATUS_URL]: [[200, { status: 'IN_PROGRESS' }]],
    });
    await expect(
      runFalQueue({ apiKey: 'k', endpoint: ENDPOINT, input: INPUT, deps, timeoutMs: 60_000, pollIntervalMs: 5_000 }),
    ).rejects.toMatchObject({ type: 'FAL_TIMEOUT', nonRetryable: true });
  });

  it('fails a completed job whose result has no video, finally', async () => {
    const { deps } = fakeFal({
      [`https://queue.fal.run/${ENDPOINT}`]: [submitted],
      [STATUS_URL]: [[200, { status: 'COMPLETED' }]],
      [RESPONSE_URL]: [[200, { video: null }]],
    });
    await expect(runFalQueue({ apiKey: 'k', endpoint: ENDPOINT, input: INPUT, deps })).rejects.toMatchObject({
      type: 'FAL_BAD_RESPONSE',
      nonRetryable: true,
      message: expect.stringMatching(/no video/),
    });
  });

  it.each([
    ['status_url', { request_id: 'req-1', status_url: 'https://evil.example/status', response_url: RESPONSE_URL }],
    ['response_url', { request_id: 'req-1', status_url: STATUS_URL, response_url: 'https://queue.fal.run.evil.example/r' }],
    ['plain-http status_url', { request_id: 'req-1', status_url: STATUS_URL.replace('https:', 'http:'), response_url: RESPONSE_URL }],
    ['credentialed response_url', { request_id: 'req-1', status_url: STATUS_URL, response_url: RESPONSE_URL.replace('https://', 'https://u:p@') }],
  ])('refuses a %s off https://queue.fal.run and never sends the key there', async (_what, reply) => {
    const { deps, requests } = fakeFal({ [`https://queue.fal.run/${ENDPOINT}`]: [[200, reply]] });
    await expect(runFalQueue({ apiKey: 'secret-key', endpoint: ENDPOINT, input: INPUT, deps })).rejects.toMatchObject({
      type: 'FAL_BAD_RESPONSE',
      nonRetryable: true,
    });
    expect(requests).toHaveLength(1);
    for (const r of requests) expect(new URL(r.url).origin).toBe('https://queue.fal.run');
  });

  it('puts a timeout on every request and follows no redirect', async () => {
    const { deps, requests } = fakeFal({
      [`https://queue.fal.run/${ENDPOINT}`]: [submitted],
      [STATUS_URL]: [[200, { status: 'IN_PROGRESS' }], [200, { status: 'COMPLETED' }]],
      [RESPONSE_URL]: [[200, video]],
    });
    await runFalQueue({ apiKey: 'k', endpoint: ENDPOINT, input: INPUT, deps });
    expect(requests).toHaveLength(4);
    for (const r of requests) {
      expect(r.signal).toBeInstanceOf(AbortSignal);
      expect(r.redirect).toBe('error');
    }
  });
});
