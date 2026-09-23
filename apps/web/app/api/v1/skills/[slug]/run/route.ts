// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Same-origin proxy for POST /v1/skills/:slug/run — start a vNext skill. The
 * Idempotency-Key is passed through, so a retried confirmation replays.
 */

import { NextRequest, NextResponse } from 'next/server';
import { forwardToApiV2 } from '@/lib/api-v2-proxy';

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: { code: 'invalid_json' } }, { status: 400 });
  }
  const idem = req.headers.get('idempotency-key');
  return forwardToApiV2(`/v1/skills/${encodeURIComponent(slug)}/run`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: idem ? { 'Idempotency-Key': idem } : undefined,
  });
}
