// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Idempotency-Key body check (ARCHITECTURE.md, Credits & spend safety #4).
 *
 * A key names ONE request. The run a key started stores a fingerprint of the
 * request that started it (skill_runs / primitive_runs.request_fingerprint): a
 * sha256 of the canonical JSON of the skill slug plus the VALIDATED input
 * (after schema defaults, before any re-hosting). A replay with the same body
 * returns the original run; a replay with a different body is refused with
 * 409 `idempotency_key_reused`, so e.g. toggling the Music Bed and retrying
 * with the old key can never silently render the old setting.
 *
 * Every run path (the generic primitive path and the Preset render path) goes
 * through `replayMatches`. A run stored before fingerprints existed (NULL)
 * replays on its key alone, as it did before.
 */

import { createHash } from 'node:crypto';
import type { Response } from 'express';

/** JSON with object keys sorted at every depth; undefined members dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const members = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
  return `{${members.join(',')}}`;
}

/** The stable fingerprint of a run request: sha256(canonical {slug, input}), hex. */
export function requestFingerprint(slug: string, input: unknown): string {
  return createHash('sha256').update(canonicalJson({ slug, input })).digest('hex');
}

/** Whether a stored run may be replayed for a request with `fingerprint`. */
export function replayMatches(stored: unknown, fingerprint: string): boolean {
  return stored === null || stored === undefined || stored === fingerprint;
}

export const IDEMPOTENCY_KEY_REUSED =
  '`idempotency_key_reused`: this Idempotency-Key already started a run with a different request body; use a new key for a new request';

export function sendIdempotencyKeyReused(res: Response, slug: string, runId: string): void {
  res.status(409).json({
    error: 'idempotency_key_reused',
    skill: slug,
    run_id: runId,
    detail: 'This Idempotency-Key already started a run with a different request body. Use a new key for a new request.',
  });
}
