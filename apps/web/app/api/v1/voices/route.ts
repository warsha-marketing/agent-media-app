// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Same-origin proxy for GET /v1/voices — Approved Voices for a Dialect, filterable
 * by gender and style (#7). See services/api-v2/src/routes/v1/voices.ts.
 */

import { NextRequest } from 'next/server';
import { forwardToAgentApi } from '@/lib/agent-chat-proxy';

export async function GET(req: NextRequest) {
  return forwardToAgentApi(`/v1/voices${req.nextUrl.search}`, { method: 'GET' });
}
