// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Draft audio lives only in the private bucket. A worker without
// R2_PRIVATE_BUCKET must refuse to read it — non-retryably, since retrying
// cannot configure a bucket — rather than look for it in the public R2_BUCKET.

import { describe, it, expect, afterEach, vi } from 'vitest';
import type { WorkerConfig } from '../config.js';
import { makeFetchDraftAudioActivity } from '../activities/product-hero.js';
import { r2GetPrivateObject } from '../client/r2.js';

function cfgWithout(): WorkerConfig {
  return {
    supabase: { url: 'https://db.example.test', serviceRoleKey: 'service-role' },
    r2: {
      accountId: 'acct',
      accessKeyId: 'AKIATEST',
      secretAccessKey: 'secret',
      bucket: 'public-outputs',
      privateBucket: null,
      publicUrl: 'https://pub.r2.test',
    },
  } as unknown as WorkerConfig;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('draft audio storage (worker)', () => {
  it('fails the audio fetch non-retryably when R2_PRIVATE_BUCKET is unset', async () => {
    const fetchDraftAudio = makeFetchDraftAudioActivity(cfgWithout());
    await expect(
      fetchDraftAudio({
        primitive_run_id: 'p1',
        user_id: 'u1',
        skill_run_id: 's1',
        draft_id: 'd1',
        audio_key: 'vnext/drafts/u1/d1.mp3',
        duration_ms: 9_000,
      }),
    ).rejects.toMatchObject({ type: 'DRAFT_STORAGE_UNCONFIGURED', nonRetryable: true });
  });

  it('never reads a private object from the public bucket', async () => {
    await expect(r2GetPrivateObject(cfgWithout().r2, 'vnext/drafts/u1/d1.mp3')).rejects.toThrow(/R2_PRIVATE_BUCKET/);
  });

  it('config has no private bucket unless R2_PRIVATE_BUCKET is set', async () => {
    vi.stubEnv('R2_BUCKET', 'public-outputs');
    vi.stubEnv('R2_PRIVATE_BUCKET', '');
    const { privateBucketFromEnv } = await import('../config.js');
    expect(privateBucketFromEnv()).toBeNull();
    vi.stubEnv('R2_PRIVATE_BUCKET', 'private-drafts');
    expect(privateBucketFromEnv()).toBe('private-drafts');
  });
});
