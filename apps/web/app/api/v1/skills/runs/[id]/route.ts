// Copyright 2026 agent-media contributors. Apache-2.0 license.

/** Same-origin proxy for GET /v1/skills/runs/:id — a skill run's status. */

import { NextRequest } from 'next/server';
import { forwardToApiV2 } from '@/lib/api-v2-proxy';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return forwardToApiV2(`/v1/skills/runs/${encodeURIComponent(id)}`, { method: 'GET' });
}
