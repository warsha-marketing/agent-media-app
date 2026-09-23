// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Same-origin proxy for POST /v1/shorts/:id/caption-exports — burn the edited
 * caption lines onto the clean Short on the server (#22). The Idempotency-Key
 * is passed through, so a retried export replays.
 */

import { NextRequest, NextResponse } from 'next/server';
import { forwardToApiV2 } from '@/lib/api-v2-proxy';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: { code: 'invalid_json' } }, { status: 400 });
  }
  const idem = req.headers.get('idempotency-key');
  return forwardToApiV2(`/v1/shorts/${encodeURIComponent(id)}/caption-exports`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: idem ? { 'Idempotency-Key': idem } : undefined,
  });
}
