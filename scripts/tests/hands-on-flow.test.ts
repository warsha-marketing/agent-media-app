// The Hands-on inputs in the web flow (#18): whose hands and the setting, shown
// from the server's pick (the quote's preset_inputs) until the user changes
// them; only what the user changed is sent, and a change is a new request (a
// new quote, a new Idempotency-Key). The rest of the flow is Product Hero's.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HAND_GENDERS,
  HANDS_ON_PRESET,
  HANDS_ON_SETTING_NAMES,
  HANDS_ON_SETTINGS,
  NO_HANDS_ON_CHOICE,
  handsOnInputs,
  handsOnView,
  modestyLine,
} from '../../apps/web/lib/hands-on-flow.ts';
import {
  confirmationFor,
  parseQuote,
  quoteBody,
  renderBody,
  renderReducer,
  sameChoice,
  skillOf,
  stageOf,
  viewOfRun,
  type RenderChoice,
  type RenderState,
} from '../../apps/web/lib/product-hero-flow.ts';
import { WEB_FLOWS } from '../../apps/web/lib/preset-picker.ts';
import * as schema from '../../packages/schema/src/presets/hands-on.ts';
import { PRESETS } from '../../packages/schema/src/preset-registry.ts';

const DRAFT = '11111111-1111-4111-8111-111111111111';
const PHOTO = 'https://media.example/vnext/uploads/u/photo.png';

/** A quote as api-v2 answers make_hands_on with nothing chosen: the server's pick. */
const QUOTE = {
  credits: 455,
  available: 1000,
  sufficient: true,
  preset_inputs: {
    hand_gender: 'female',
    setting: 'dressing_table',
    modesty: { arms: 'covered', hijab: false },
    source: { hand_gender: 'product_details', setting: 'product_details' },
  },
};

const handsOnChoice = (inputs: Record<string, string> = {}): RenderChoice => ({
  draftId: DRAFT,
  photoUrl: PHOTO,
  music: true,
  skill: 'make_hands_on',
  presetInputs: inputs,
});

describe('Hands-on in the web flow', () => {
  it('has a web flow, for the registry’s hands_on Preset', () => {
    assert.equal(HANDS_ON_PRESET, 'hands_on');
    assert.ok(WEB_FLOWS.has(HANDS_ON_PRESET));
    assert.ok(Object.hasOwn(PRESETS, HANDS_ON_PRESET));
  });

  it('offers exactly the schema’s hand genders and settings, with their names', () => {
    assert.deepEqual([...HAND_GENDERS], [...schema.HAND_GENDERS]);
    assert.deepEqual([...HANDS_ON_SETTINGS], [...schema.HANDS_ON_SETTINGS]);
    assert.deepEqual(HANDS_ON_SETTING_NAMES, schema.HANDS_ON_SETTING_NAMES);
  });
});

describe('what the Hands-on panel shows', () => {
  it('the server’s pick from the Product Details, until the user changes it', () => {
    const q = parseQuote(QUOTE)!;
    const v = handsOnView(NO_HANDS_ON_CHOICE, q.presetInputs);
    assert.deepEqual(v.handGender, { value: 'female', fromProductDetails: true });
    assert.deepEqual(v.setting, { value: 'dressing_table', fromProductDetails: true });
    assert.equal(v.arms, 'covered');
  });

  it('the user’s own choice wins, and is not labelled as picked', () => {
    const v = handsOnView({ handGender: 'male', setting: null }, parseQuote(QUOTE)!.presetInputs);
    assert.deepEqual(v.handGender, { value: 'male', fromProductDetails: false });
    assert.deepEqual(v.setting, { value: 'dressing_table', fromProductDetails: true });
  });

  it('nothing selected while no quote has said, and junk from the server is ignored', () => {
    assert.deepEqual(handsOnView(NO_HANDS_ON_CHOICE, null).setting, { value: null, fromProductDetails: false });
    const junk = handsOnView(NO_HANDS_ON_CHOICE, { hand_gender: 'neutral', setting: 'spaceship', modesty: { arms: 'bare' } });
    assert.equal(junk.handGender.value, null);
    assert.equal(junk.setting.value, null);
    assert.equal(junk.arms, null);
  });

  it('says the hands are modest', () => {
    assert.match(modestyLine('covered'), /covered by long sleeves/);
    assert.match(modestyLine('sleeved'), /elbow/);
    assert.match(modestyLine(null), /Modest by default/);
  });
});

