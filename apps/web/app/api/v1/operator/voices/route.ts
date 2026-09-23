// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Same-origin proxy for the operator Voice catalog (#7): GET lists every Voice
 * with its review trail, POST adds a candidate. api-v2 answers 403 OPERATOR_ONLY
 * to anyone outside ADMIN_EMAILS, so this proxy does no gating of its own.
 */

import { NextRequest } from 'next/server';
import { forwardToApiV2 } from '@/lib/api-v2-proxy';

export async function GET(req: NextRequest) {
  return forwardToApiV2(`/v1/operator/voices${req.nextUrl.search}`, { method: 'GET' });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  return forwardToApiV2('/v1/operator/voices', { method: 'POST', body });
}
