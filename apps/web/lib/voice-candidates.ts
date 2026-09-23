// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Which provider candidates on the operator Voice page (#7) are already in the
 * catalog. api-v2 marks each candidate (`catalog`) when the search runs, but
 * the page keeps that list while the operator works: a candidate added (or
 * approved, or revoked) afterwards kept its old mark, so "Use as candidate"
 * stayed on a Voice the catalog already had and adding it again got 409
 * VOICE_EXISTS. The mark is therefore also read from what the page knows now:
 * the catalog rows it has loaded, and the Voice an add just returned.
 *
 * No imports: scripts/tests loads this file directly.
 */

export type CatalogState = 'pending' | 'approved' | 'revoked';

/** A candidate's place in the catalog, as the page shows it. */
export interface CandidateCatalog {
  id: string;
  state: CatalogState;
  dialect: string;
}

/** The catalog fields the mark is read from (an operator Voice row). */
export interface CatalogVoice extends CandidateCatalog {
  provider_voice_id: string;
}

/**
 * The candidate's catalog entry: the loaded catalog row for its provider voice
 * id when there is one (it is newer than the search), else what the search said.
 */
export function catalogOf(
  candidate: { provider_voice_id: string; catalog: CandidateCatalog | null },
  voices: readonly CatalogVoice[] | null,
): CandidateCatalog | null {
  const row = voices?.find((v) => v.provider_voice_id === candidate.provider_voice_id);
  return row ? { id: row.id, state: row.state, dialect: row.dialect } : candidate.catalog;
}

/** The candidates with `voice` (just added) marked as in the catalog. */
export function withCatalogVoice<C extends { provider_voice_id: string; catalog: CandidateCatalog | null }>(
  candidates: readonly C[],
  voice: CatalogVoice,
): C[] {
  return candidates.map((c) =>
    c.provider_voice_id === voice.provider_voice_id ? { ...c, catalog: { id: voice.id, state: voice.state, dialect: voice.dialect } } : c,
  );
}
