// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Every host safeSampleUrl() accepts for a Voice sample must be allowed by the
// dashboard CSP's media-src, or the sample's play button silently greys out.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const candidates = readFileSync(new URL('../../services/api-v2/src/voices/candidates.ts', import.meta.url), 'utf8');
const middleware = readFileSync(new URL('../../apps/web/middleware.ts', import.meta.url), 'utf8');

describe('Voice sample hosts vs dashboard CSP', () => {
  it('media-src admits every host safeSampleUrl accepts', () => {
    const fn = candidates.slice(candidates.indexOf('export function safeSampleUrl'), candidates.indexOf('export function suggestedDialect'));
    const hosts = [...fn.matchAll(/'([a-z0-9.-]+\.(?:com|io))'/g)].map((m) => m[1]);
    assert.ok(hosts.length >= 3, `expected sample hosts in safeSampleUrl, found ${hosts.join(', ')}`);
    const line = middleware.match(/const VOICE_SAMPLE_SOURCES = '([^']*)'/);
    assert.ok(line, 'VOICE_SAMPLE_SOURCES not found in middleware.ts');
    for (const host of hosts) assert.ok(line[1].includes(`https://${host}`), `CSP media-src is missing https://${host}`);
  });
});
