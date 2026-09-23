// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Product photo upload for the web Product Hero flow (#6). The bytes go
 * straight from the browser to storage; the page only ever carries URLs.
 *
 *   1. POST /api/v1/uploads/presign  { bytes, content_type }  → { put_url, upload_key }
 *   2. PUT  put_url                  (the original file, unchanged)
 *   3. POST /api/v1/uploads/confirm  { upload_key }           → { image_url }
 *      — the server sniffs, size-checks and MODERATES the photo here, so a
 *        blocked photo is refused before anything is quoted or charged.
 *
 * The server owns the rules: presign refuses a file over its size limit (and
 * says what the limit is), confirm refuses anything that is not a PNG or JPEG.
 * Nothing here second-guesses them.
 *
 * The PUT is cross-origin, so the bucket must allow this web origin (CORS):
 * docker-compose configures MinIO; for R2 see README, "Storage CORS".
 */

import { postJson } from '@/lib/post-json';

/** A hint for the file picker only; the server checks the bytes. */
export const PHOTO_ACCEPT = 'image/png,image/jpeg';

export type UploadResult =
  | { ok: true; url: string }
  /** `status`/`body` as the API answered, for classifyApiError(). status 0 = no answer. */
  | { ok: false; status: number; body: unknown };

const uploadFailed = (status: number, message: string): UploadResult => ({
  ok: false,
  status,
  body: { error: { code: 'UPLOAD_FAILED', message } },
});

export async function uploadProductPhoto(file: File): Promise<UploadResult> {
  const presign = await postJson('/api/v1/uploads/presign', { bytes: file.size, content_type: file.type });
  const p = presign.body as { put_url?: string; upload_key?: string; content_type?: string } | null;
  if (presign.status !== 200 || !p?.put_url || !p.upload_key) return { ok: false, ...presign };

  let put: Response;
  try {
    put = await fetch(p.put_url, { method: 'PUT', headers: { 'Content-Type': p.content_type ?? file.type }, body: file });
  } catch (e) {
    // No answer at all: offline, or the bucket does not allow this origin (CORS).
    return uploadFailed(0, `Could not reach storage (${(e as Error).message}).`);
  }
  if (!put.ok) return uploadFailed(502, `Storage refused the upload (HTTP ${put.status}).`);

  const confirmed = await postJson('/api/v1/uploads/confirm', { upload_key: p.upload_key });
  const url = (confirmed.body as { image_url?: unknown } | null)?.image_url;
  if (confirmed.status === 200 && typeof url === 'string') return { ok: true, url };
  return { ok: false, ...confirmed };
}
