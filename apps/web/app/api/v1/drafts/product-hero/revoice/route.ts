// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Same-origin proxy for POST /v1/drafts/product-hero/revoice — voice an edited
 * Script as a new draft (#4).
 */

import { NextRequest } from 'next/server';
import { forwardToAgentApi } from '@/lib/agent-chat-proxy';

export async function POST(req: NextRequest) {
  const body = await req.text();
  return forwardToAgentApi('/v1/drafts/product-hero/revoice', { method: 'POST', body });
}
