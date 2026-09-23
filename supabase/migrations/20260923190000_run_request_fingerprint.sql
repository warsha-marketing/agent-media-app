-- Copyright 2026 agent-media contributors. Apache-2.0 license.
--
-- Idempotency-Key is bound to the request body (ARCHITECTURE.md, Credits &
-- spend safety #4).
--
-- A replay by Idempotency-Key used to return the original run without looking
-- at the body, so a retry with a changed body (e.g. the Music Bed toggled off,
-- then "Confirm again" after a network failure) silently replayed the old
-- request. api-v2 now stores a fingerprint of the request that started a run —
-- sha256 (hex) of the canonical JSON of the skill slug plus the validated input
-- (services/api-v2/src/skills/idempotency.ts) — and refuses a replay whose
-- fingerprint differs with 409 idempotency_key_reused.
--
-- Both run tables carry it: skill_runs (Preset renders) and primitive_runs (the
-- generic path). Nullable: it is written only with an Idempotency-Key, and a run
-- stored before this migration (NULL) replays on its key alone, as before.

ALTER TABLE public.skill_runs ADD COLUMN IF NOT EXISTS request_fingerprint text;
ALTER TABLE public.primitive_runs ADD COLUMN IF NOT EXISTS request_fingerprint text;

ALTER TABLE public.skill_runs DROP CONSTRAINT IF EXISTS skill_runs_request_fingerprint_shape;
ALTER TABLE public.skill_runs
  ADD CONSTRAINT skill_runs_request_fingerprint_shape
  CHECK (request_fingerprint IS NULL OR request_fingerprint ~ '^[0-9a-f]{64}$');

ALTER TABLE public.primitive_runs DROP CONSTRAINT IF EXISTS primitive_runs_request_fingerprint_shape;
ALTER TABLE public.primitive_runs
  ADD CONSTRAINT primitive_runs_request_fingerprint_shape
  CHECK (request_fingerprint IS NULL OR request_fingerprint ~ '^[0-9a-f]{64}$');

COMMENT ON COLUMN public.skill_runs.request_fingerprint IS
  'sha256 hex of canonical JSON {slug, validated input} of the request that started this run with an Idempotency-Key; a replay with a different fingerprint is refused (409 idempotency_key_reused). NULL = no key, or stored before fingerprints.';
COMMENT ON COLUMN public.primitive_runs.request_fingerprint IS
  'sha256 hex of canonical JSON {slug, validated input} of the request that started this run with an Idempotency-Key; a replay with a different fingerprint is refused (409 idempotency_key_reused). NULL = no key, or stored before fingerprints.';
