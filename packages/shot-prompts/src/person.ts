// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * A person described in words (ADR 0003, #29) — for a shot whose video model
 * will not take the person's face as an image.
 *
 * ModelArk refuses a photoreal face as an input image ("input image may
 * contain real person") unless it is the same account's own Seedream output
 * passed on untouched (@agentmedia/schema modelTakesPersonImage). A saved
 * character's portrait is re-hosted by api-v2, so it is never that. A person
 * shot on ModelArk therefore sends the product reference alone and says who
 * the person is in text: the saved character's gender and description. The
 * Modesty Default (sleeves, the hijab) is its own Guardrail and goes with it.
 * A fallback model that takes the face (Kling, Veo) gets the face instead,
 * with the person_reference line.
 *
 * The description is the user's own text (user_characters.description), so it
 * is tidied, stripped of anything that reads as syntax, capped, and dropped
 * whole when it contradicts a Guardrail (speech, the hijab, bare skin,
 * undressing): the render then says only "a woman" / "a man" rather than
 * refusing a character that rendered before.
 *
 * Pure: the workflow sandbox imports this.
 */

import type { PersonGender } from '@agentmedia/schema';
import { guardrailIssue } from './guardrail-check.js';

/** Who is on screen, as the render input knows them. */
export interface PersonWords {
  gender?: PersonGender | null;
  /** The saved character's description, if it has one. */
  description?: string | null;
}

/** The longest description a prompt carries (cut at a word). */
export const PERSON_DESCRIPTION_MAX_CHARS = 240;

const GENDER_WORDS: Readonly<Record<PersonGender, string>> = { female: 'a woman', male: 'a man' };

/** The user's description as a prompt may carry it, or null when there is nothing usable. */
export function cleanPersonDescription(text: string | null | undefined): string | null {
  if (!text) return null;
  let t = text
    // Nothing that reads as prompt syntax: brackets, braces, @references, angle tags.
    .replace(/[[\]{}<>@#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?…;,:\s]+$/, '');
  if (!t) return null;
  if (guardrailIssue(t)) return null;
  if (t.length > PERSON_DESCRIPTION_MAX_CHARS) {
    const cut = t.slice(0, PERSON_DESCRIPTION_MAX_CHARS);
    const space = cut.lastIndexOf(' ');
    t = (space > 40 ? cut.slice(0, space) : cut).replace(/[.!?…;,:\s]+$/, '');
  }
  return t;
}

/**
 * The person_description Guardrail line, or null when there is nobody to
 * describe (no gender and no usable description).
 */
export function personDescriptionLine(person: PersonWords | null | undefined): string | null {
  if (!person) return null;
  const who = person.gender ? GENDER_WORDS[person.gender] : null;
  const desc = cleanPersonDescription(person.description);
  if (!who && !desc) return null;
  const base = `The person is ${who ?? 'an ordinary real person'}`;
  return desc ? `${base}: ${desc}. The same person in every shot.` : `${base}, an ordinary real person, the same in every shot.`;
}
