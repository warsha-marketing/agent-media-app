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
 * The PUT is cross-origin, so the bucket must allow this web origin (CORS):
 * docker-compose configures MinIO; for R2 see README, "Storage CORS".
 */

export const PHOTO_TYPES = ['image/png', 'image/jpeg'] as const;
/** The presigned path's cap (api-v2 MAX_PRESIGNED_BYTES). */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

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
  } catch (e) {
    // No answer at all: offline, or the bucket does not allow this origin (CORS).
    return { ok: false, status: 0, body: { error: { code: 'UPLOAD_FAILED', message: `Could not reach storage (${(e as Error).message}).` } } };
  }
  if (!put.ok) return { ok: false, status: 502, body: { error: { code: 'UPLOAD_FAILED', message: `Storage refused the upload (HTTP ${put.status}).` } } };

  const confirmed = await postJson('/api/v1/uploads/confirm', { upload_key: p.upload_key });
  const url = (confirmed.body as { image_url?: unknown } | null)?.image_url;
  if (confirmed.status === 200 && typeof url === 'string') return { ok: true, url };
  return { ok: false, ...confirmed };
}
