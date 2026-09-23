// The Reaction web flow (#19): pick a saved character, their gender and (for a
// woman) the hijab option, on top of the Product Hero flow. The pick becomes
// part of the render request, so the quote prices what the run sends and a
// changed pick is a new confirmation (a new Idempotency-Key).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PERSON_GENDERS } from '../../packages/schema/src/modesty.ts';
import {
  CHARACTER_GENDERS,
  emptyReactionPick,
  hijabOffered,
  hijabShown,
  parseCharacters,
  reactionInputs,
  reactionReady,
  reactionRefusalLine,
  withGender,
  type ReactionPick,
} from '../../apps/web/lib/reaction-flow.ts';
import {
  classifyApiError,
  confirmationFor,
  quoteBody,
  renderBody,
  sameChoice,
  skillOf,
  type RenderChoice,
} from '../../apps/web/lib/product-hero-flow.ts';
import { WEB_FLOWS, defaultPreset, parsePresets } from '../../apps/web/lib/preset-picker.ts';

const DRAFT = '11111111-1111-4111-8111-111111111111';
const PHOTO = 'https://r2.example.test/u/bottle.png';
const LAYLA = '99999999-0000-4000-8000-000000000001';

const pick = (over: Partial<ReactionPick> = {}): ReactionPick => ({ characterId: LAYLA, gender: 'female', hijab: null, ...over });

describe('Reaction has a web flow', () => {
  it('is pickable in the Preset picker once listed', () => {
    assert.ok(WEB_FLOWS.has('reaction'));
    const picker = parsePresets({
      presets: [{ slug: 'reaction', name: 'Reaction', skill: 'make_reaction', dialects: [{ dialect: 'gulf', status: 'available' }] }],
    });
    assert.equal(defaultPreset(picker, 'reaction')!.slug, 'reaction');
  });
});

describe('saved characters', () => {
  it('offers the shared person genders (mirror of PERSON_GENDERS)', () => {
    assert.deepEqual([...CHARACTER_GENDERS], [...PERSON_GENDERS]);
  });

  it('reads GET /api/dashboard/characters, dropping malformed rows and non-https thumbnails', () => {
    const list = parseCharacters({
      characters: [
        { id: LAYLA, name: 'Layla', thumbnail_url: 'https://r2.example.test/layla.png' },
        { id: 'c2', name: '', thumbnail_url: null, character_sheet_url: 'https://r2.example.test/sheet.png' },
        { id: 'c3', name: 'Omar', thumbnail_url: 'javascript:alert(1)' },
        { name: 'no id' },
        null,
      ],
    });
    assert.deepEqual(list, [
      { id: LAYLA, name: 'Layla', thumbnailUrl: 'https://r2.example.test/layla.png' },
      { id: 'c2', name: 'Untitled character', thumbnailUrl: 'https://r2.example.test/sheet.png' },
      { id: 'c3', name: 'Omar', thumbnailUrl: null },
    ]);
    assert.equal(parseCharacters({ error: 'nope' }), null);
  });
});

describe('the hijab option', () => {
  it('is offered for a woman only', () => {
    assert.equal(hijabOffered('female'), true);
    assert.equal(hijabOffered('male'), false);
    assert.equal(hijabOffered(null), false);
  });

  /** The quote's preset_inputs for a woman, as make_reaction resolves them. */
  const quoted = (hijab: boolean, gender = 'female') => ({
    character_id: LAYLA,
    character_gender: gender,
    modesty: { arms: 'covered', hijab },
  });

  it('shows the server’s resolved default (the quote’s preset_inputs.modesty) until the user changes it', () => {
    assert.deepEqual(hijabShown(pick(), quoted(true)), { value: true, fromServer: true });
    assert.deepEqual(hijabShown(pick(), quoted(false)), { value: false, fromServer: true });
    assert.deepEqual(hijabShown(pick({ hijab: false }), quoted(true)), { value: false, fromServer: false });
    assert.deepEqual(hijabShown(pick({ hijab: true }), quoted(false)), { value: true, fromServer: false });
  });

  it('knows no default before a quote, or from a quote for another gender or without a hijab answer', () => {
    assert.deepEqual(hijabShown(pick(), null), { value: null, fromServer: false });
    assert.deepEqual(hijabShown(pick(), undefined), { value: null, fromServer: false });
    assert.deepEqual(hijabShown(pick(), quoted(true, 'male')), { value: null, fromServer: false });
    assert.deepEqual(hijabShown(pick(), { character_gender: 'female', modesty: { arms: 'covered' } }), { value: null, fromServer: false });
  });

  it('never shows a hijab for a man', () => {
    assert.deepEqual(hijabShown(pick({ gender: 'male', hijab: true }), quoted(true)), { value: false, fromServer: false });
  });

  it('keeps no Dialect table of its own: the server is the word on the default', async () => {
    const flow = await import('../../apps/web/lib/reaction-flow.ts');
    assert.equal('HIJAB_DEFAULT_ON' in flow, false);
    assert.equal('defaultHijab' in flow, false);
  });

  it('a switch to a man drops the hijab choice', () => {
    assert.deepEqual(withGender(pick({ hijab: true }), 'male'), pick({ gender: 'male', hijab: null }));
    assert.deepEqual(withGender(pick({ gender: 'male' }), 'female'), pick());
  });
});

