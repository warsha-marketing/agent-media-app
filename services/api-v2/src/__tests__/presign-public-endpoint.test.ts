// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Signed URLs are used by browsers and agents, not by api-v2 itself. In the
// compose stack api-v2 reaches MinIO as http://minio:9000, a name no browser
// can resolve, so the web Product Hero upload (a direct browser PUT) and the
// draft audio player need URLs signed for the host they can reach:
// S3_PUBLIC_ENDPOINT. Unset, signing uses S3_ENDPOINT (hosted R2: one host).

import { describe, it, expect, beforeEach, vi } from 'vitest';

const ENV_KEYS = ['S3_ENDPOINT', 'S3_PUBLIC_ENDPOINT', 'S3_FORCE_PATH_STYLE', 'S3_REGION', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PRIVATE_BUCKET'];

beforeEach(() => {
  vi.resetModules();
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, {
    S3_ENDPOINT: 'http://minio:9000',
    S3_FORCE_PATH_STYLE: 'true',
    S3_REGION: 'us-east-1',
    R2_ACCESS_KEY_ID: 'minioadmin',
    R2_SECRET_ACCESS_KEY: 'minioadmin',
    R2_BUCKET: 'agent-media-outputs',
    R2_PRIVATE_BUCKET: 'agent-media-private',
  });
});

describe('presigned URLs are signed for the host their user can reach', () => {
  it('upload PUT and private GET use S3_PUBLIC_ENDPOINT when set', async () => {
    process.env.S3_PUBLIC_ENDPOINT = 'http://localhost:9000';
    const { presignUpload, presignPrivateGet } = await import('../lib/r2-upload.js');
    const put = new URL((await presignUpload('u1', 1234, 'image/png')).put_url);
    expect(put.origin).toBe('http://localhost:9000');
    expect(put.pathname).toMatch(/^\/agent-media-outputs\/vnext\/staging\/u1\//);
    const get = new URL((await presignPrivateGet('vnext/drafts/u1/d.mp3', 60)).url);
    expect(get.origin).toBe('http://localhost:9000');
  });

  it('without it, signing uses S3_ENDPOINT, as before', async () => {
    const { presignUpload } = await import('../lib/r2-upload.js');
    expect(new URL((await presignUpload('u1', 1234, 'image/png')).put_url).origin).toBe('http://minio:9000');
  });
});
