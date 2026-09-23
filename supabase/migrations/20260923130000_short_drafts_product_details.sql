-- Product Details on short drafts (#14, ADR 0002).
--
-- Product Details are the facts a Script sells (the product's name, description,
-- notes or ingredients, benefits), given separately from the Brief. They are
-- stored on the draft that was written from them and carried over to every
-- re-voice of it. NULL = none were given (every draft before #14, and drafts
-- written from a Brief alone). api-v2 bounds the length (3,000 characters).
--
-- Immutability needs no trigger change: short_drafts_guard (see
-- 20260923120000_short_drafts_render_claim.sql) compares the whole row, minus
-- the two render-claim columns, before and after an UPDATE, so a new column is
-- immutable content from the moment it exists. ADD COLUMN is DDL: the row guard
-- does not fire, and existing rows simply read NULL.

ALTER TABLE public.short_drafts ADD COLUMN IF NOT EXISTS product_details text;

COMMENT ON COLUMN public.short_drafts.product_details IS
  'The facts the Script sells (name, description, notes or ingredients, benefits); NULL when none were given. Immutable like the rest of the draft.';
