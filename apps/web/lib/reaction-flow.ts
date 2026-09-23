// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The Reaction-specific half of the web Preset flow (#19), as pure functions so
 * it is testable without a browser (scripts/tests/reaction-flow.test.ts).
 *
 * Reaction reuses the Product Hero flow end to end (Dialect, photo, Brief,
 * Script review, quote, Confirm, render, Short). It adds only its own inputs:
 * which saved character reacts, their gender (saved characters do not record
 * it), and for a woman the hijab option. These become part of the render
 * request (RenderChoice.presetInputs), so the quote prices exactly what the run
 * sends and a change is a new confirmation with a new Idempotency-Key.
 *
 * No imports: scripts/tests loads this file directly.
 */

/** The Preset this file is for (GET /v1/presets slug). */
export const REACTION_PRESET = 'reaction';

/** A mirror of PERSON_GENDERS in @agentmedia/schema (held equal by the test). */
export const CHARACTER_GENDERS = ['female', 'male'] as const;
export type CharacterGender = (typeof CHARACTER_GENDERS)[number];

/** A saved character as the page lists it (GET /api/dashboard/characters). */
export interface SavedCharacter {
  /** The row id; make_reaction's character_id accepts it. */
  id: string;
  name: string;
  thumbnailUrl: string | null;
}

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const httpsUrl = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\//.test(v) ? v : null);

/** A 200 body of GET /api/dashboard/characters, or null. Malformed rows are dropped. */
export function parseCharacters(body: unknown): SavedCharacter[] | null {
  const list = (body as { characters?: unknown } | null)?.characters;
  if (!Array.isArray(list)) return null;
  const out: SavedCharacter[] = [];
  for (const raw of list as Array<Record<string, unknown>>) {
    if (!raw || !str(raw.id)) continue;
    out.push({
      id: raw.id,
      name: str(raw.name) ? raw.name : 'Untitled character',
      thumbnailUrl: httpsUrl(raw.thumbnail_url) ?? httpsUrl(raw.character_sheet_url),
    });
  }
  return out;
}

/**
 * What the user picked for a Reaction Short. `hijab` null = the Preset's default
 * for the draft's Dialect (the server resolves it; see hijabShown).
 */
export interface ReactionPick {
  characterId: string | null;
  gender: CharacterGender | null;
  hijab: boolean | null;
}

export const emptyReactionPick: ReactionPick = { characterId: null, gender: null, hijab: null };

/** The hijab is offered only for a woman on screen. */
export function hijabOffered(gender: CharacterGender | null): boolean {
  return gender === 'female';
}

/** Whether the hijab box shows ticked, and whether that is the server's default. */
export interface HijabView {
  /** null = no default known yet (no quote for this pick): the box shows unticked. */
  value: boolean | null;
  /** True when `value` is the server's resolved default, not the user's own choice. */
  fromServer: boolean;
}

/**
 * The hijab box: the user's choice wins; otherwise the Modesty Default the
 * server resolved for this pick (the quote's `preset_inputs.modesty.hijab`,
 * from the draft's Dialect), trusted only when that quote was for the same
 * gender. The page keeps no Dialect table of its own: the server is the word.
 */
export function hijabShown(pick: ReactionPick, presetInputs: Record<string, unknown> | null | undefined): HijabView {
  if (!hijabOffered(pick.gender)) return { value: false, fromServer: false };
  if (pick.hijab !== null) return { value: pick.hijab, fromServer: false };
  const q = presetInputs ?? {};
  const modesty = (q.modesty && typeof q.modesty === 'object' ? q.modesty : {}) as Record<string, unknown>;
  if (q.character_gender === pick.gender && typeof modesty.hijab === 'boolean') return { value: modesty.hijab, fromServer: true };
  return { value: null, fromServer: false };
}

/** A Reaction render can be priced once a character and their gender are picked. */
export function reactionReady(pick: ReactionPick): boolean {
  return !!pick.characterId && !!pick.gender;
}

/**
 * The make_reaction fields of the render request (beside draft, photo and
 * Music Bed), or null while the pick is incomplete. A hijab choice is sent only
 * for a woman, and only once the user changed it: otherwise the server applies
 * the Dialect's default.
 */
export function reactionInputs(pick: ReactionPick): Record<string, unknown> | null {
  if (!reactionReady(pick)) return null;
  return {
    character_id: pick.characterId,
    character_gender: pick.gender,
    ...(hijabOffered(pick.gender) && pick.hijab !== null ? { modesty: { hijab: pick.hijab } } : {}),
  };
}

/** A new gender drops a hijab choice that no longer applies. */
export function withGender(pick: ReactionPick, gender: CharacterGender): ReactionPick {
  return { ...pick, gender, hijab: hijabOffered(gender) ? pick.hijab : null };
}

/** What the page says for make_reaction's own refusals; null = show the server's message. */
export function reactionRefusalLine(code: string | null): string | null {
  switch (code) {
    case 'character_not_found':
      return 'That character is not on your account any more. Pick another saved character.';
    case 'HIJAB_NOT_OFFERED':
      return 'A hijab can only be chosen for a woman. Check the character’s gender.';
    case 'LESS_MODEST_THAN_PRESET':
      return 'That choice is less modest than this Preset allows.';
    default:
      return null;
  }
}
