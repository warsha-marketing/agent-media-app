// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Preset × Music Bed (#9) — the API side of the one decision.
 *
 * The quote and the run both call presetMusicBed with the draft id as the
 * seed, so the quote names the track the render will mix (or says why the Short
 * is voice only), and the worker is handed that track — it never picks. The set
 * is the Preset's own (PresetDefinition.musicBed); the tracks and their licence
 * records are data in @agentmedia/schema (src/music-bed/).
 * Mixing is free: the Music Bed never changes the price.
 */

import { resolveMusicBed, type MusicBedDecision, type PresetDefinition } from '@agentmedia/schema';

/** What the quote and run responses say about the Music Bed. */
export interface MusicBedView {
  on: boolean;
  track_id: string | null;
  mood: string | null;
  /** Why there is no bed: the user turned it off, or no licensed track exists yet. */
  reason: 'off' | 'no_tracks' | null;
  /** One line the page and the agent can show as is. */
  detail: string;
}

export const MUSIC_BED_DETAIL = {
  on: 'A licensed Music Bed is mixed quietly under the voice.',
  off: 'No music: the Short is voice only, so you can add a sound in TikTok.',
  no_tracks: 'No licensed Music Bed is available for this Preset yet, so the Short is voice only. You can add a sound in TikTok.',
} as const;

/** `music` is the parsed input (default on); `draftId` seeds the track choice. */
export function presetMusicBed(preset: PresetDefinition, music: unknown, draftId: string): MusicBedDecision {
  return resolveMusicBed(preset, { music: music !== false, seed: draftId });
}

export function musicBedView(d: MusicBedDecision): MusicBedView {
  return d.on
    ? { on: true, track_id: d.track.id, mood: d.track.mood, reason: null, detail: MUSIC_BED_DETAIL.on }
    : { on: false, track_id: null, mood: null, reason: d.reason, detail: MUSIC_BED_DETAIL[d.reason] };
}

/** The workflow's `music_bed` input: the chosen track's id and private key, or null. */
export function musicBedWorkflowInput(d: MusicBedDecision): { track_id: string; storage_key: string } | null {
  return d.on ? { track_id: d.track.id, storage_key: d.track.storage_key } : null;
}
