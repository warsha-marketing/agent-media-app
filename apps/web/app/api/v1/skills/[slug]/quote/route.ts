// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Same-origin proxy for POST /v1/skills/:slug/quote — confirm-before-spend price
 * preview. Read-only; returns { credits, available, committed, sufficient }.
 * Same backend as /run (lib/api-v2-proxy.ts), so the quoted number is the charge.
 */

import { NextRequest } from 'next/server';
import { forwardToApiV2 } from '@/lib/api-v2-proxy';

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }
  return forwardToApiV2(`/v1/skills/${encodeURIComponent(slug)}/quote`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });
}
