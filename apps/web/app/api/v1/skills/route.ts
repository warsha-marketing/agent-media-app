// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Same-origin proxy for GET /v1/skills — list registered vNext skills.
 */

import { forwardToApiV2 } from '@/lib/api-v2-proxy';

export async function GET() {
  return forwardToApiV2('/v1/skills', { method: 'GET' });
}
