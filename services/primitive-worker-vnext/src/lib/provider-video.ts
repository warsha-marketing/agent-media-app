// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Download a provider's finished clip (#25) — the URL a video provider handed
 * back is fetched only from the provider CDNs we know, over https, never
 * redirected off them, and never larger than PROVIDER_VIDEO_MAX_BYTES.
 *
 * Allowed hosts (PROVIDER_VIDEO_HOSTS; a leading "." allows subdomains):
 *   fal.media, *.fal.media   fal's CDN (results come back as v3.fal.media/files/…)
 *   files.evolink.ai         EvoLink's result files
 *   *.bytepluses.com         BytePlus (ModelArk, which EvoLink's Seedance runs on)
 *   ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com
 *                            ModelArk's own result bucket (seen live 2026-09-24); the
 *                            exact host only — anyone can host on volces.com
 *
 * A URL off the list, a redirect off it, or a clip over the cap is
 * PROVIDER_DOWNLOAD_REFUSED (final; the shot's fallback model may still run).
 */

import { providerFailure } from '../client/provider-failure.js';

export const PROVIDER_VIDEO_HOSTS: readonly string[] = ['fal.media', '.fal.media', 'files.evolink.ai', '.bytepluses.com', 'ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com'];
/** A 10 s 1080p clip is tens of MB; nothing we render is near this. */
export const PROVIDER_VIDEO_MAX_BYTES = 200 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export interface ProviderVideoDeps {
  fetch?: typeof fetch;
  maxBytes?: number;
}

/** Whether `url` is an https URL on an allowed provider host. */
export function isAllowedProviderVideoUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  return PROVIDER_VIDEO_HOSTS.some((h) => (h.startsWith('.') ? host.endsWith(h) && host.length > h.length : host === h));
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host || url.slice(0, 100);
  } catch {
    return url.slice(0, 100);
  }
};

const refused = (why: string) => providerFailure(`provider clip download refused: ${why}`.slice(0, 500), 'PROVIDER_DOWNLOAD_REFUSED');

export async function downloadProviderVideo(url: string, deps: ProviderVideoDeps = {}): Promise<Buffer> {
  const http = deps.fetch ?? fetch;
  const maxBytes = deps.maxBytes ?? PROVIDER_VIDEO_MAX_BYTES;
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  let current = url;
  for (let hop = 0; ; hop += 1) {
    if (!isAllowedProviderVideoUrl(current)) throw refused(`${hostOf(current)} is not an allowed provider host (https only)`);
    const resp = await http(current, { redirect: 'manual', signal });
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location');
      if (!location || hop >= MAX_REDIRECTS) throw refused(`too many or empty redirects from ${hostOf(current)}`);
      current = new URL(location, current).href;
      continue;
    }
    if (!resp.ok) throw new Error(`clip download ${resp.status}`);
    const declared = Number(resp.headers.get('content-length') ?? NaN);
    if (Number.isFinite(declared) && declared > maxBytes) throw refused(`${declared} bytes is over the ${maxBytes} byte cap`);
    if (!resp.body) return Buffer.alloc(0);
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = resp.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw refused(`over the ${maxBytes} byte cap`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
}
