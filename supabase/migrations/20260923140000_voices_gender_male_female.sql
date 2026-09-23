-- Copyright 2026 agent-media contributors. Apache-2.0 license.
--
-- Voice gender is male or female only: a gender-neutral voice is not
-- culturally acceptable for MENA ads (owner decision, 2026-09-23).
-- Fails loudly if a neutral Voice exists, so an operator decides what it is.

ALTER TABLE public.voices DROP CONSTRAINT IF EXISTS voices_gender_check;
ALTER TABLE public.voices
  ADD CONSTRAINT voices_gender_check CHECK (gender IN ('female', 'male'));
