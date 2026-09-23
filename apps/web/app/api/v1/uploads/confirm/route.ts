// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Same-origin proxy for POST /v1/uploads/confirm — see services/api-v2/src/routes/v1/uploads.ts.
 * Used by the Product Hero photo upload (#6); JSON only, never image bytes.
 */

import { NextRequest } from 'next/server';
import { forwardToAgentApi } from '@/lib/agent-chat-proxy';

export async function POST(req: NextRequest) {
  const body = await req.text();
  return forwardToAgentApi('/v1/uploads/confirm', { method: 'POST', body });
}
