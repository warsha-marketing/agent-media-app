// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Same-origin proxy for GET /v1/operator/presets (#8): every Preset × Dialect
 * with its qualification and review trail. api-v2 answers 403 OPERATOR_ONLY to
 * anyone outside ADMIN_EMAILS, so this proxy does no gating of its own.
 */

import { forwardToApiV2 } from '@/lib/api-v2-proxy';

export async function GET() {
  return forwardToApiV2('/v1/operator/presets', { method: 'GET' });
}
