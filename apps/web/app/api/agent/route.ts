// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Same-origin proxy for POST /v1/agent — the in-app creative agent brain.
 * Forwards the conversation (Anthropic Messages format) to api-v2 with the
 * caller's Supabase access token. Honours the deprecated AGENT_API_V2_URL
 * override (lib/api-v2-url.ts), like its chat persistence routes.
 */

import { NextRequest } from 'next/server';
import { forwardToAgentApi } from '@/lib/api-v2-proxy';

export async function POST(req: NextRequest) {
  const body = await req.text();
  return forwardToAgentApi('/v1/agent', {
    method: 'POST',
    body,
    // Declare this client supports the interactive ask_user choice card, so the
    // brain may offer it. Old clients omit this and never receive ask_user.
    headers: { 'x-am-agent-caps': 'ask_user' },
  });
}
