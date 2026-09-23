// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Same-origin proxy to api-v2: forwards a request with the caller's Supabase
 * access token and relays the JSON answer (status included). Every web route
 * that fronts api-v2 goes through here, so they all reach the SAME backend
 * (see lib/api-v2-url.ts for which variable picks it).
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { apiV2BaseUrl, type ApiV2Backend } from '@/lib/api-v2-url';

export interface ForwardInit {
  method: string;
  /** A JSON string; sets Content-Type: application/json. */
  body?: string;
  /** Extra headers (e.g. Idempotency-Key). Authorization is always ours. */
  headers?: Record<string, string>;
  /** Defaults to 'api'. Only the agent brain and its chats pass 'agent'. */
  backend?: ApiV2Backend;
}

export async function forwardToApiV2(upstreamPath: string, init: ForwardInit): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 });
  }
  const headers: Record<string, string> = { ...init.headers, Authorization: `Bearer ${session.access_token}` };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const upstream = await fetch(`${apiV2BaseUrl(init.backend)}${upstreamPath}`, {
      method: init.method,
      headers,
      body: init.body,
      cache: 'no-store',
    });
    const text = await upstream.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: { message: text.slice(0, 400) } }; }
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'upstream_unreachable', message: (err as Error).message } },
      { status: 502 },
    );
  }
}

/** The agent brain's chat persistence: must hit the same api-v2 as the brain. */
export function forwardToAgentApi(upstreamPath: string, init: Omit<ForwardInit, 'backend'>): Promise<NextResponse> {
  return forwardToApiV2(upstreamPath, { ...init, backend: 'agent' });
}
