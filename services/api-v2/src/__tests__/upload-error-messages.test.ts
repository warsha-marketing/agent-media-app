// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Errors thrown by the storage helper carry an internal "r2:" tag (useful in
// logs). It must never reach a user: the web page and agents show these
// messages verbatim, so the routes strip it at the boundary.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const THROW: { message: string } = { message: '' };
vi.mock('../lib/r2-upload.js', async (orig) => {
  const real = await orig<typeof import('../lib/r2-upload.js')>();
  const boom = async () => { throw new Error(THROW.message); };
  return {
    ...real,
    presignUpload: boom,
    confirmUpload: boom,
    uploadUserImageFromUrl: boom,
    uploadUserImageBase64: boom,
    uploadUserVideoFromUrl: boom,
  };
});
vi.mock('../server.js', () => ({ supabase: {} }));

const { presignUploadRoute, confirmUploadRoute, uploadImageRoute } = await import('../routes/v1/uploads.js');
const { publicStorageMessage, presignUpload: realPresign } = await vi.importActual<typeof import('../lib/r2-upload.js')>('../lib/r2-upload.js');

async function call(route: (req: Request, res: Response) => Promise<void>, body: Record<string, unknown>) {
  const out = { status: 0, body: {} as { error?: { code?: string; message?: string } } };
  const req = { userId: 'u1', body, params: {}, header: () => undefined } as unknown as Request;
  const res = {
    status(c: number) { out.status = c; return this; },
    json(p: typeof out.body) { out.body = p; return this; },
  } as unknown as Response;
  await route(req, res);
  return out;
}

beforeEach(() => { THROW.message = ''; });

describe('storage errors reach users without the internal r2: tag', () => {
  it.each([
    ['confirm', confirmUploadRoute, { upload_key: 'vnext/staging/u1/x.png' }, 'r2: uploaded file is not a PNG or JPEG'],
    ['presign', presignUploadRoute, { bytes: 10, content_type: 'image/png' }, 'r2: file too large (26.0 MB; the limit is 25 MB)'],
    ['image', uploadImageRoute, { image_url: 'https://example.com/a.png' }, 'r2: URL resolves to a private/internal address'],
  ] as const)('%s', async (_name, route, body, thrown) => {
    THROW.message = thrown;
    const r = await call(route, body);
    expect(r.status).toBe(400);
    expect(r.body.error?.message).toBe(thrown.replace(/^r2: /, ''));
    expect(r.body.error?.message).not.toMatch(/r2:/i);
  });

  it('publicStorageMessage strips only the leading tag', () => {
    expect(publicStorageMessage(new Error('r2: fetch failed (404)'))).toBe('fetch failed (404)');
    expect(publicStorageMessage(new Error('image rejected by content moderation'))).toBe('image rejected by content moderation');
    expect(publicStorageMessage('R2:  weird')).toBe('weird');
  });

  it('an oversized presign says how big the file is and what the limit is, in MB', async () => {
    process.env.R2_ACCESS_KEY_ID = 'k';
    process.env.R2_SECRET_ACCESS_KEY = 's';
    process.env.S3_ENDPOINT = 'http://minio:9000';
    await expect(realPresign('u1', 30 * 1024 * 1024, 'image/png')).rejects.toThrow('r2: file too large (30.0 MB; the limit is 25 MB)');
  });
});
