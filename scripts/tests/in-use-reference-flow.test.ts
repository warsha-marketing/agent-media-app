// In-use Reference on the web render flow (#31): made when drafting, it is on
// the draft (shown next to the product photo BEFORE the user confirms), with
// "Use original photo instead" always offered; the override is part of the
// render request (it never changes the price); a draft whose edit failed says
// so and renders from the photo; a finished Short names the image it used.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  inUseReferenceLine,
  inUseReferenceUrl,
  parseDraftInUseReference,
  renderBody,
  sameChoice,
  viewOfRun,
} from '../../apps/web/lib/product-hero-flow.ts';

const DRAFT = '11111111-1111-4111-8111-111111111111';
const PHOTO = 'https://media.example/vnext/uploads/u/photo.png';
const IN_USE = 'https://media.example/vnext/in-use/u/d.png';
const choice = { draftId: DRAFT, photoUrl: PHOTO, music: true, skill: 'make_hands_on' };

describe('In-use Reference on the render page', () => {
  it('reads the draft’s in_use_reference: made, failed, or none', () => {
    assert.deepEqual(
      parseDraftInUseReference({ status: 'made', image_url: IN_USE, used_state: 'uncapped, spray neck visible', removed_parts: ['cap'] }),
      { status: 'made', imageUrl: IN_USE, usedState: 'uncapped, spray neck visible', removedParts: ['cap'] },
    );
    assert.deepEqual(parseDraftInUseReference({ status: 'failed', message: 'We could not make it.' }), { status: 'failed', message: 'We could not make it.' });
    assert.equal(parseDraftInUseReference(null), null);
    assert.equal(parseDraftInUseReference({ status: 'made', image_url: 'javascript:alert(1)', used_state: 'x', removed_parts: [] }), null);
  });

  it('says what the hands and person shots will show — never a price (it was made free when drafting)', () => {
    const made = { status: 'made' as const, imageUrl: IN_USE, usedState: 'uncapped, spray neck visible', removedParts: ['cap'] };
    const line = inUseReferenceLine(made, false);
    assert.match(line, /uncapped, spray neck visible \(cap removed\)/);
    assert.doesNotMatch(line, /credit/);
    assert.match(inUseReferenceLine(made, true), /original photo/);
    assert.equal(inUseReferenceLine({ status: 'failed', message: 'We could not make it.' }, false), 'We could not make it.');
  });

  it('“use original instead” is part of the request, so it is a different choice', () => {
    assert.equal('use_original_product_photo' in renderBody(choice), false);
    assert.equal(renderBody({ ...choice, useOriginalPhoto: true }).use_original_product_photo, true);
    assert.equal(sameChoice(choice, { ...choice, useOriginalPhoto: true }), false);
    assert.equal(sameChoice(choice, { ...choice, useOriginalPhoto: false }), true);
  });

  it('shows the image the finished render used', () => {
    const run = {
      status: 'succeeded',
      final_output: { video_url: 'https://media.example/s.mp4', duration_ms: 9000, in_use_reference: { image_url: IN_USE } },
    };
    const view = viewOfRun(run);
    assert.equal(view.kind === 'succeeded' && view.inUseReferenceUrl, IN_USE);
    assert.equal(inUseReferenceUrl({ in_use_reference: null }), null);
    assert.equal(inUseReferenceUrl({ in_use_reference: { image_url: 'javascript:alert(1)' } }), null);
  });
});
