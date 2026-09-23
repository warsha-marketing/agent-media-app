// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Which api-v2 the web app's same-origin proxies call.
 *
 * One variable, API_V2_URL, for every product route (drafts, voices, uploads,
 * skills: quote, run, run status, cancel). A quote and the run it prices must
 * hit the same backend, and a draft must be rendered by the api-v2 that wrote
 * it, so these never split across hosts.
 *
 * AGENT_API_V2_URL is a deprecated, agent-only override: the in-app agent brain
 * (/api/agent) and its chat persistence (/api/v1/agent/*) still honour it so a
 * developer can point just the brain at a local api-v2. Nothing else reads it.
 *
 * No imports: scripts/tests loads this file directly.
 */

export const DEFAULT_API_V2_URL = 'https://api.agent-media.ai';

/** 'api' = every product route; 'agent' = the agent brain and its chat persistence. */
export type ApiV2Backend = 'api' | 'agent';

type Env = Record<string, string | undefined>;

const clean = (v: string | undefined): string | undefined => {
  const t = v?.trim().replace(/\/+$/, '');
  return t ? t : undefined;
};

export function apiV2BaseUrl(backend: ApiV2Backend = 'api', env: Env = process.env): string {
  const agentOverride = backend === 'agent' ? clean(env.AGENT_API_V2_URL) : undefined;
  return agentOverride ?? clean(env.API_V2_URL) ?? DEFAULT_API_V2_URL;
}
