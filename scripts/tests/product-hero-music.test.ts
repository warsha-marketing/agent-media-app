// Music Bed on the web Product Hero flow (#9): the toggle's one-line
// explanation, what the quote says about the bed, the run body, and progress.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NO_MUSIC_LINE, musicBedLine, parseQuote, quoteBody, renderBody, viewOfRun } from '../../apps/web/lib/product-hero-flow.ts';

const DRAFT = '11111111-1111-4111-8111-111111111111';
const PHOTO = 'https://media.example/vnext/uploads/u/photo.png';

describe('Music Bed on the Product Hero page', () => {
  it('reads the quote’s Music Bed', () => {
    const q = parseQuote({
      credits: 280,
      available: null,
      sufficient: true,
      music_bed: { on: false, track_id: null, mood: null, reason: 'no_tracks', detail: 'No licensed Music Bed is available for this Preset yet, so the Short is voice only.' },
    });
    assert.deepEqual(q?.musicBed, { on: false, reason: 'no_tracks', detail: 'No licensed Music Bed is available for this Preset yet, so the Short is voice only.' });
  });

  it('off: says the Short is voice only and a sound can be added in TikTok', () => {
    assert.match(NO_MUSIC_LINE, /add a sound in TikTok/);
    // Fallback only: a quote that says nothing about the bed.
    assert.equal(musicBedLine(false, parseQuote({ credits: 1, sufficient: true })!), NO_MUSIC_LINE);
  });

  it('off: shows the server’s own line when the quote carries it', () => {
    const q = parseQuote({ credits: 1, sufficient: true, music_bed: { on: false, reason: 'off', detail: 'Server says: voice only.' } })!;
    assert.equal(musicBedLine(false, q), 'Server says: voice only.');
  });

  it('a quote for the other setting is not shown as this one’s line', () => {
    const on = parseQuote({ credits: 1, sufficient: true, music_bed: { on: true, track_id: 'a', mood: 'm', reason: null, detail: 'Server: bed on.' } })!;
    assert.equal(musicBedLine(false, on), NO_MUSIC_LINE);
  });

  it('on with no licensed track: shows the server’s reason (voice only), never claims music', () => {
    const q = parseQuote({ credits: 1, sufficient: true, music_bed: { on: false, reason: 'no_tracks', detail: 'No licensed Music Bed yet.' } })!;
    assert.equal(musicBedLine(true, q), 'No licensed Music Bed yet.');
  });

  it('on with a track: shows the server’s line', () => {
    const q = parseQuote({ credits: 1, sufficient: true, music_bed: { on: true, track_id: 'ph-a', mood: 'luxurious', reason: null, detail: 'A licensed Music Bed is mixed quietly under the voice.' } })!;
    assert.equal(musicBedLine(true, q), 'A licensed Music Bed is mixed quietly under the voice.');
  });

  it('the quote body carries the toggle, like the run body', () => {
    assert.deepEqual(quoteBody(DRAFT, PHOTO, false), { draft_id: DRAFT, product_image_url: PHOTO, music: false });
    assert.deepEqual(quoteBody(DRAFT, PHOTO, true), renderBody(DRAFT, PHOTO, true));
  });

  it('the run body carries the toggle', () => {
    assert.deepEqual(renderBody(DRAFT, PHOTO, false), { draft_id: DRAFT, product_image_url: PHOTO, music: false });
    assert.deepEqual(renderBody(DRAFT, PHOTO, true), { draft_id: DRAFT, product_image_url: PHOTO, music: true });
  });

  it('the Music Bed step shows as part of the cut, not back at the queue', () => {
    assert.equal((viewOfRun({ status: 'running', current_step: 'music_bed' }) as { stage: string }).stage, 'cut');
  });
});
