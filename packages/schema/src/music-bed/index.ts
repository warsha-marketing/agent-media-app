// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Music Bed — a licensed track mixed under a Short's voice with fixed ducking.
 *
 * The set is data (./tracks.ts, licences in ./LICENSES.md). resolveMusicBed is
 * the ONE decision: api-v2 calls it for the quote and again for the render with
 * the same seed (the draft id), so both agree on whether there is a bed and
 * which track; the worker is handed the chosen track and never picks.
 *
 * Mixing is free (like the mux), so the Music Bed never changes the price.
 */

import { MUSIC_BED_TRACKS } from './tracks.js';
import type { MusicBedPreset, MusicBedTrack } from './types.js';

export type { MusicBedPreset, MusicBedTrack, MusicBedLicence } from './types.js';
export { MUSIC_BED_TRACKS } from './tracks.js';

/** Every track's audio lives in the PRIVATE bucket under this prefix. */
export const MUSIC_BED_STORAGE_PREFIX = 'music-bed/';

/**
 * Whether a Short gets a Music Bed, and which track.
 *   off       — the user turned it off (voice only; they may add a sound in TikTok)
 *   no_tracks — the Preset has no licensed tracks yet, so the Short is voice only
 */
export type MusicBedDecision =
  | { on: true; track: MusicBedTrack }
  | { on: false; reason: 'off' | 'no_tracks' };

/** The tracks one Preset may use. */
export function musicBedSet(preset: MusicBedPreset, tracks: readonly MusicBedTrack[] = MUSIC_BED_TRACKS): MusicBedTrack[] {
  return tracks.filter((t) => t.preset === preset);
}

/** FNV-1a 32-bit — a stable, dependency-free spread of seeds over the set. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Decide the Music Bed. `seed` is the draft id: the same draft always gets the
 * same track, so the quote names the track the render will use, and a retried
 * render sounds the same. An empty set never fails a Short — it is voice only.
 */
export function resolveMusicBed(
  args: { preset: MusicBedPreset; music: boolean; seed: string },
  tracks: readonly MusicBedTrack[] = MUSIC_BED_TRACKS,
): MusicBedDecision {
  if (!args.music) return { on: false, reason: 'off' };
  const set = musicBedSet(args.preset, tracks);
  if (set.length === 0) return { on: false, reason: 'no_tracks' };
  return { on: true, track: set[fnv1a(args.seed) % set.length] };
}

const TIKTOK = /tik\s*tok|douyin|bytedance/i;

/**
 * Everything wrong with a track set, one line per problem (empty = fine).
 * `licensesMd` is the text of ./LICENSES.md: every track needs its own entry
 * there (a `## <id>` heading). CI runs this over the shipped set.
 */
export function musicBedTrackProblems(tracks: readonly MusicBedTrack[], licensesMd: string): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const headings = new Set(
    licensesMd
      .replace(/<!--[\s\S]*?-->/g, '') // the template example is not a record
      .split('\n')
      .map((l) => /^##\s+(\S+)\s*$/.exec(l.trim())?.[1])
      .filter((x): x is string => Boolean(x)),
  );
  for (const t of tracks) {
    const id = t.id || '(no id)';
    if (seen.has(id)) problems.push(`${id}: duplicate track id`);
    seen.add(id);
    if (!t.mood?.trim()) problems.push(`${id}: no mood`);
    if (!t.source?.provider?.trim() || !t.source?.provider_ref?.trim()) problems.push(`${id}: no source (provider + provider_ref)`);
    const l = t.licence;
    if (!l?.ref?.trim() || !l.licensor?.trim() || !/^https:\/\//.test(l.terms_url ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(l.terms_checked_on ?? '') || !l.grant?.trim()) {
      problems.push(`${id}: incomplete licence record (ref, licensor, https terms_url, terms_checked_on YYYY-MM-DD, grant)`);
    }
    if (!t.storage_key?.startsWith(`${MUSIC_BED_STORAGE_PREFIX}${t.preset}/`)) {
      problems.push(`${id}: storage_key must be under ${MUSIC_BED_STORAGE_PREFIX}${t.preset}/`);
    }
    if (!Number.isFinite(t.duration_ms) || t.duration_ms <= 0) problems.push(`${id}: no duration_ms`);
    if (TIKTOK.test(`${t.source?.provider ?? ''} ${t.source?.provider_ref ?? ''} ${l?.licensor ?? ''} ${l?.terms_url ?? ''}`)) {
      problems.push(`${id}: TikTok sounds are licensed only inside the TikTok app and may never be a Music Bed`);
    }
    if (t.id && !headings.has(t.id)) problems.push(`${id}: no licence entry (## ${t.id}) in LICENSES.md`);
  }
  return problems;
}
