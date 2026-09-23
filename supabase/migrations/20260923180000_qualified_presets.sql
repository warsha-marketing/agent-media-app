-- Copyright 2026 agent-media contributors. Apache-2.0 license.
--
-- Qualified Presets (#8) — which Preset–Dialect pairs users are offered
-- (CONTEXT.md: Preset, Qualified Preset, Dialect).
--
--   (no row)  → qualified   an operator qualifies the pair after native speakers
--                           of the Dialect accepted its sample Shorts
--                           (qualified_by / qualified_at)
--   qualified → withdrawn   it stops being offered, drafted and rendered at once
--                           (withdrawn_by / withdrawn_at)
--   withdrawn → qualified   qualified again after a new review; withdrawn_*
--                           then keeps the last withdrawal
--
-- A completed render is never evidence of quality on its own: only an operator
-- qualifies a pair. A pair with no row was never reviewed and is "coming soon".
-- api-v2 reads this table on every draft, quote and run (presets/qualification.ts),
-- and serves the picker (GET /v1/presets), so there is no user SELECT policy:
-- only the service role reads or writes it.
--
-- A Preset is its stable slug ('product_hero'; Hands-on and Reaction later). The
-- slug is checked by shape, not by list, so a new Preset needs no migration here;
-- api-v2 accepts only the Presets it knows.

CREATE TABLE IF NOT EXISTS public.qualified_presets (
  preset        text NOT NULL CHECK (preset ~ '^[a-z][a-z0-9_]{1,39}$'),
  dialect       text NOT NULL CHECK (dialect IN ('levantine','gulf','egyptian','maghrebi','msa')),
  state         text NOT NULL CHECK (state IN ('qualified','withdrawn')),
  -- The operator who last qualified the pair. NULL only for a pair seeded by a
  -- migration, which has no operator id to record: its notes must then say who
  -- reviewed it and when (see the seed below).
  qualified_by  uuid,
  -- Every row was qualified at least once (withdrawing needs a qualified row).
  qualified_at  timestamptz NOT NULL,
  withdrawn_by  uuid,
  withdrawn_at  timestamptz,
  -- Who reviewed it and what they heard (reviewers, sample links), or why it was withdrawn.
  notes         text CHECK (notes IS NULL OR length(notes) BETWEEN 1 AND 1000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (preset, dialect),
  -- Who and when, always: a qualification names an operator or, for a seed, says who reviewed it.
  CONSTRAINT qualified_presets_qualified_recorded CHECK (qualified_by IS NOT NULL OR notes IS NOT NULL),
  CONSTRAINT qualified_presets_withdrawn_recorded CHECK (state <> 'withdrawn' OR (withdrawn_by IS NOT NULL AND withdrawn_at IS NOT NULL))
);

-- A pair's identity never changes: a qualification is for one Preset in one
-- Dialect, so it must not carry over to another by an edit. Stamps updated_at.
CREATE OR REPLACE FUNCTION public.qualified_presets_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.preset IS DISTINCT FROM OLD.preset
     OR NEW.dialect IS DISTINCT FROM OLD.dialect
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'qualified_presets: a qualification''s Preset and Dialect cannot change; qualify the other pair instead';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qualified_presets_guard ON public.qualified_presets;
CREATE TRIGGER trg_qualified_presets_guard
  BEFORE UPDATE ON public.qualified_presets
  FOR EACH ROW EXECUTE FUNCTION public.qualified_presets_guard();

-- RLS: service role only. Users go through api-v2.
ALTER TABLE public.qualified_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qualified_presets_service_all ON public.qualified_presets;
CREATE POLICY qualified_presets_service_all ON public.qualified_presets FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed: Product Hero × Levantine passed a live native review by the owner on
-- 2026-09-23 (the first live Product Hero render), which is why it launches
-- qualified. There is no operator user id to put in qualified_by from a
-- migration, so it stays NULL and the notes carry who reviewed it. Gulf is NOT
-- seeded: it is offered only once an operator qualifies it after native review.
INSERT INTO public.qualified_presets (preset, dialect, state, qualified_by, qualified_at, notes)
VALUES (
  'product_hero',
  'levantine',
  'qualified',
  NULL,
  '2026-09-23T00:00:00Z',
  'seed: owner live native review 2026-09-23 (first live Product Hero render, Levantine)'
)
ON CONFLICT (preset, dialect) DO NOTHING;
