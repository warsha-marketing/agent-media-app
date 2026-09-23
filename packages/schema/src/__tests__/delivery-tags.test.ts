// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Delivery Tags (ADR 0002): the allowed list, spotting unknown tags, and the
 * strip helpers Captions (#10) use on a Script and on its TTS alignment.
 */

import { describe, it, expect } from 'vitest';
import {
  DELIVERY_TAGS,
  formatDeliveryTags,
  isDeliveryTag,
  modelHonoursDeliveryTags,
  stripDeliveryTags,
  stripDeliveryTagsFromAlignment,
  unknownDeliveryTagMessage,
  unknownDeliveryTags,
  type CharacterAlignment,
} from '../delivery-tags.js';

/** The Script from the first live Product Hero render (RUMI Royal Rituals, Levantine). */
const LIVE_SCRIPT =
  '[confidently] رومي رويال ريتشوالز، فريش وراقية. [softly] برغموت، فلفل زهري، جِلد ومِسك. [warmly] بتضلّ معك للسهرة. [excited] جرّبها.';

/** One entry per character, 50 ms each — the shape ElevenLabs returns. */
function alignmentOf(text: string): CharacterAlignment {
  const chars = [...text];
  return {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => i * 0.05),
    character_end_times_seconds: chars.map((_, i) => (i + 1) * 0.05),
  };
}

describe('the allowed Delivery Tags', () => {
  it('include the tags the live test used and nothing invented', () => {
    for (const t of ['confidently', 'softly', 'warmly', 'excited', 'whispers']) expect(DELIVERY_TAGS).toContain(t);
    expect(isDeliveryTag('wisper')).toBe(false);
    expect(isDeliveryTag(' Softly ')).toBe(true);
  });

  it('are honoured only by eleven_v3', () => {
    expect(modelHonoursDeliveryTags('eleven_v3')).toBe(true);
    expect(modelHonoursDeliveryTags('eleven_multilingual_v2')).toBe(false);
  });

  it('finds unknown bracketed tags as written, and none in the live Script', () => {
    expect(unknownDeliveryTags(LIVE_SCRIPT)).toEqual([]);
    expect(unknownDeliveryTags('[wisper] مرحبا [softly] كيفك [shouts]')).toEqual(['[wisper]', '[shouts]']);
  });

  it('formats tags one way everywhere (prompt, errors, OpenAPI, editor)', () => {
    expect(formatDeliveryTags(['softly', 'warmly'])).toBe('[softly], [warmly]');
    expect(formatDeliveryTags()).toBe(DELIVERY_TAGS.map((t) => `[${t}]`).join(', '));
  });

  it('says why an unknown tag is refused, in one sentence for one or many', () => {
    expect(unknownDeliveryTagMessage(['[wisper]'])).toBe('[wisper] is not a Delivery Tag; it would be spoken aloud.');
    expect(unknownDeliveryTagMessage(['[wisper]', '[shouts]'])).toBe('[wisper], [shouts] are not Delivery Tags; they would be spoken aloud.');
  });
});

describe('stripDeliveryTags', () => {
  it('turns the live Script into what viewers read', () => {
    expect(stripDeliveryTags(LIVE_SCRIPT)).toBe('رومي رويال ريتشوالز، فريش وراقية. برغموت، فلفل زهري، جِلد ومِسك. بتضلّ معك للسهرة. جرّبها.');
  });

  it('drops the space with the tag, wherever the tag sits', () => {
    expect(stripDeliveryTags('[softly] أ ب')).toBe('أ ب');
    expect(stripDeliveryTags('أ [softly] ب')).toBe('أ ب');
    expect(stripDeliveryTags('أ ب. [laughs]')).toBe('أ ب.');
    expect(stripDeliveryTags('أ [softly][warmly] ب')).toBe('أ ب');
    expect(stripDeliveryTags('بلا وسوم')).toBe('بلا وسوم');
  });
});

describe('stripDeliveryTagsFromAlignment', () => {
  it('drops the tag characters and keeps every remaining timing', () => {
    const a = alignmentOf(LIVE_SCRIPT);
    const s = stripDeliveryTagsFromAlignment(a);
    expect(s.characters.join('')).toBe(stripDeliveryTags(LIVE_SCRIPT));
    expect(s.characters.join('')).not.toMatch(/[[\]]/);
    expect(s.character_start_times_seconds).toHaveLength(s.characters.length);
    expect(s.character_end_times_seconds).toHaveLength(s.characters.length);
    // The first spoken letter keeps the time it was spoken at, after "[confidently] ".
    const first = '[confidently] '.length;
    expect(s.characters[0]).toBe('ر');
    expect(s.character_start_times_seconds[0]).toBeCloseTo(first * 0.05);
    // The last character (the final full stop) is unchanged.
    expect(s.character_end_times_seconds.at(-1)).toBe(a.character_end_times_seconds.at(-1));
  });

  it('matches the text strip for tags at the start, middle and end', () => {
    for (const text of ['[softly] أ ب', 'أ [softly] ب', 'أ ب. [laughs]', 'بلا وسوم']) {
      expect(stripDeliveryTagsFromAlignment(alignmentOf(text)).characters.join('')).toBe(stripDeliveryTags(text));
    }
  });

  it('works when an alignment entry holds more than one code unit', () => {
    const a: CharacterAlignment = {
      characters: ['[', 'softly', ']', ' ', 'أ', 'ب'],
      character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
      character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    };
    expect(stripDeliveryTagsFromAlignment(a)).toEqual({
      characters: ['أ', 'ب'],
      character_start_times_seconds: [0.4, 0.5],
      character_end_times_seconds: [0.5, 0.6],
    });
  });
});