describe('the Hands-on request', () => {
  it('sends only what the user changed; the server defaults the rest', () => {
    assert.deepEqual(handsOnInputs(NO_HANDS_ON_CHOICE), {});
    assert.deepEqual(handsOnInputs({ handGender: 'male', setting: null }), { hand_gender: 'male' });
    assert.deepEqual(handsOnInputs({ handGender: 'female', setting: 'car' }), { hand_gender: 'female', setting: 'car' });
  });

  it('is quoted and run on make_hands_on with the inputs as body fields, never captions', () => {
    const c = handsOnChoice({ hand_gender: 'male', setting: 'majlis' });
    assert.equal(skillOf(c), 'make_hands_on');
    assert.deepEqual(renderBody(c), { draft_id: DRAFT, product_image_url: PHOTO, music: true, hand_gender: 'male', setting: 'majlis' });
    assert.deepEqual(quoteBody(c), renderBody(c));
  });

  it('a Product Hero choice is unchanged: make_product_hero, no extra fields', () => {
    const c = { draftId: DRAFT, photoUrl: PHOTO, music: true };
    assert.equal(skillOf(c), 'make_product_hero');
    assert.deepEqual(renderBody(c), { draft_id: DRAFT, product_image_url: PHOTO, music: true });
  });

  it('a changed setting, hand gender or Preset is a new request with a new Idempotency-Key', () => {
    const first = confirmationFor(null, handsOnChoice({ setting: 'desk' }), 'key-1');
    assert.equal(confirmationFor(first, handsOnChoice({ setting: 'desk' }), 'key-2').key, 'key-1'); // same request: replay
    assert.equal(confirmationFor(first, handsOnChoice({ setting: 'car' }), 'key-3').key, 'key-3');
    assert.equal(confirmationFor(first, handsOnChoice({ setting: 'desk', hand_gender: 'male' }), 'key-4').key, 'key-4');
    assert.equal(confirmationFor(first, { ...handsOnChoice({ setting: 'desk' }), skill: 'make_product_hero' }, 'key-5').key, 'key-5');
    assert.equal(sameChoice(handsOnChoice({}), { draftId: DRAFT, photoUrl: PHOTO, music: true, skill: 'make_hands_on' }), true);
  });

  it('a Confirm sends the quoted request: the reducer keeps the choice it confirmed', () => {
    const quoted: RenderState = { render: { phase: 'quoted', quote: parseQuote(QUOTE)! }, confirmation: null };
    const next = renderReducer(quoted, { type: 'confirm', choice: handsOnChoice({ setting: 'kitchen' }), freshKey: 'k' });
    assert.equal(next.render.phase, 'starting');
    assert.deepEqual(next.confirmation?.choice.presetInputs, { setting: 'kitchen' });
  });
});

describe('Hands-on render progress', () => {
  it('shows the starting frames as part of the visuals', () => {
    assert.deepEqual(stageOf('frame_1'), { stage: 'visuals', shot: 1, frame: true });
    const v = viewOfRun({ status: 'running', current_step: 'frame_1' });
    assert.equal(v.kind, 'rendering');
    if (v.kind === 'rendering') assert.equal(v.label, 'Making the starting frame for shot 1');
    const clip = viewOfRun({ status: 'running', current_step: 'clip_2' });
    if (clip.kind === 'rendering') assert.equal(clip.label, 'Generating shot 2');
  });
});
