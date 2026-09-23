// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Same-origin proxy for POST /v1/operator/presets/:preset/dialects/:dialect/(qualify|withdraw)
 * (#8). api-v2 validates the pair, records who and when, and refuses non-operators.
 */

import { NextRequest, NextResponse } from 'next/server';
import { forwardToApiV2 } from '@/lib/api-v2-proxy';

const ACTIONS = new Set(['qualify', 'withdraw']);

export async function POST(req: NextRequest, ctx: { params: Promise<{ preset: string; dialect: string; action: string }> }) {
  const { preset, dialect, action } = await ctx.params;
  if (!ACTIONS.has(action)) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  const body = (await req.text()) || '{}';
  return forwardToApiV2(`/v1/operator/presets/${encodeURIComponent(preset)}/dialects/${encodeURIComponent(dialect)}/${action}`, {
    method: 'POST',
    body,
  });
}
