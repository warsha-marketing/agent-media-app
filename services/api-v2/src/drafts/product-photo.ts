// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The product photo a draft's Product Profile is read from (#30). The draft
 * takes only a photo already on our storage, uploaded by this user (the web
 * uploader or `upload_image`: `<public prefix>/vnext/uploads/<user id>/<uuid>.png|jpg`),
 * so the server never fetches an arbitrary URL at drafting time, and the bytes
 * it reads were already sniffed, size-checked and moderated when they were
 * uploaded. The render re-hosts any https photo onto the same prefix, so a
 * photo that passes here is one the render takes as-is.
 */

import sharp from 'sharp';
import { getR2PublicUrlPrefix, readPublicObject } from '../lib/r2-upload.js';

const FILE = /^[A-Za-z0-9-]{1,64}\.(png|jpe?g)$/;

/**
 * The storage key of `url` when it is one of `userId`'s own uploads under the
 * public storage prefix (no trailing slash); null for anything else: another
 * host, another user's upload, another folder, a query string or a path trick.
 */
export function ownProductPhotoKey(url: string, userId: string, publicPrefix: string): string | null {
  if (!publicPrefix || !userId || /[/?#\\]/.test(userId)) return null;
  const folder = `${publicPrefix.replace(/\/+$/, '')}/vnext/uploads/${userId}/`;
  if (!url.startsWith(folder)) return null;
  const file = url.slice(folder.length);
  return FILE.test(file) ? `vnext/uploads/${userId}/${file}` : null;
}

/** The production check, against this server's public storage prefix. */
export function storageProductPhotoKey(url: string, userId: string): string | null {
  return ownProductPhotoKey(url, userId, getR2PublicUrlPrefix());
}

/** Claude's recommended long edge: a larger photo costs tokens without adding detail. */
const VISION_EDGE_PX = 1568;
const MAX_STORED_BYTES = 25 * 1024 * 1024;

/**
 * A stored product photo as Claude reads it: downscaled to at most 1568 px on
 * the long edge and re-encoded as JPEG (well under the API's per-image limit),
 * base64. Read from our own bucket by key: nothing is fetched from the web.
 */
export async function readProductPhotoForVision(key: string): Promise<{ media_type: 'image/jpeg'; data: string }> {
  const bytes = await readPublicObject(key, MAX_STORED_BYTES);
  const jpeg = await sharp(bytes)
    .rotate()
    .resize(VISION_EDGE_PX, VISION_EDGE_PX, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { media_type: 'image/jpeg', data: jpeg.toString('base64') };
}
