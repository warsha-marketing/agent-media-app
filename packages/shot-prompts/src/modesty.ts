// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The Modesty Default's prompt wording (#17) — server-side, like the scenes it
 * is locked onto (the levels and rules are public, in @agentmedia/schema
 * modesty.ts).
 *
 * It is a Guardrail (./guardrails.ts): every shot whose kind shows a person or
 * hands carries it after its scene, and no other shot does; an edited scene
 * can never remove it. Pure data + pure functions: the workflow sandbox
 * imports this.
 */

import type { ArmCoverage, Modesty, ShotSubject } from '@agentmedia/schema';

export const MODESTY_PROMPTS = {
  hands: {
    covered: 'Modest styling: the arms are covered by long sleeves reaching the wrists; no bare forearms.',
    sleeved: 'Modest styling: the arms are in sleeves reaching at least the elbow; no bare upper arms or shoulders.',
  },
  person: {
    covered:
      'Modest styling: the person wears loose, modest clothing with long sleeves reaching the wrists and a high neckline; no bare arms or shoulders.',
    sleeved:
      'Modest styling: the person wears loose, modest clothing with sleeves reaching at least the elbow and a high neckline; no bare upper arms or shoulders.',
  },
  /** Only for a woman on screen (resolveModesty never sets it otherwise). */
  hijab: 'She wears a neat hijab that fully covers her hair, ears and neck, the same in every frame.',
} as const satisfies {
  hands: Record<ArmCoverage, string>;
  person: Record<ArmCoverage, string>;
  hijab: string;
};

/** The Modesty Default's words for one shot showing `subject`; empty for a product shot. */
export function modestyPrompt(subject: ShotSubject, modesty: Modesty): string {
  if (subject === 'hands') return MODESTY_PROMPTS.hands[modesty.arms];
  if (subject === 'person') {
    return modesty.hijab
      ? `${MODESTY_PROMPTS.person[modesty.arms]} ${MODESTY_PROMPTS.hijab}`
      : MODESTY_PROMPTS.person[modesty.arms];
  }
  return '';
}
