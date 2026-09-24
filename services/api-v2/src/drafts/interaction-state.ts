// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The used-state rule for a written Product Interaction (#30, Playbooks in
 * #27): the action is simple and continuous, and the product is ALREADY in the
 * state it is used in when the shot starts (the perfume already uncapped, the
 * jar already open). Taking a cap, lid, wrapper or seal off on camera is what
 * video models break (a second cap appears, the cap stays on while spraying),
 * so a Product Interaction written from a Product Profile that changes the
 * product's state is sent back for one rewrite.
 *
 * Only generated Product Interactions are held to it: a user's own edit is
 * their call (it still goes through the Guardrails).
 */

import type { ProductProfile } from '@agentmedia/schema';

/** Verbs that change a product's state: taking a part off, opening, unwrapping. */
const STATE_CHANGE =
  /\b(?:remov(?:e|es|ing)|tak(?:e|es|ing) off|unscrew(?:s|ing)?|uncap(?:s|ping)?|twist(?:s|ing)? off|pull(?:s|ing)? off|pop(?:s|ping)? off|peel(?:s|ing)?|unwrap(?:s|ping)?|unseal(?:s|ing)?|tear(?:s|ing)? open|open(?:s|ing))\b/i;

export interface InteractionStateIssue {
  message: string;
  /** The words that matched. */
  matched: string;
}

/** Why `interaction` breaks the used-state rule of `profile`, or null when it keeps it. */
export function interactionStateIssue(interaction: string | null, profile: ProductProfile | null): InteractionStateIssue | null {
  if (!interaction || !profile) return null;
  const m = STATE_CHANGE.exec(interaction);
  if (!m) return null;
  return {
    matched: m[0],
    message:
      `The Product Interaction changes the product's state on camera ("${m[0]}"), but the product is already ${profile.used_state} when the shot starts. ` +
      'Describe one simple, continuous action with the product in that state, without removing or opening anything.',
  };
}
