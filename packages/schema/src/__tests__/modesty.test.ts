// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Modesty Default (#17): every Preset that shows people or hands declares how
 * modest they are at the least; the user may choose another culturally
 * acceptable option, never a less modest one. Women get a hijab option, on by
 * default for Gulf.
 */

import { describe, it, expect } from 'vitest';
import {
  ModestyError,
  modestyChoiceSchema,
  presetShows,
  resolveModesty,
  type ModestyDefault,
} from '../modesty.js';
import type { PresetDefinition } from '../preset-definition.js';
import { PRESETS } from '../preset-registry.js';
import { PRODUCT_HERO } from '../product-hero.js';

const MODESTY: ModestyDefault = {
  arms: { default: 'covered', least: 'sleeved' },
  hijab: { gulf: 'on', levantine: 'off', egyptian: 'off', maghrebi: 'off', msa: 'off' },
};

/** Test-only: a person reacting, hands using the product, ending on the product. */
const PEOPLE: PresetDefinition<'person' | 'hands' | 'product'> = {
  id: 'test_people',
  name: 'Test People',
  aspectRatio: '9:16',
  minSpeechMs: 5_000,
  maxSpeechMs: 15_000,
  shotKinds: { person: { shows: 'person' }, hands: { shows: 'hands' }, product: { shows: 'product' } },
  shotPlan: { order: ['person', 'hands'], last: 'product' },
  requiredInputs: ['product_image'],
  musicBed: [],
  modesty: MODESTY,
  budget: { maxCredits: 420, maxProviderUsd: 1.8 },
};

/** Test-only: hands only, nobody's face or hair on screen. */
const HANDS: PresetDefinition<'hands' | 'product'> = {
  ...PEOPLE,
  id: 'test_hands',
  name: 'Test Hands',
  shotKinds: { hands: { shows: 'hands' }, product: { shows: 'product' } },
  shotPlan: { order: ['hands'], last: 'product' },
};

describe('presetShows', () => {
  it('reads what each shot kind shows from the definition', () => {
    expect(presetShows(PEOPLE, 'person')).toBe(true);
    expect(presetShows(PEOPLE, 'hands')).toBe(true);
    expect(presetShows(HANDS, 'person')).toBe(false);
    expect(presetShows(HANDS, 'hands')).toBe(true);
    expect(presetShows(PRODUCT_HERO, 'person')).toBe(false);
    expect(presetShows(PRODUCT_HERO, 'hands')).toBe(false);
  });
});

describe('resolveModesty — the defaults', () => {
  it('gives a Gulf woman a hijab and covered arms by default', () => {
    expect(resolveModesty(PEOPLE, { dialect: 'gulf', gender: 'female' })).toEqual({ arms: 'covered', hijab: true });
  });

  it('leaves the hijab off by default outside the Gulf, arms still covered', () => {
    expect(resolveModesty(PEOPLE, { dialect: 'levantine', gender: 'female' })).toEqual({ arms: 'covered', hijab: false });
  });

  it('never gives a man a hijab', () => {
    expect(resolveModesty(PEOPLE, { dialect: 'gulf', gender: 'male' })).toEqual({ arms: 'covered', hijab: false });
  });

  it('gives hands the arm default and no hijab (nobody’s hair is on screen)', () => {
    expect(resolveModesty(HANDS, { dialect: 'gulf', gender: 'female' })).toEqual({ arms: 'covered', hijab: false });
  });
});

describe('resolveModesty — the user’s choice', () => {
  it('accepts another acceptable option: sleeved arms, or a hijab outside the Gulf', () => {
    expect(resolveModesty(PEOPLE, { dialect: 'gulf', gender: 'female', choice: { arms: 'sleeved' } })).toEqual({
      arms: 'sleeved',
      hijab: true,
    });
    expect(resolveModesty(PEOPLE, { dialect: 'levantine', gender: 'female', choice: { hijab: true } })).toEqual({
      arms: 'covered',
      hijab: true,
    });
  });

  it('lets a Gulf woman go without the hijab where the Preset only defaults it on', () => {
    expect(resolveModesty(PEOPLE, { dialect: 'gulf', gender: 'female', choice: { hijab: false } }).hijab).toBe(false);
  });

  it('refuses arms less modest than the Preset allows', () => {
    const strict: PresetDefinition = { ...PEOPLE, modesty: { ...MODESTY, arms: { default: 'covered', least: 'covered' } } };
    expect(() => resolveModesty(strict, { dialect: 'levantine', gender: 'female', choice: { arms: 'sleeved' } })).toThrow(
      ModestyError,
    );
    try {
      resolveModesty(strict, { dialect: 'levantine', gender: 'female', choice: { arms: 'sleeved' } });
    } catch (err) {
      expect((err as ModestyError).code).toBe('LESS_MODEST_THAN_PRESET');
    }
  });

  it('refuses turning the hijab off where the Preset requires it', () => {
    const required: PresetDefinition = { ...PEOPLE, modesty: { ...MODESTY, hijab: { ...MODESTY.hijab, gulf: 'required' } } };
    expect(resolveModesty(required, { dialect: 'gulf', gender: 'female' }).hijab).toBe(true);
    expect(() => resolveModesty(required, { dialect: 'gulf', gender: 'female', choice: { hijab: false } })).toThrow(
      /less modest/,
    );
  });

  it('refuses a hijab for a man, or on a Preset that shows no person', () => {
    expect(() => resolveModesty(PEOPLE, { dialect: 'gulf', gender: 'male', choice: { hijab: true } })).toThrow(ModestyError);
    expect(() => resolveModesty(HANDS, { dialect: 'gulf', gender: 'female', choice: { hijab: true } })).toThrow(ModestyError);
    expect(() => resolveModesty(PRODUCT_HERO, { dialect: 'gulf', choice: { hijab: true } })).toThrow(ModestyError);
  });

  it('accepts hijab: false where there is no hijab to wear (nothing less modest)', () => {
    expect(resolveModesty(PEOPLE, { dialect: 'gulf', gender: 'male', choice: { hijab: false } }).hijab).toBe(false);
  });
});

describe('modestyChoiceSchema — the user-facing input', () => {
  it('accepts the acceptable options, all optional', () => {
    expect(modestyChoiceSchema.parse({})).toEqual({});
    expect(modestyChoiceSchema.parse({ arms: 'sleeved', hijab: true })).toEqual({ arms: 'sleeved', hijab: true });
  });

  it('rejects anything less modest than sleeved arms, and unknown keys', () => {
    expect(modestyChoiceSchema.safeParse({ arms: 'bare' }).success).toBe(false);
    expect(modestyChoiceSchema.safeParse({ arms: 'short_sleeves' }).success).toBe(false);
    expect(modestyChoiceSchema.safeParse({ neckline: 'low' }).success).toBe(false);
  });
});

describe('every registered Preset', () => {
  it.each(Object.values(PRESETS).map((p) => [p.id, p as PresetDefinition] as const))(
    '%s declares what every shot kind in its plan shows',
    (_id, preset) => {
      const planned = [...preset.shotPlan.order, ...(preset.shotPlan.last ? [preset.shotPlan.last] : [])];
      for (const kind of planned) expect(preset.shotKinds).toHaveProperty(kind);
    },
  );

  it('Product Hero shows only the product', () => {
    expect(Object.values(PRODUCT_HERO.shotKinds).map((k) => k.shows)).toEqual(['product', 'product']);
  });
});
