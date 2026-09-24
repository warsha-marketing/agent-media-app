-- In-use Reference on short drafts (#31, owner decision: made at drafting time).
--
-- An In-use Reference is the product photo edited into the state the product
-- is used in (a perfume uncapped), product only: the product reference of
-- every hands and person shot. api-v2 makes it right after the Product Profile
-- when the Profile says the used state differs from the photo (free, like the
-- rest of drafting), stores the image in the public bucket and records it
-- here; a render reuses it and never makes or charges it again.
--
--   {"status":"made", "key", "url", "source_photo_key", "used_state",
--    "removed_parts", "model", "made_at"}   — the image and what it shows;
--   {"status":"failed", "source_photo_key", "reason", "failed_at"}
--                                            — the edit failed: the draft is
--                                              still made, flagged, and the
--                                              render uses the original photo.
--
-- api-v2 validates the shape (@agentmedia/schema DraftInUseReferenceSchema);
-- the CHECK backs up the status and that a made one names its image. NULL =
-- none was needed (the used state is the photo's, no Product Profile, and
-- every draft before this migration).
--
-- Immutability needs no trigger change: short_drafts_guard (see
-- 20260923120000_short_drafts_render_claim.sql) compares the whole row, minus
-- the two render-claim columns, before and after an UPDATE, so a new column is
-- immutable content from the moment it exists. ADD COLUMN is DDL: the row guard
-- does not fire, and existing rows simply read NULL.

ALTER TABLE public.short_drafts ADD COLUMN IF NOT EXISTS in_use_reference jsonb;

ALTER TABLE public.short_drafts DROP CONSTRAINT IF EXISTS short_drafts_in_use_reference_shape;
ALTER TABLE public.short_drafts
  ADD CONSTRAINT short_drafts_in_use_reference_shape
  -- COALESCE: a missing key reads NULL, and a CHECK that evaluates to NULL passes.
  CHECK (
    in_use_reference IS NULL
    OR COALESCE(
      jsonb_typeof(in_use_reference) = 'object'
      AND in_use_reference->>'status' IN ('made', 'failed')
      AND (
        in_use_reference->>'status' = 'failed'
        OR (jsonb_typeof(in_use_reference->'key') = 'string' AND jsonb_typeof(in_use_reference->'url') = 'string')
      ),
      false
    )
  );

COMMENT ON COLUMN public.short_drafts.in_use_reference IS
  'In-use Reference: the product photo edited into its used state (made at drafting when the Product Profile says it differs from the photo), by storage key and URL with what it shows; or status failed (the render then uses the original photo). NULL when none was needed. Immutable like the rest of the draft.';
