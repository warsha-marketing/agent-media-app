import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultDialect,
  defaultPreset,
  dialectChoices,
  parsePresets,
  type PresetOption,
} from '../../apps/web/lib/preset-picker.ts';

/** GET /v1/presets as api-v2 answers a user today: Product Hero, Levantine only. */
const USER_BODY = {
  operator: false,
  presets: [
    {
      slug: 'product_hero',
      name: 'Product Hero',
      summary: 'Silent product shots cut to an Arabic voice-over.',
      skill: 'make_product_hero',
      dialects: [
        { dialect: 'levantine', name: 'Levantine', status: 'available' },
        { dialect: 'gulf', name: 'Gulf', status: 'coming_soon' },
        { dialect: 'egyptian', name: 'Egyptian', status: 'coming_soon' },
      ],
    },
  ],
};

const OPERATOR_BODY = {
  operator: true,
  presets: [
    {
      ...USER_BODY.presets[0],
      dialects: [
        { dialect: 'levantine', name: 'Levantine', status: 'available', sample: false },
        { dialect: 'gulf', name: 'Gulf', status: 'coming_soon', sample: true },
        { dialect: 'egyptian', name: 'Egyptian', status: 'coming_soon', sample: false },
      ],
    },
    { slug: 'hands_on', name: 'Hands-on', summary: '', skill: 'make_hands_on', dialects: [] },
  ],
};

const productHero = (body: unknown) => parsePresets(body)!.presets[0] as PresetOption;

describe('parsePresets', () => {
  it('reads the picker and whether the caller is an operator', () => {
    const p = parsePresets(USER_BODY)!;
    assert.equal(p.operator, false);
    assert.deepEqual(p.presets.map((x) => x.slug), ['product_hero']);
    assert.equal(p.presets[0].skill, 'make_product_hero');
    assert.deepEqual(p.presets[0].dialects.map((d) => d.status), ['available', 'coming_soon', 'coming_soon']);
  });

  it('refuses a body that is not a picker and drops malformed entries', () => {
    assert.equal(parsePresets(null), null);
    assert.equal(parsePresets({ error: { code: 'x' } }), null);
    const p = parsePresets({ presets: [{ slug: 'x' }, { ...USER_BODY.presets[0], dialects: [{ name: 'no id' }, { dialect: 'gulf', status: 'weird' }] }] })!;
    assert.equal(p.presets.length, 1);
    assert.deepEqual(p.presets[0].dialects, [{ dialect: 'gulf', name: 'gulf', status: 'coming_soon' }]);
  });
});

describe('dialectChoices', () => {
  it('users can pick only qualified Dialects; the rest are coming soon', () => {
    const choices = dialectChoices(productHero(USER_BODY), false);
    assert.deepEqual(
      choices.map((c) => [c.dialect, c.label, c.selectable]),
      [
        ['levantine', 'Levantine', true],
        ['gulf', 'Gulf (coming soon)', false],
        ['egyptian', 'Egyptian (coming soon)', false],
      ],
    );
  });

  it('operators can also pick a sampleable Dialect, marked as a reviewer sample', () => {
    const choices = dialectChoices(productHero(OPERATOR_BODY), true);
    assert.deepEqual(choices.find((c) => c.dialect === 'gulf'), {
      dialect: 'gulf', label: 'Gulf (coming soon · reviewer sample)', selectable: true, sample: true,
    });
    assert.equal(choices.find((c) => c.dialect === 'egyptian')!.selectable, false);
  });

  it('a `sample` flag is ignored for a caller who is not an operator', () => {
    assert.equal(dialectChoices(productHero(OPERATOR_BODY), false).find((c) => c.dialect === 'gulf')!.selectable, false);
  });
});

describe('defaultDialect', () => {
  it('keeps a still-selectable choice, else falls back to the first available Dialect', () => {
    const user = dialectChoices(productHero(USER_BODY), false);
    assert.equal(defaultDialect(user, 'levantine'), 'levantine');
    assert.equal(defaultDialect(user, 'gulf'), 'levantine'); // withdrawn or never qualified
    assert.equal(defaultDialect(user, null), 'levantine');
    const op = dialectChoices(productHero(OPERATOR_BODY), true);
    assert.equal(defaultDialect(op, 'gulf'), 'gulf');
    assert.equal(defaultDialect(op, null), 'levantine'); // an operator starts on a qualified one
  });

  it('is null when nothing can be drafted', () => {
    const none = dialectChoices({ ...productHero(USER_BODY), dialects: [{ dialect: 'gulf', name: 'Gulf', status: 'coming_soon' }] }, false);
    assert.equal(defaultDialect(none, null), null);
  });
});

describe('defaultPreset', () => {
  it('picks a Preset with a web flow, keeping the current one', () => {
    const op = parsePresets(OPERATOR_BODY)!;
    assert.equal(defaultPreset(op, null)!.slug, 'product_hero');
    assert.equal(defaultPreset(op, 'hands_on')!.slug, 'product_hero'); // listed, but no web flow yet
    assert.equal(defaultPreset(parsePresets({ presets: [] }), null), null);
  });
});
