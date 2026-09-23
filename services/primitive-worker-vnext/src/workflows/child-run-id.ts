// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Deterministic ids and seeds for composed workflows. Pure and isolate-safe (no
 * crypto / Date / random), so it runs inside the Temporal workflow sandbox and
 * yields the same values on every replay and retry.
 */

/** FNV-1a 32-bit hash. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic seed in [1, 2^31-1] from a string — never 0, since some
 * providers treat seed 0 as "pick a random seed", which would defeat a
 * cross-take consistency lock.
 */
export function seedFromString(s: string): number {
  return (fnv1a(s) % 2147483646) + 1;
}

/**
 * Deterministic child primitive_run_id from skill_run_id + step label: the last
 * 12 hex chars of the uuid are replaced with a hash of the step, so every step
 * label gets its own id and the ids stay idempotent across workflow retries.
 */
export function makeChildRunId(skillRunId: string, step: string): string {
  const suffix = (fnv1a(step).toString(16).padStart(8, '0') + '0000').slice(0, 12);
  const base = skillRunId.replace(/[^a-f0-9-]/gi, '').toLowerCase();
  return base.slice(0, base.length - 12) + suffix;
}
