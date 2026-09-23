// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Same-origin proxy for POST /v1/drafts/product-hero — Brief → Script → voice
 * preview (#4). See services/api-v2/src/routes/v1/drafts.ts.
 */

import { NextRequest } from 'next/server';
import { forwardToAgentApi } from '@/lib/agent-chat-proxy';

export async function POST(req: NextRequest) {
  const body = await req.text();
  return forwardToAgentApi('/v1/drafts/product-hero', { method: 'POST', body });
}
