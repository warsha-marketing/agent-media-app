// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// A provider's finished clip is downloaded only from the provider CDNs we know
// (#25): https, allowlisted hosts, no redirect off them, and a size cap.

import { describe, it, expect } from 'vitest';
import { downloadProviderVideo, isAllowedProviderVideoUrl, PROVIDER_VIDEO_MAX_BYTES } from '../lib/provider-video.js';

/** The URL shape fal returns (see fal-client.test.ts). */
const FAL_URL = 'https://v3.fal.media/files/out.mp4';

function fakeCdn(routes: Record<string, Response | (() => Response)>) {
  const hits: Array<{ url: string; redirect?: RequestRedirect; signal?: AbortSignal | null }> = [];
  const fetch = (async (url: string, init: RequestInit = {}) => {
    hits.push({ url, redirect: init.redirect, signal: init.signal });
    const r = routes[url];
    if (!r) return new Response('nope', { status: 404 });
    return typeof r === 'function' ? r() : r;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, hits };
}

describe('isAllowedProviderVideoUrl', () => {
  it.each([
    FAL_URL,
    'https://fal.media/files/x.mp4',
    'https://v3b.fal.media/files/b/x.mp4',
    'https://files.evolink.ai/videos/x.mp4',
    'https://ark-content-generation-ap-southeast-1.tos-ap-southeast-1.bytepluses.com/x.mp4',
    // ModelArk's real result host (live, 2026-09-24).
    'https://ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com/doubao-seedance-2-0/abc.mp4?X-Tos-Signature=x',
  ])('allows %s', (url) => expect(isAllowedProviderVideoUrl(url)).toBe(true));

  it.each([
    'http://v3.fal.media/files/out.mp4',
    'https://fal.media.evil.example/x.mp4',
    'https://evilfal.media/x.mp4',
    'https://evolink.ai/x.mp4',
    'https://api.evolink.ai/x.mp4',
    'https://bytepluses.com.evil.example/x.mp4',
    // Any other bucket on volces.com is someone else's.
    'https://other-bucket.tos-ap-southeast-1.volces.com/x.mp4',
    'https://volces.com/x.mp4',
    'https://169.254.169.254/latest/meta-data',
    'https://u:p@v3.fal.media/x.mp4',
    'https://v3.fal.media:8443/x.mp4',
    'not a url',
  ])('refuses %s', (url) => expect(isAllowedProviderVideoUrl(url)).toBe(false));
});

describe('downloadProviderVideo', () => {
  it('downloads an allowed clip, with a timeout and no automatic redirect', async () => {
    const cdn = fakeCdn({ [FAL_URL]: new Response(Buffer.from('MP4DATA')) });
    const bytes = await downloadProviderVideo(FAL_URL, { fetch: cdn.fetch });
    expect(bytes.toString()).toBe('MP4DATA');
    expect(cdn.hits[0].redirect).toBe('manual');
    expect(cdn.hits[0].signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses a host off the list without fetching it', async () => {
    const cdn = fakeCdn({});
    await expect(downloadProviderVideo('https://attacker.example/x.mp4', { fetch: cdn.fetch })).rejects.toMatchObject({
      type: 'PROVIDER_DOWNLOAD_REFUSED',
      nonRetryable: true,
    });
    expect(cdn.hits).toHaveLength(0);
  });

  it('follows a redirect within the list, and refuses one off it', async () => {
    const onList = fakeCdn({
      [FAL_URL]: new Response(null, { status: 302, headers: { location: 'https://v3b.fal.media/files/out.mp4' } }),
      'https://v3b.fal.media/files/out.mp4': new Response(Buffer.from('OK')),
    });
    expect((await downloadProviderVideo(FAL_URL, { fetch: onList.fetch })).toString()).toBe('OK');

    const offList = fakeCdn({
      [FAL_URL]: new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }),
    });
    await expect(downloadProviderVideo(FAL_URL, { fetch: offList.fetch })).rejects.toMatchObject({ type: 'PROVIDER_DOWNLOAD_REFUSED' });
    expect(offList.hits.map((h) => h.url)).toEqual([FAL_URL]);
  });

  it('refuses a clip over the cap, by its declared length or as it streams', async () => {
    expect(PROVIDER_VIDEO_MAX_BYTES).toBe(200 * 1024 * 1024);
    const declared = fakeCdn({ [FAL_URL]: new Response('x', { headers: { 'content-length': String(PROVIDER_VIDEO_MAX_BYTES + 1) } }) });
    await expect(downloadProviderVideo(FAL_URL, { fetch: declared.fetch })).rejects.toMatchObject({ type: 'PROVIDER_DOWNLOAD_REFUSED' });

    const streamed = fakeCdn({ [FAL_URL]: () => new Response(Buffer.alloc(64)) });
    await expect(downloadProviderVideo(FAL_URL, { fetch: streamed.fetch, maxBytes: 32 })).rejects.toMatchObject({
      type: 'PROVIDER_DOWNLOAD_REFUSED',
      message: expect.stringMatching(/cap/),
    });
  });

  it('an HTTP error is an ordinary failure (the caller decides whether a retry may resubmit)', async () => {
    const cdn = fakeCdn({ [FAL_URL]: new Response('gone', { status: 503 }) });
    const err = await downloadProviderVideo(FAL_URL, { fetch: cdn.fetch }).catch((e) => e);
    expect(err.message).toMatch(/clip download 503/);
    expect(err.type).toBeUndefined();
  });
});
