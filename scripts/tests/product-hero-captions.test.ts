// Arabic Captions on the web Product Hero flow (#10): the toggle on the
// confirm step (off by default), the request bodies, the confirmation key a
// toggle retires, what the quote says, and progress while they are burned.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTIONS_OFF_LINE,
  captionsLine,
  confirmationFor,
  initialRenderState,
  parseQuote,
  quoteBody,
  renderBody,
  renderReducer,
  viewOfRun,
  type RenderState,
} from '../../apps/web/lib/product-hero-flow.ts';

const DRAFT = '11111111-1111-4111-8111-111111111111';
const PHOTO = 'https://media.example/vnext/uploads/u/photo.png';

describe('Captions on the Product Hero page', () => {
  it('are off unless turned on: the bodies carry captions only when on (the server default is off)', () => {
    assert.deepEqual(renderBody(DRAFT, PHOTO, true), { draft_id: DRAFT, product_image_url: PHOTO, music: true });
    assert.deepEqual(renderBody(DRAFT, PHOTO, true, true), { draft_id: DRAFT, product_image_url: PHOTO, music: true, captions: true });
    assert.deepEqual(quoteBody(DRAFT, PHOTO, false, true), renderBody(DRAFT, PHOTO, false, true));
  });

  it('toggling Captions makes the next Confirm a new confirmation with a new key', () => {
    const prev = { draftId: DRAFT, photoUrl: PHOTO, music: true, captions: false, key: 'k1' };
    assert.equal(confirmationFor(prev, { draftId: DRAFT, photoUrl: PHOTO, music: true, captions: true }, 'k2').key, 'k2');
    assert.equal(confirmationFor(prev, { draftId: DRAFT, photoUrl: PHOTO, music: true, captions: false }, 'k2').key, 'k1');
    // A confirmation from before the toggle existed counts as Captions off.
    const legacy = { draftId: DRAFT, photoUrl: PHOTO, music: true, key: 'k0' };
    assert.equal(confirmationFor(legacy, { draftId: DRAFT, photoUrl: PHOTO, music: true, captions: false }, 'k2').key, 'k0');
  });

  it('the reducer carries the Captions choice into the confirmation it starts', () => {
    const quoted: RenderState = { ...initialRenderState, render: { phase: 'quoted', quote: { credits: 1, available: null, sufficient: true } } };
    const s = renderReducer(quoted, { type: 'confirm', draftId: DRAFT, photoUrl: PHOTO, music: true, captions: true, freshKey: 'k1' });
    assert.equal(s.render.phase, 'starting');
    assert.deepEqual(s.confirmation, { draftId: DRAFT, photoUrl: PHOTO, music: true, captions: true, key: 'k1' });
  });

  it('reads the quote’s Captions and shows the server’s line for this setting', () => {
    const on = parseQuote({ credits: 280, sufficient: true, captions: { on: true, detail: 'Server: Captions on.' } })!;
    assert.deepEqual(on.captions, { on: true, detail: 'Server: Captions on.' });
    assert.equal(captionsLine(true, on), 'Server: Captions on.');
    // A quote for the other setting is not shown as this one’s line.
    assert.equal(captionsLine(false, on), CAPTIONS_OFF_LINE);
    assert.equal(captionsLine(false, parseQuote({ credits: 1, sufficient: true })!), CAPTIONS_OFF_LINE);
  });

  it('shows the caption burn as part of the cut, with its own label', () => {
    const v = viewOfRun({ status: 'running', current_step: 'captions' }) as { stage: string; label: string };
    assert.equal(v.stage, 'cut');
    assert.match(v.label, /Captions/);
  });
});
