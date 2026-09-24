// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Same-origin proxy for POST /v1/skills/:slug/shot-plan (#26) — the shots a
 * Preset render will make, each with its scene text and locked Guardrails.
 * Read-only and free; takes the quote's body (lib/api-v2-proxy.ts).
 */

import { NextRequest } from 'next/server';
import { forwardToApiV2 } from '@/lib/api-v2-proxy';

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }
  return forwardToApiV2(`/v1/skills/${encodeURIComponent(slug)}/shot-plan`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });
}
