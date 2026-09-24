// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The fal queue client (#25), against a fake HTTP server: submit, poll until
// COMPLETED, fetch the result; a refusal (422 from the result) is the
// non-retryable content-policy failure; a job that never finishes times out.

import { describe, it, expect } from 'vitest';
import { CONTENT_POLICY_FAILURE, runFalQueue, type FalDeps } from '../client/fal.js';

const ENDPOINT = 'fal-ai/kling-video/o3/pro/reference-to-video';
const STATUS_URL = `https://queue.fal.run/${ENDPOINT}/requests/req-1/status`;
const RESPONSE_URL = `https://queue.fal.run/${ENDPOINT}/requests/req-1`;
const INPUT = { prompt: 'p', image_urls: ['https://r2/p.png', 'https://r2/c.png'], aspect_ratio: '9:16', duration: '5', generate_audio: false };

interface Req { method: string; url: string; headers: Record<string, string>; body?: unknown }

/** A fake fal: each URL answers from its own queue of responses (the last repeats). */
function fakeFal(routes: Record<string, Array<[number, unknown]>>) {
  const requests: Req[] = [];
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    requests.push({ method: init.method ?? 'GET', url, headers, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const queue = routes[url];
    if (!queue) return new Response('not found', { status: 404 });
    const [status, body] = queue.length > 1 ? queue.shift()! : queue[0];
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
      type: CONTENT_POLICY_FAILURE,
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
      type: CONTENT_POLICY_FAILURE,
      nonRetryable: true,
    });
  });

  it('keeps an ordinary failed job retryable', async () => {
    const { deps } = fakeFal({
      [`https://queue.fal.run/${ENDPOINT}`]: [submitted],
      [STATUS_URL]: [[200, { status: 'ERROR', error: 'worker crashed' }]],
    });
    const err = await runFalQueue({ apiKey: 'k', endpoint: ENDPOINT, input: INPUT, deps }).catch((e) => e);
    expect(err.message).toContain('worker crashed');
    expect(err.nonRetryable).not.toBe(true);
  });

  it('refuses a bad submit (4xx) without resubmitting, and retries a 5xx submit', async () => {
    const bad = fakeFal({ [`https://queue.fal.run/${ENDPOINT}`]: [[400, { detail: 'bad duration' }]] });
    await expect(runFalQueue({ apiKey: 'k', endpoint: ENDPOINT, input: INPUT, deps: bad.deps })).rejects.toMatchObject({
      type: 'FAL_400',
      nonRetryable: true,
    });
    expect(bad.requests).toHaveLength(1);

    const flaky = fakeFal({
      [`https://queue.fal.run/${ENDPOINT}`]: [[503, 'busy'], submitted],
      [STATUS_URL]: [[200, { status: 'COMPLETED' }]],
      [RESPONSE_URL]: [[200, video]],
    });
    await expect(runFalQueue({ apiKey: 'k', endpoint: ENDPOINT, input: INPUT, deps: flaky.deps })).resolves.toMatchObject({ requestId: 'req-1' });
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

  it('fails a completed job whose result has no video', async () => {
    const { deps } = fakeFal({
      [`https://queue.fal.run/${ENDPOINT}`]: [submitted],
      [STATUS_URL]: [[200, { status: 'COMPLETED' }]],
      [RESPONSE_URL]: [[200, { video: null }]],
    });
    await expect(runFalQueue({ apiKey: 'k', endpoint: ENDPOINT, input: INPUT, deps })).rejects.toThrow(/no video/);
  });
});
