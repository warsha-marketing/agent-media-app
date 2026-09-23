// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * POST JSON to a same-origin route and hand back the status and the parsed
 * body, never throwing: no answer at all is status 0 with a `network` error
 * body, which classifyApiError() (lib/product-hero-flow.ts) reads as retryable.
 */
export async function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  try {
    const r = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  } catch (e) {
    return { status: 0, body: { error: { code: 'network', message: (e as Error).message } } };
  }
}
