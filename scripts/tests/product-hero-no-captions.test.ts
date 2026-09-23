// The Product Hero confirm step no longer offers Captions (#22): #10's toggle is
// gone, the quote and run bodies never carry `captions`, and progress has no
// Captions step. Captions are added after the render, in the Caption editor
// (caption-editor.test.ts).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as flow from '../../apps/web/lib/product-hero-flow.ts';

const DRAFT = '11111111-1111-4111-8111-111111111111';
const PHOTO = 'https://media.example/vnext/uploads/u/photo.png';

describe('Product Hero render: no Captions choice', () => {
  it('the run and quote bodies carry no captions', () => {
    const choice = { draftId: DRAFT, photoUrl: PHOTO, music: true };
    assert.deepEqual(flow.renderBody(choice), { draft_id: DRAFT, product_image_url: PHOTO, music: true });
    assert.deepEqual(flow.quoteBody(choice), flow.renderBody(choice));
  });

  it('exports nothing about #10’s toggle', () => {
    for (const name of ['captionsLine', 'CAPTIONS_FALLBACK_LINE']) assert.equal(name in flow, false, name);
  });

  it('a quote that still says something about Captions is read without it', () => {
    const q = flow.parseQuote({ credits: 3, sufficient: true, captions: { on: true, detail: 'x' } })!;
    assert.equal('captions' in q, false);
  });

  it('progress has no Captions step (an unknown step is queued)', () => {
    assert.equal(flow.stageOf('captions').stage, 'queued');
    assert.equal(flow.stageOf('music_bed').stage, 'cut');
  });
});
