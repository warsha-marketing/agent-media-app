// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Music Bed — the per-Preset track set is data, and one small function decides
 * whether a Short gets a bed and which track. api-v2 decides (quote and render
 * from the same call) and hands the worker the chosen track; the worker never
 * picks.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MUSIC_BED_TRACKS,
  musicBedSet,
  resolveMusicBed,
  musicBedTrackProblems,
  MUSIC_BED_STORAGE_PREFIX,
  isMusicBedStorageKey,
  type MusicBedTrack,
} from '../music-bed/index.js';
import { PRODUCT_HERO } from '../product-hero.js';

function track(id: string, over: Partial<MusicBedTrack> = {}): MusicBedTrack {
  return {
    id,
    preset: 'product_hero',
    mood: 'luxurious',
    source: { kind: 'library', provider: 'Example Library', provider_ref: `ex-${id}` },
    licence: {
      ref: `LICENSES.md#${id}`,
      licensor: 'Example Library Ltd',
      terms_url: 'https://example.test/licence',
      terms_checked_on: '2026-09-23',
      grant: 'commercial use in paid social video ads, worldwide, perpetual',
    },
    storage_key: `${MUSIC_BED_STORAGE_PREFIX}product_hero/${id}.mp3`,
    duration_ms: 30_000,
    ...over,
  };
}

const LICENSES_MD = readFileSync(fileURLToPath(new URL('../music-bed/LICENSES.md', import.meta.url)), 'utf8');

describe('resolveMusicBed', () => {
  const set = [track('ph-a'), track('ph-b'), track('ph-c')];

  it('music off → no bed, whatever the set holds', () => {
    expect(resolveMusicBed({ musicBed: set }, { music: false, seed: 'draft-1' })).toEqual({ on: false, reason: 'off' });
  });

  it('music on with an empty set → no bed, and says the set is empty (never fails the Short)', () => {
    expect(resolveMusicBed({ musicBed: [] }, { music: true, seed: 'draft-1' })).toEqual({ on: false, reason: 'no_tracks' });
  });

  it('music on → a track from the Preset’s own set', () => {
    const d = resolveMusicBed({ musicBed: set }, { music: true, seed: 'draft-1' });
    expect(d.on).toBe(true);
    if (d.on) expect(set).toContain(d.track);
  });


  it('is deterministic per seed, so the quote and the render (and a retry) pick the same track', () => {
    for (const seed of ['a', 'draft-1', '7f3c0d4e-1111-4222-8333-444455556666']) {
      const a = resolveMusicBed({ musicBed: set }, { music: true, seed });
      const b = resolveMusicBed({ musicBed: set }, { music: true, seed });
      expect(a).toEqual(b);
    }
  });

  it('spreads seeds over the whole set', () => {
    const picked = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const d = resolveMusicBed({ musicBed: set }, { music: true, seed: `draft-${i}` });
      if (d.on) picked.add(d.track.id);
    }
    expect([...picked].sort()).toEqual(['ph-a', 'ph-b', 'ph-c']);
  });
});

describe('musicBedTrackProblems — what every track must declare', () => {
  it('accepts a complete track', () => {
    expect(musicBedTrackProblems([track('ph-a')], `## ph-a`)).toEqual([]);
  });

  it('refuses duplicate ids, a missing licence record, a key outside the private prefix, and TikTok as a source', () => {
    const bad = [
      track('dup'),
      track('dup'),
      track('nolic', { licence: { ...track('nolic').licence, ref: '' } }),
      track('pub', { storage_key: 'public/whatever.mp3' }),
      track('tt', { source: { kind: 'library', provider: 'TikTok Commercial Music Library', provider_ref: '123' } }),
      track('undocumented'),
    ];
    const problems = musicBedTrackProblems(bad, '## dup\n## nolic\n## pub\n## tt\n').join('\n');
    expect(problems).toMatch(/dup.*duplicate/);
    expect(problems).toMatch(/nolic.*licence/);
    expect(problems).toMatch(/pub.*storage_key/);
    expect(problems).toMatch(/tt.*TikTok/);
    expect(problems).toMatch(/undocumented.*LICENSES\.md/);
  });
});

describe('the shipped track set', () => {
  it('every shipped track is complete and has its licence entry in LICENSES.md', () => {
    expect(musicBedTrackProblems(MUSIC_BED_TRACKS, LICENSES_MD)).toEqual([]);
  });

  it('musicBedSet returns only that Preset’s tracks', () => {
    const mixed = [track('ph-a'), track('other-1', { preset: 'hands_on' })];
    expect(musicBedSet('product_hero', mixed).map((t) => t.id)).toEqual(['ph-a']);
    for (const t of musicBedSet('product_hero')) expect(t.preset).toBe('product_hero');
  });

  it('Product Hero declares its Music Bed set on its Preset definition', () => {
    expect(PRODUCT_HERO.musicBed).toEqual(musicBedSet('product_hero'));
  });

  it('LICENSES.md records the source terms with the date they were checked', () => {
    expect(LICENSES_MD).toMatch(/Checked on: 2026-09-23/);
    expect(LICENSES_MD).toMatch(/https:\/\/elevenlabs\.io\/eleven-music-model-specific-terms/);
  });
});

describe('isMusicBedStorageKey — a track key can only name an object under music-bed/', () => {
  it('accepts a plain key under the prefix', () => {
    expect(isMusicBedStorageKey('music-bed/product_hero/ph-a.mp3')).toBe(true);
    expect(isMusicBedStorageKey(`${MUSIC_BED_STORAGE_PREFIX}x.mp3`)).toBe(true);
  });

  it('refuses traversal, absolute paths and anything that normalises outside the prefix', () => {
    for (const key of [
      'music-bed/../vnext/drafts/u/d.mp3',
      'music-bed/product_hero/../../secrets.env',
      'music-bed/./x.mp3',
      'music-bed//x.mp3',
      'music-bed/',
      'music-bed',
      '/music-bed/x.mp3',
      '../music-bed/x.mp3',
      'music-bed\\..\\x.mp3',
      'music-bed/x/..',
      'vnext/drafts/u/d.mp3',
      'music-bed/x.mp3\u0000',
      '',
    ]) {
      expect(isMusicBedStorageKey(key), JSON.stringify(key)).toBe(false);
    }
    expect(isMusicBedStorageKey(undefined)).toBe(false);
    expect(isMusicBedStorageKey(42)).toBe(false);
  });

  it('a track whose storage_key escapes the prefix is a problem', () => {
    const problems = musicBedTrackProblems([track('esc', { storage_key: 'music-bed/product_hero/../../x.mp3' })], '## esc').join('\n');
    expect(problems).toMatch(/esc.*storage_key/);
  });
});
