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
 * If the browser cannot PUT to the presigned URL (the bucket does not allow
 * this origin, so fetch throws), it falls back to the signed Supabase upload
 * the agent page uses, then asks api-v2 to re-host that URL (POST
 * /api/v1/uploads/image), which runs the same moderation. Still no base64.
 */

import { invokeFn } from '@/lib/supabase/fn-proxy';

export const PHOTO_TYPES = ['image/png', 'image/jpeg'] as const;
/** The presigned path's cap (api-v2 MAX_PRESIGNED_BYTES). */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
/** The re-host fallback's cap (api-v2 MAX_UPLOAD_BYTES). */
const MAX_FALLBACK_BYTES = 10 * 1024 * 1024;

export type UploadResult =
  | { ok: true; url: string }
  /** `status`/`body` as the API answered, for classifyApiError(). status 0 = no answer. */
  | { ok: false; status: number; body: unknown };

async function postJson(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  try {
    const r = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  } catch (e) {
    return { status: 0, body: { error: { code: 'network', message: (e as Error).message } } };
  }
}

const fail = (message: string, status = 400): UploadResult => ({ ok: false, status, body: { error: { code: 'INVALID_INPUT', message } } });

export async function uploadProductPhoto(file: File): Promise<UploadResult> {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return fail('Use a PNG or JPEG photo.');
  if (file.size <= 0) return fail('That file is empty.');
  if (file.size > MAX_PHOTO_BYTES) return fail('The photo must be 25 MB or smaller.');

  const presign = await postJson('/api/v1/uploads/presign', { bytes: file.size, content_type: file.type });
  const p = presign.body as { put_url?: string; upload_key?: string; content_type?: string } | null;
  if (presign.status !== 200 || !p?.put_url || !p.upload_key) return { ok: false, ...presign };

  let put: Response;
  try {
    put = await fetch(p.put_url, { method: 'PUT', headers: { 'Content-Type': p.content_type ?? file.type }, body: file });
  } catch {
    // No answer at all: the bucket refused this origin (CORS). Take the other road.
    return uploadViaSignedStorage(file);
  }
  if (!put.ok) return { ok: false, status: 502, body: { error: { code: 'UPLOAD_FAILED', message: `Storage refused the upload (HTTP ${put.status}).` } } };

  const confirmed = await postJson('/api/v1/uploads/confirm', { upload_key: p.upload_key });
  const url = (confirmed.body as { image_url?: unknown } | null)?.image_url;
  if (confirmed.status === 200 && typeof url === 'string') return { ok: true, url };
  return { ok: false, ...confirmed };
}

async function uploadViaSignedStorage(file: File): Promise<UploadResult> {
  if (file.size > MAX_FALLBACK_BYTES) return fail('The photo must be 10 MB or smaller.');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200) || 'photo';
  const { data, error } = await invokeFn('upload-url', { body: { filename: safeName, content_type: file.type } });
  const u = data as { upload_url?: string; storage_path?: string } | null;
  if (error || !u?.upload_url || !u.storage_path) {
    return { ok: false, status: 502, body: { error: { code: 'UPLOAD_FAILED', message: error?.message ?? 'Could not start the upload.' } } };
  }
  try {
    const up = await fetch(u.upload_url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    if (!up.ok) throw new Error(`HTTP ${up.status}`);
  } catch (e) {
    return { ok: false, status: 0, body: { error: { code: 'UPLOAD_FAILED', message: `Upload failed: ${(e as Error).message}` } } };
  }
  const signed = await postJson('/api/v1/generation-input-url', { storage_path: u.storage_path });
  const signedUrl = (signed.body as { signed_url?: unknown } | null)?.signed_url;
  if (signed.status !== 200 || typeof signedUrl !== 'string') return { ok: false, ...signed };
  const hosted = await postJson('/api/v1/uploads/image', { image_url: signedUrl });
  const url = (hosted.body as { image_url?: unknown } | null)?.image_url;
  if (hosted.status === 200 && typeof url === 'string') return { ok: true, url };
  return { ok: false, ...hosted };
}
