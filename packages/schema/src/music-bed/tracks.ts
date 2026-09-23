// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The Music Bed track set — DATA, not code. One entry per licensed track; the
 * Preset's set is every entry with that `preset`. Adding or removing a track is
 * an edit to this list (plus its licence entry in ./LICENSES.md and the audio
 * uploaded to the private bucket at `storage_key`); no pipeline code changes.
 *
 * Every entry must carry its source, licence record and mood — enforced by
 * musicBedTrackProblems in CI (src/__tests__/music-bed.test.ts).
 *
 * EMPTY ON PURPOSE (2026-09-23): the preferred source (ElevenLabs Eleven Music)
 * is not cleared for our use on a self-serve plan — see ./LICENSES.md. Until a
 * licensed source is confirmed and tracks are added, a Short with the Music Bed
 * on is rendered voice only, and the quote and the web page say so
 * (reason `no_tracks`).
 *
 * NEVER add a TikTok sound here, in any form: TikTok licenses those only inside
 * its app. Operators may use TikTok Creative Center only as a style reference
 * when choosing a Preset's mood.
 */

import type { MusicBedTrack } from './types.js';

export const MUSIC_BED_TRACKS: readonly MusicBedTrack[] = [
  // Example shape (do not uncomment without a real licence entry in LICENSES.md):
  // {
  //   id: 'ph-luxurious-01',
  //   preset: 'product_hero',
  //   mood: 'luxurious',
  //   source: { kind: 'library', provider: '<library name>', provider_ref: '<track id at the source>' },
  //   licence: {
  //     ref: 'LICENSES.md#ph-luxurious-01',
  //     licensor: '<legal entity>',
  //     terms_url: 'https://…',
  //     terms_checked_on: 'YYYY-MM-DD',
  //     grant: 'commercial use in exported paid social video ads, worldwide, perpetual',
  //   },
  //   storage_key: 'music-bed/product_hero/ph-luxurious-01.mp3',
  //   duration_ms: 30000,
  // },
];