describe('the make_reaction request', () => {
  it('needs a character and their gender before it can be priced', () => {
    assert.equal(reactionReady(emptyReactionPick), false);
    assert.equal(reactionReady(pick({ gender: null })), false);
    assert.equal(reactionInputs(pick({ characterId: null })), null);
    assert.equal(reactionReady(pick()), true);
  });

  it('sends the character and gender, and a hijab choice only when a woman’s was changed', () => {
    assert.deepEqual(reactionInputs(pick()), { character_id: LAYLA, character_gender: 'female' });
    assert.deepEqual(reactionInputs(pick({ hijab: false })), { character_id: LAYLA, character_gender: 'female', modesty: { hijab: false } });
    assert.deepEqual(reactionInputs(pick({ gender: 'male' })), { character_id: LAYLA, character_gender: 'male' });
  });

  it('quotes and runs make_reaction with the same body: the Product Hero fields plus the pick', () => {
    const choice: RenderChoice = { draftId: DRAFT, photoUrl: PHOTO, music: true, skill: 'make_reaction', presetInputs: reactionInputs(pick({ hijab: true })) };
    assert.equal(skillOf(choice), 'make_reaction');
    assert.deepEqual(renderBody(choice), {
      draft_id: DRAFT,
      product_image_url: PHOTO,
      music: true,
      character_id: LAYLA,
      character_gender: 'female',
      modesty: { hijab: true },
    });
    assert.deepEqual(quoteBody(choice), renderBody(choice));
  });

  it('Product Hero is unchanged: no skill means make_product_hero, no extra fields', () => {
    const hero: RenderChoice = { draftId: DRAFT, photoUrl: PHOTO, music: false };
    assert.equal(skillOf(hero), 'make_product_hero');
    assert.deepEqual(renderBody(hero), { draft_id: DRAFT, product_image_url: PHOTO, music: false });
  });

  it('a changed character, gender, hijab or Preset is a new confirmation with a new Idempotency-Key', () => {
    const base: RenderChoice = { draftId: DRAFT, photoUrl: PHOTO, music: true, skill: 'make_reaction', presetInputs: reactionInputs(pick()) };
    const first = confirmationFor(null, base, 'key-1');
    assert.equal(confirmationFor(first, { ...base, presetInputs: reactionInputs(pick()) }, 'key-2').key, 'key-1');
    for (const changed of [
      { ...base, presetInputs: reactionInputs(pick({ characterId: 'other' })) },
      { ...base, presetInputs: reactionInputs(pick({ gender: 'male' })) },
      { ...base, presetInputs: reactionInputs(pick({ hijab: false })) },
      { ...base, skill: 'make_product_hero', presetInputs: null },
    ]) {
      assert.equal(sameChoice(base, changed), false);
      assert.equal(confirmationFor(first, changed, 'key-2').key, 'key-2');
    }
  });
});

describe('make_reaction refusals', () => {
  it('says what to do about the character and the hijab in the page’s words', () => {
    for (const [status, code] of [[404, 'character_not_found'], [400, 'HIJAB_NOT_OFFERED'], [400, 'LESS_MODEST_THAN_PRESET']] as const) {
      const outcome = classifyApiError(status, { error: code, skill: 'make_reaction', detail: 'server words' });
      assert.equal(outcome.kind, 'error');
      assert.ok(reactionRefusalLine(code));
    }
    assert.equal(reactionRefusalLine('draft_not_found'), null);
  });
});
