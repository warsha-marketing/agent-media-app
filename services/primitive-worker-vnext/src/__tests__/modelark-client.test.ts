// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The ModelArk video client (#29, ADR 0003), against a fake HTTP server:
// submit, poll until succeeded, the .mp4 URL from the result; the two refusals
// ModelArk answers (PrivacyInformation at submit, a moderation verdict on a
// failed task) are the one content-policy refusal, so the fallback runs; a
// task that never finishes times out; the request bodies for
// reference-to-video and image-to-video (a first frame).

import { describe, it, expect } from 'vitest';
import { modelArkVideoBody, runModelArkVideo, type ModelArkDeps } from '../client/byteplus.js';
import { CONTENT_POLICY_REFUSED, failurePolicy } from '../failure-policy.js';

const BASE = 'https://ark.example.test/api/v3';
const SUBMIT = `${BASE}/contents/generations/tasks`;
const TASK = `${SUBMIT}/cgt-1`;
const MODEL = 'dreamina-seedance-2-0-mini-260615';
const BODY = modelArkVideoBody({ model: MODEL, prompt: 'The product in image 1.', referenceImages: ['https://r2.example.test/p.png'], duration: 5, ratio: '9:16' });
const OUT = 'https://ark-content-generation-ap-southeast-1.tos-ap-southeast-1.bytepluses.com/out/video.mp4?X-Tos-Signature=abc';

interface Req { method: string; url: string; headers: Record<string, string>; body?: unknown; redirect?: RequestRedirect }

function fakeArk(routes: Record<string, Array<[number, unknown]>>) {
  const requests: Req[] = [];
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    requests.push({ method: init.method ?? 'GET', url, headers, body: init.body ? JSON.parse(String(init.body)) : undefined, redirect: init.redirect });
    const queue = routes[url];
    if (!queue) return new Response('not found', { status: 404 });
    const [status, body] = queue.length > 1 ? queue.shift()! : queue[0];
    if (status === 0) throw new TypeError('fetch failed');
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  let clock = 0;
  const deps: ModelArkDeps = { fetch, sleep: async (ms) => { clock += ms; }, now: () => clock };
  return { deps, requests };
}

const run = (deps: ModelArkDeps, over: Partial<Parameters<typeof runModelArkVideo>[0]> = {}) =>
  runModelArkVideo({ apiKey: 'ark-1', body: BODY, baseUrl: BASE, deps, ...over });

describe('modelArkVideoBody', () => {
  it('reference-to-video: the text, then each image as a reference_image in order; audio off, 9:16, no watermark', () => {
    const body = modelArkVideoBody({
      model: MODEL,
      prompt: 'The person in image 2 holds the product in image 1.',
      referenceImages: ['https://r2/p.png', 'https://ark/persona.png'],
      duration: 5,
      ratio: '9:16',
    });
    expect(body).toEqual({
      model: MODEL,
      content: [
        { type: 'text', text: 'The person in image 2 holds the product in image 1.' },
        { type: 'image_url', image_url: { url: 'https://r2/p.png' }, role: 'reference_image' },
        { type: 'image_url', image_url: { url: 'https://ark/persona.png' }, role: 'reference_image' },
      ],
      generate_audio: false,
      ratio: '9:16',
      duration: 5,
      watermark: false,
    });
  });

  it('image-to-video: one first_frame image (the documented role)', () => {
    const body = modelArkVideoBody({ model: MODEL, prompt: 'p', firstFrame: 'https://r2/frame.png', duration: 10, ratio: '9:16' });
    expect(body.content).toEqual([
      { type: 'text', text: 'p' },
      { type: 'image_url', image_url: { url: 'https://r2/frame.png' }, role: 'first_frame' },
    ]);
    expect(body).toMatchObject({ generate_audio: false, duration: 10 });
  });

  it('never mixes a first frame with reference images, and needs one of them', () => {
    expect(() => modelArkVideoBody({ model: MODEL, prompt: 'p', firstFrame: 'https://f', referenceImages: ['https://r'], duration: 5, ratio: '9:16' })).toThrow(/cannot be mixed/);
    expect(() => modelArkVideoBody({ model: MODEL, prompt: 'p', duration: 5, ratio: '9:16' })).toThrow();
  });
});

