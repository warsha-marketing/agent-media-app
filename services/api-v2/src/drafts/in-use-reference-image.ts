// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The draft's In-use Reference image (#31), made by gpt-image at drafting time
 * (drafts/product-hero-draft.ts decides when). Kept apart from ./providers.ts,
 * whose audio store must only ever write PRIVATE objects: this image is public
 * by design — the render hands its URL to the video models, like the product
 * photo it is edited from.
 */

import sharp from 'sharp';
import { putPublicObject, readPublicObject } from '../lib/r2-upload.js';
import { generateImage } from '../lib/openai-image.js';
import { VISION_MAX_INPUT_PIXELS } from './product-photo.js';
import type { DraftDeps } from './product-hero-draft.js';

/** The most a stored product photo may be (the upload limit, with headroom). */
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

/**
 * The In-use Reference maker: the user's own product photo, read from our
 * bucket by key (never fetched from a URL) and re-encoded as PNG, edited by
 * gpt-image with the server's prompt, stored in the public bucket per draft
 * (the render hands its URL to the video models, like the product photo).
 */
export function gptImageInUseReference(opts: { apiKey: string; model: string }): DraftDeps['makeInUseReference'] {
  return async ({ userId, draftId, photoKey, prompt }) => {
    const photo = await sharp(await readPublicObject(photoKey, MAX_PHOTO_BYTES), { limitInputPixels: VISION_MAX_INPUT_PIXELS }).rotate().png().toBuffer();
    const out = await generateImage(opts.apiKey, { model: opts.model, prompt, referencePng: photo, size: '1024x1536' });
    const key = `vnext/in-use/${userId}/${draftId}.png`;
    const url = await putPublicObject(key, out.bytes, out.mime);
    return { key, url, model: opts.model };
  };
}
