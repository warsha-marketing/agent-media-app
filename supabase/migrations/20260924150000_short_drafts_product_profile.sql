-- Product Profile on short drafts (#30).
--
-- A Product Profile is what the system understands about the product from its
-- photo and Product Details: category, real size (dimensions, size_class),
-- parts and the state it is in when used (used_state, differs_from_photo), how
-- it is used (interaction_verbs, grip), physics_risks for video, and a
-- confidence. Claude (vision) writes it at drafting time, before the Script;
-- the Product Interaction is written from it. The user may edit it, which
-- re-voices into a NEW draft exactly as a Script edit does. api-v2 validates
-- its shape (@agentmedia/schema ProductProfileSchema); the CHECK only backs up
-- that it is a JSON object. NULL = none (a draft made without a product photo,
-- and every draft before #30).
--
-- Immutability needs no trigger change: short_drafts_guard (see
-- 20260923120000_short_drafts_render_claim.sql) compares the whole row, minus
-- the two render-claim columns, before and after an UPDATE, so a new column is
-- immutable content from the moment it exists. ADD COLUMN is DDL: the row guard
-- does not fire, and existing rows simply read NULL.

ALTER TABLE public.short_drafts ADD COLUMN IF NOT EXISTS product_profile jsonb;

ALTER TABLE public.short_drafts DROP CONSTRAINT IF EXISTS short_drafts_product_profile_object;
ALTER TABLE public.short_drafts
  ADD CONSTRAINT short_drafts_product_profile_object
  CHECK (product_profile IS NULL OR jsonb_typeof(product_profile) = 'object');

COMMENT ON COLUMN public.short_drafts.product_profile IS
  'Product Profile: what the system understands about the product from its photo and Product Details (category, size, parts and used state, how it is used, grip, physics risks, confidence). NULL when there is none. Immutable like the rest of the draft.';
