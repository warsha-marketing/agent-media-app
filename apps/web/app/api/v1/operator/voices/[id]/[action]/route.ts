// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Same-origin proxy for POST /v1/operator/voices/:id/(approve|revoke) (#7).
 * api-v2 records who and when, and refuses non-operators.
 */

import { NextRequest, NextResponse } from 'next/server';
import { forwardToAgentApi } from '@/lib/agent-chat-proxy';

const ACTIONS = new Set(['approve', 'revoke']);

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  if (!ACTIONS.has(action)) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  return forwardToAgentApi(`/v1/operator/voices/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: '{}' });
}