describe('runModelArkVideo', () => {
  it('submits with the key, polls until succeeded, and returns the .mp4 URL', async () => {
    const polls: string[] = [];
    const { deps, requests } = fakeArk({
      [SUBMIT]: [[200, { id: 'cgt-1' }]],
      [TASK]: [[200, { id: 'cgt-1', status: 'queued' }], [200, { id: 'cgt-1', status: 'running' }], [200, { id: 'cgt-1', status: 'succeeded', content: { video_url: OUT }, usage: { completion_tokens: 108900 } }]],
    });
    const out = await run(deps, { onPoll: (s) => polls.push(s) });
    expect(out).toMatchObject({ taskId: 'cgt-1', videoUrl: OUT });
    expect(polls).toEqual(['queued', 'running', 'succeeded']);
    const [submit, ...rest] = requests;
    expect(submit).toMatchObject({ method: 'POST', url: SUBMIT, body: BODY, redirect: 'error' });
    expect(submit.body).toMatchObject({ generate_audio: false });
    for (const r of requests) expect(r.headers.Authorization).toBe('Bearer ark-1');
    expect(rest.map((r) => r.url)).toEqual([TASK, TASK, TASK]);
  });

  it('maps the PrivacyInformation refusal at submit (a photoreal face) to the content-policy refusal, so the fallback runs', async () => {
    const { deps, requests } = fakeArk({
      [SUBMIT]: [[400, { error: { code: 'InputImageSensitiveContentDetected.PrivacyInformation', message: 'The request failed because the input image may contain real person.' } }]],
    });
    const err = await run(deps).catch((e) => e);
    expect(err).toMatchObject({ type: CONTENT_POLICY_REFUSED, nonRetryable: true, message: expect.stringContaining('PrivacyInformation') });
    expect(failurePolicy(err.type).fallbackable).toBe(true);
    expect(requests).toHaveLength(1); // never resubmitted
  });

  it('maps a task that failed on a moderation verdict to the content-policy refusal too', async () => {
    const { deps } = fakeArk({
      [SUBMIT]: [[200, { id: 'cgt-1' }]],
      [TASK]: [[200, { id: 'cgt-1', status: 'failed', error: { code: 'OutputVideoSensitiveContentDetected', message: 'The output video may contain sensitive information.' } }]],
    });
    await expect(run(deps)).rejects.toMatchObject({ type: CONTENT_POLICY_REFUSED, nonRetryable: true });
  });

  it('an ordinary failed task is MODELARK_FAILED: final, and the fallback may run', async () => {
    const { deps, requests } = fakeArk({
      [SUBMIT]: [[200, { id: 'cgt-1' }]],
      [TASK]: [[200, { id: 'cgt-1', status: 'failed', error: { code: 'InternalServiceError', message: 'worker crashed' } }]],
    });
    await expect(run(deps)).rejects.toMatchObject({ type: 'MODELARK_FAILED', nonRetryable: true });
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  it('times out a task that never finishes (MODELARK_TIMEOUT, final)', async () => {
    const { deps } = fakeArk({ [SUBMIT]: [[200, { id: 'cgt-1' }]], [TASK]: [[200, { id: 'cgt-1', status: 'running' }]] });
    await expect(run(deps, { timeoutMs: 60_000, pollIntervalMs: 5_000 })).rejects.toMatchObject({ type: 'MODELARK_TIMEOUT', nonRetryable: true });
  });

  it('retries a 5xx / 429 / network error at submit a few times, then is MODELARK_UNAVAILABLE', async () => {
    const ok = fakeArk({ [SUBMIT]: [[503, 'busy'], [0, null], [429, { error: { code: 'RateLimit' } }], [200, { id: 'cgt-1' }]], [TASK]: [[200, { status: 'succeeded', content: { video_url: OUT } }]] });
    await expect(run(ok.deps)).resolves.toMatchObject({ videoUrl: OUT });
    const down = fakeArk({ [SUBMIT]: [[503, 'busy']] });
    await expect(run(down.deps)).rejects.toMatchObject({ type: 'MODELARK_UNAVAILABLE', nonRetryable: true });
    expect(down.requests).toHaveLength(4);
  });

  it('keeps polling through a 5xx or a network blip on the status', async () => {
    const { deps } = fakeArk({ [SUBMIT]: [[200, { id: 'cgt-1' }]], [TASK]: [[502, 'bad gateway'], [0, null], [200, { status: 'succeeded', content: { video_url: OUT } }]] });
    await expect(run(deps)).resolves.toMatchObject({ videoUrl: OUT });
  });

  it('another 4xx at submit is final at once (a bad key: MODELARK_401)', async () => {
    const { deps, requests } = fakeArk({ [SUBMIT]: [[401, { error: { code: 'AuthenticationError', message: 'invalid api key' } }]] });
    await expect(run(deps)).rejects.toMatchObject({ type: 'MODELARK_401', nonRetryable: true });
    expect(requests).toHaveLength(1);
  });

  it('a succeeded task with no video URL is MODELARK_BAD_RESPONSE', async () => {
    const { deps } = fakeArk({ [SUBMIT]: [[200, { id: 'cgt-1' }]], [TASK]: [[200, { status: 'succeeded', content: {} }]] });
    await expect(run(deps)).rejects.toMatchObject({ type: 'MODELARK_BAD_RESPONSE' });
  });
});
