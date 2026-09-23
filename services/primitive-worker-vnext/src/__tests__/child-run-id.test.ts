// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Child run ids are shared by every composed workflow and must never change for
// a given (skill run, step): a retried or replayed workflow finds its earlier
// steps by these ids.

import { describe, it, expect } from 'vitest';
import { makeChildRunId, seedFromString } from '../workflows/child-run-id.js';

const RUN = '11111111-2222-4333-8444-555555555555';

describe('makeChildRunId', () => {
  it('is stable, uuid-shaped and keeps the skill run prefix', () => {
    const id = makeChildRunId(RUN, 'clip_0');
    expect(id).toBe(makeChildRunId(RUN, 'clip_0'));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(id.slice(0, 24)).toBe(RUN.slice(0, 24));
    // Pinned value: changing the derivation would orphan in-flight runs' steps.
    expect(makeChildRunId(RUN, 'mux')).toBe('11111111-2222-4333-8444-df84da9d0000');
  });

  it('gives every step label its own id', () => {
    const steps = ['audio', 'mux', 'compose', 'subs', 'voiceref', ...Array.from({ length: 12 }, (_, i) => `seg${i}`)];
    const ids = steps.map((s) => makeChildRunId(RUN, s));
    expect(new Set(ids).size).toBe(steps.length);
  });
});

describe('seedFromString', () => {
  it('is deterministic and never 0', () => {
    expect(seedFromString(RUN)).toBe(seedFromString(RUN));
    for (const s of ['', 'a', RUN, 'x'.repeat(100)]) {
      expect(seedFromString(s)).toBeGreaterThanOrEqual(1);
      expect(seedFromString(s)).toBeLessThanOrEqual(2147483646);
    }
  });
});
