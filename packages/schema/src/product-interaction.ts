// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Product Interaction (#25) — how a real person uses the product on camera, in
 * English, starting from the product's used state (perfume: "holds the uncapped
 * bottle, sprays once on the inner wrist, sets the bottle down, then raises the
 * wrist to the nose and smiles"). The ONE definition of its limit and of how
 * it is tidied: api-v2 stores it this way, the worker prompts with it this
 * way, the web field mirrors both (apps/web/lib/product-hero-flow.ts), and the
 * database CHECK (supabase/migrations/20260924100000_short_drafts_product_interaction.sql)
 * backs the limit up. Held equal by scripts/tests/delivery-tags-parity.test.ts.
 */

/** One short action sentence; room for a few steps, never a prompt. */
export const PRODUCT_INTERACTION_MAX_CHARS = 300;

/**
 * A Product Interaction as stored: whitespace collapsed, trimmed, within the
 * limit; null when there is none.
 */
export function tidyProductInteraction(text: string | null | undefined): string | null {
  const tidy = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, PRODUCT_INTERACTION_MAX_CHARS).trim();
  return tidy || null;
}
