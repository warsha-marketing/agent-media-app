// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Same-origin proxy for POST /v1/uploads/image, URL form only — see
 * services/api-v2/src/routes/v1/uploads.ts. The Product Hero photo upload (#6)
 * falls back to it when the browser cannot PUT to the presigned URL: the photo
 * is first stored via the signed Supabase upload, then re-hosted (and
 * moderated) from its signed URL. Image bytes never pass through this route.
 */

import { NextRequest, NextResponse } from 'next/server';
import { forwardToAgentApi } from '@/lib/agent-chat-proxy';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { image_url?: unknown } | null;
  const url = typeof body?.image_url === 'string' ? body.image_url.trim() : '';
  if (!/^https:\/\//.test(url)) {
    return NextResponse.json({ error: { code: 'INVALID_INPUT', message: 'image_url (https) is required.' } }, { status: 400 });
  }
  return forwardToAgentApi('/v1/uploads/image', { method: 'POST', body: JSON.stringify({ image_url: url }) });
}
