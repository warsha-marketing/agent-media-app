// Copyright 2026 agent-media contributors. Apache-2.0 license.

/** The id of the Preset a track belongs to (PresetDefinition.id, e.g. 'product_hero'). */
export type MusicBedPreset = string;

/** The licence record every track carries (the full entry lives in ./LICENSES.md). */
export interface MusicBedLicence {
  /** Where the full licence record is: `LICENSES.md#<track id>`. */
  ref: string;
  /** Who grants the licence (legal entity). */
  licensor: string;
  /** The terms the grant rests on. */
  terms_url: string;
  /** When those terms were read and confirmed (YYYY-MM-DD). */
  terms_checked_on: string;
  /** One line: what the licence lets us do with the track. */
  grant: string;
}

export interface MusicBedTrack {
  /** Stable id; also the anchor of its LICENSES.md entry. */
  id: string;
  preset: MusicBedPreset;
  /** The Preset mood it was chosen or generated for (e.g. luxurious, upbeat). */
  mood: string;
  source: {
    /** Generated once by an operator, or picked from a licensed library. */
    kind: 'generated' | 'library';
    provider: string;
    /** The track's id / generation id at the source. */
    provider_ref: string;
  };
  licence: MusicBedLicence;
  /** Private-bucket key of the audio (under MUSIC_BED_STORAGE_PREFIX). */
  storage_key: string;
  duration_ms: number;
}
