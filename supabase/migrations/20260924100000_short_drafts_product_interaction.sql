-- Product Interaction on short drafts (#25).
--
-- A Product Interaction is how a real person uses the product, in English
-- (perfume: "removes the cap, sprays once on the inner wrist, brings the wrist
-- to the nose, smiles"). The Script writer returns it in the same structured
-- reply as the Script; the user may edit it, which re-voices into a NEW draft
-- exactly as a Script edit does. The render adds it to every hands and person
-- shot prompt, never to a product shot. NULL = none (every draft before #25).
-- api-v2 bounds the length (300 characters); the CHECK backs that up.
--
-- Immutability needs no trigger change: short_drafts_guard (see
-- 20260923120000_short_drafts_render_claim.sql) compares the whole row, minus
-- the two render-claim columns, before and after an UPDATE, so a new column is
-- immutable content from the moment it exists. ADD COLUMN is DDL: the row guard
-- does not fire, and existing rows simply read NULL.

ALTER TABLE public.short_drafts ADD COLUMN IF NOT EXISTS product_interaction text;

ALTER TABLE public.short_drafts DROP CONSTRAINT IF EXISTS short_drafts_product_interaction_length;
ALTER TABLE public.short_drafts
  ADD CONSTRAINT short_drafts_product_interaction_length
  CHECK (product_interaction IS NULL OR char_length(product_interaction) BETWEEN 1 AND 300);

COMMENT ON COLUMN public.short_drafts.product_interaction IS
  'How a real person uses the product, in English (Product Interaction); added to every hands and person shot prompt. NULL when there is none. Immutable like the rest of the draft.';
