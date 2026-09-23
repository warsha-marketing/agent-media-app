-- Voice catalog (#7) — Voices, each tagged with exactly one Dialect, and their
-- native-review approval state (CONTEXT.md: Voice, Approved Voice, Dialect).
--
--   pending  → approved   an operator approves after a native speaker of the
--                          Dialect accepted the sample (approved_by / approved_at)
--   approved → revoked    it leaves the picker and drafting at once
--                          (revoked_by / revoked_at)
--   pending  → revoked    a candidate that failed review
--   revoked  → approved   approved again after a new review; revoked_* then
--                          keeps the last revocation
--
-- Users choose among Approved Voices of one Dialect. They read the catalog only
-- through api-v2 (GET /v1/voices), which returns approved rows without the
-- review trail or provider ids, so there is no user SELECT policy: only the
-- service role reads or writes this table.
--
-- A Voice's identity (provider, provider voice id, Dialect) never changes: an
-- approval is for one Dialect, so a different Dialect is a different Voice.
-- short_drafts.voice_catalog_id records which Voice spoke each draft.

CREATE TABLE IF NOT EXISTS public.voices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider           text NOT NULL CHECK (provider IN ('elevenlabs')),
  provider_voice_id  text NOT NULL CHECK (provider_voice_id ~ '^[A-Za-z0-9_-]{10,80}$'),
  display_name       text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  -- Exactly one Dialect per Voice.
  dialect            text NOT NULL CHECK (dialect IN ('levantine','gulf','egyptian','maghrebi','msa')),
  gender             text NOT NULL CHECK (gender IN ('female','male','neutral')),
  -- Delivery style: a short lowercase tag (warm, energetic, calm, ...).
  style              text NOT NULL CHECK (style ~ '^[a-z][a-z0-9-]{0,39}$'),
  -- A playable sample; the browser loads it directly, so https only.
  sample_url         text NOT NULL CHECK (sample_url ~ '^https://'),
  state              text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','revoked')),
  added_by           uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  approved_by        uuid,
  approved_at        timestamptz,
  revoked_by         uuid,
  revoked_at         timestamptz,
  CONSTRAINT voices_provider_voice_unique UNIQUE (provider, provider_voice_id),
  -- The state always carries who put it there and when.
  CONSTRAINT voices_approved_recorded CHECK (state <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT voices_revoked_recorded  CHECK (state <> 'revoked'  OR (revoked_by  IS NOT NULL AND revoked_at  IS NOT NULL))
);

-- The picker's query: Approved Voices of one Dialect.
CREATE INDEX IF NOT EXISTS idx_voices_dialect_state ON public.voices (dialect, state);

-- Identity is immutable: approving a Voice for a Dialect must not carry over to
-- another voice or another Dialect by an edit.
CREATE OR REPLACE FUNCTION public.voices_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_voice_id IS DISTINCT FROM OLD.provider_voice_id
     OR NEW.dialect IS DISTINCT FROM OLD.dialect
     OR NEW.added_by IS DISTINCT FROM OLD.added_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'voices: a Voice''s provider, provider voice id and Dialect cannot change; add a new Voice instead';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_voices_guard ON public.voices;
CREATE TRIGGER trg_voices_guard
  BEFORE UPDATE ON public.voices
  FOR EACH ROW EXECUTE FUNCTION public.voices_guard();

-- RLS: service role only. Users go through api-v2, which serves approved rows.
ALTER TABLE public.voices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS voices_service_all ON public.voices;
CREATE POLICY voices_service_all ON public.voices FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Which catalog Voice spoke a draft. Nullable: drafts from before the catalog
-- were voiced by the single pre-configured voice. A Voice a draft used cannot be
-- deleted (revoke it instead). Adding the column does not trip the
-- short_drafts immutability guard, which only fires on UPDATE / DELETE.
ALTER TABLE public.short_drafts
  ADD COLUMN IF NOT EXISTS voice_catalog_id uuid REFERENCES public.voices(id);

CREATE INDEX IF NOT EXISTS idx_short_drafts_voice
  ON public.short_drafts (voice_catalog_id) WHERE voice_catalog_id IS NOT NULL;
