// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Same-origin proxy for GET /v1/presets — the Preset picker: each Preset with
 * every Dialect marked available or coming soon (#8). See
 * services/api-v2/src/routes/v1/presets.ts.
 */

import { forwardToApiV2 } from '@/lib/api-v2-proxy';

export async function GET() {
  return forwardToApiV2('/v1/presets', { method: 'GET' });
}
