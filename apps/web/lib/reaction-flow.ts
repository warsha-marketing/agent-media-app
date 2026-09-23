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

export type CharacterGender = 'female' | 'male';

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
 * for the Dialect (the server resolves it; see defaultHijab).
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

/**
 * Whether a woman wears a hijab unless the user changes it, per Dialect: on for
 * Gulf, off elsewhere. A mirror of STANDARD_MODESTY.hijab in @agentmedia/schema
 * (this file takes no imports), held equal by scripts/tests/reaction-flow.test.ts.
 * The server's quote (`modesty`) is the word on what renders.
 */
export const HIJAB_DEFAULT_ON: ReadonlySet<string> = new Set(['gulf']);

export function defaultHijab(dialect: string | null): boolean {
  return !!dialect && HIJAB_DEFAULT_ON.has(dialect);
}

/** Whether the hijab box shows ticked: the user's choice, else the Dialect's default. */
export function hijabShown(pick: ReactionPick, dialect: string | null): boolean {
  if (!hijabOffered(pick.gender)) return false;
  return pick.hijab ?? defaultHijab(dialect);
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
