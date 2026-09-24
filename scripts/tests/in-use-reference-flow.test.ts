// In-use Reference on the web render flow (#31): the quote's view, the line
// next to the product photo, the "use original instead" request field, and the
// image a finished render made.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  inUseReferenceLine,
  inUseReferenceUrl,
  parseQuote,
  renderBody,
  sameChoice,
  viewOfRun,
} from '../../apps/web/lib/product-hero-flow.ts';

const DRAFT = '11111111-1111-4111-8111-111111111111';
const PHOTO = 'https://media.example/vnext/uploads/u/photo.png';
const choice = { draftId: DRAFT, photoUrl: PHOTO, music: true, skill: 'make_hands_on' };

describe('In-use Reference on the render page', () => {
  it('reads the quote’s in_use_reference', () => {
    const q = parseQuote({
      credits: 490,
      sufficient: true,
      in_use_reference: { made: true, use_original_product_photo: false, used_state: 'uncapped, spray neck visible', removed_parts: ['cap'], credits: 35 },
    })!;
    assert.deepEqual(q.inUseReference, { made: true, usedState: 'uncapped, spray neck visible', removedParts: ['cap'], credits: 35 });
    assert.equal(parseQuote({ credits: 1, sufficient: true, in_use_reference: null })!.inUseReference, undefined);
  });

  it('says what the hands and person shots will show, and the price', () => {
    const line = inUseReferenceLine({ made: true, usedState: 'uncapped, spray neck visible', removedParts: ['cap'], credits: 35 });
    assert.match(line, /uncapped, spray neck visible \(cap removed\)/);
    assert.match(line, /35 credits/);
    assert.match(inUseReferenceLine({ made: false, usedState: 'x', removedParts: [], credits: 0 }), /original photo/);
  });

  it('“use original instead” is part of the request, so it is a different choice', () => {
    assert.equal('use_original_product_photo' in renderBody(choice), false);
    assert.equal(renderBody({ ...choice, useOriginalPhoto: true }).use_original_product_photo, true);
    assert.equal(sameChoice(choice, { ...choice, useOriginalPhoto: true }), false);
    assert.equal(sameChoice(choice, { ...choice, useOriginalPhoto: false }), true);
  });

  it('shows the image the finished render made', () => {
    const run = {
      status: 'succeeded',
      final_output: { video_url: 'https://media.example/s.mp4', duration_ms: 9000, in_use_reference: { image_url: 'https://media.example/in-use.png' } },
    };
    const view = viewOfRun(run);
    assert.equal(view.kind === 'succeeded' && view.inUseReferenceUrl, 'https://media.example/in-use.png');
    assert.equal(inUseReferenceUrl({ in_use_reference: null }), null);
    assert.equal(inUseReferenceUrl({ in_use_reference: { image_url: 'javascript:alert(1)' } }), null);
  });

  it('names the step while it runs', () => {
    const view = viewOfRun({ status: 'running', current_step: 'in_use_reference' });
    assert.equal(view.kind === 'rendering' && view.label, 'Making the In-use Reference of your product');
  });
});
