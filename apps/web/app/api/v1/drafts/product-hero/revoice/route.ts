// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Same-origin proxy for POST /v1/drafts/product-hero/revoice — voice an edited
 * Script as a new draft (#4).
 */

import { NextRequest } from 'next/server';
import { forwardToApiV2 } from '@/lib/api-v2-proxy';

export async function POST(req: NextRequest) {
  const body = await req.text();
  return forwardToApiV2('/v1/drafts/product-hero/revoice', { method: 'POST', body });
}
