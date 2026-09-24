// The web Product Profile fields (#30): the key fields of a draft's Product
// Profile (category, size, used state, how it is used) as the page edits them,
// and the re-voice body an edit sends. The lists mirror @agentmedia/schema
// (held equal in delivery-tags-parity.test.ts).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyProfileFields,
  isProfileEdited,
  profileEdit,
  profileFieldsOf,
  sizeLabel,
  type ProductProfile,
} from '../../apps/web/lib/product-profile-flow.ts';

const PERFUME: ProductProfile = {
  category: 'fragrance_oud',
  dimensions: { height_cm: 11, width_cm: 5, volume_ml: 100 },
  size_class: 'palm',
  parts: [{ name: 'cap', removable: true }, { name: 'bottle', removable: false }],
  used_state: 'uncapped, spray neck visible',
  differs_from_photo: true,
  interaction_verbs: ['spray', 'smell'],
  grip: 'one hand around the bottle',
  physics_risks: ['separate_cap', 'small_text'],
  confidence: 0.86,
};

describe('Product Profile fields', () => {
  it('shows category, size, used state and how it is used', () => {
    assert.deepEqual(profileFieldsOf(PERFUME), {
      category: 'fragrance_oud',
      size_class: 'palm',
      used_state: 'uncapped, spray neck visible',
      how_used: 'spray, smell',
    });
    assert.equal(profileFieldsOf(null), null);
  });

  it('says the size with the real dimensions when known', () => {
    assert.equal(sizeLabel(PERFUME), 'Fits in a palm · 11 cm tall · 100 ml');
    assert.equal(sizeLabel({ ...PERFUME, dimensions: { height_cm: null, width_cm: null, volume_ml: null } }), 'Fits in a palm');
  });

  it('an edit changes only the edited fields, keeping the rest of the Profile', () => {
    const next = applyProfileFields(PERFUME, { category: 'other', size_class: 'hand', used_state: '  uncapped,\n held ', how_used: 'Spray, spray,  smell , ' });
    assert.deepEqual(next, {
      ...PERFUME,
      category: 'other',
      size_class: 'hand',
      used_state: 'uncapped, held',
      interaction_verbs: ['spray', 'smell'],
    });
  });

  it('knows when what is on screen differs from the draft', () => {
    assert.equal(isProfileEdited(PERFUME, profileFieldsOf(PERFUME)), false);
    assert.equal(isProfileEdited(PERFUME, { ...profileFieldsOf(PERFUME)!, how_used: 'spray,smell' }), false);
    assert.equal(isProfileEdited(PERFUME, { ...profileFieldsOf(PERFUME)!, size_class: 'hand' }), true);
    assert.equal(isProfileEdited(null, null), false);
  });

  it('a re-voice sends the edited Profile only when it changed', () => {
    assert.deepEqual(profileEdit(PERFUME, profileFieldsOf(PERFUME)), {});
    assert.deepEqual(profileEdit(null, null), {});
    const edit = profileEdit(PERFUME, { ...profileFieldsOf(PERFUME)!, used_state: 'uncapped' });
    assert.deepEqual(edit, { product_profile: { ...PERFUME, used_state: 'uncapped' } });
  });

  it('an emptied field is not an edit the server would refuse: the draft keeps its value', () => {
    const next = applyProfileFields(PERFUME, { ...profileFieldsOf(PERFUME)!, used_state: '   ', how_used: ' , ' });
    assert.equal(next.used_state, PERFUME.used_state);
    assert.deepEqual(next.interaction_verbs, PERFUME.interaction_verbs);
  });
});
