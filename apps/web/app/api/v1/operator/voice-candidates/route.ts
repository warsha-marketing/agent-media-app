// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Same-origin proxy for GET /v1/operator/voice-candidates — the provider's shared
 * Arabic voices, for operators looking for candidates to review (#7).
 */

import { NextRequest } from 'next/server';
import { forwardToApiV2 } from '@/lib/api-v2-proxy';

export async function GET(req: NextRequest) {
  return forwardToApiV2(`/v1/operator/voice-candidates${req.nextUrl.search}`, { method: 'GET' });
}
