// Music Bed on the web Product Hero flow (#9): the toggle's one-line
// explanation, what the quote says about the bed, the run body, and progress.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NO_MUSIC_LINE, musicBedLine, parseQuote, renderBody, viewOfRun } from '../../apps/web/lib/product-hero-flow.ts';

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
    assert.equal(musicBedLine(false, parseQuote({ credits: 1, sufficient: true })!), NO_MUSIC_LINE);
  });

  it('on with no licensed track: shows the server’s reason (voice only), never claims music', () => {
    const q = parseQuote({ credits: 1, sufficient: true, music_bed: { on: false, reason: 'no_tracks', detail: 'No licensed Music Bed yet.' } })!;
    assert.equal(musicBedLine(true, q), 'No licensed Music Bed yet.');
  });

  it('on with a track: says a bed plays under the voice', () => {
    const q = parseQuote({ credits: 1, sufficient: true, music_bed: { on: true, track_id: 'ph-a', mood: 'luxurious', reason: null, detail: 'x' } })!;
    assert.match(musicBedLine(true, q), /Music Bed/);
  });

  it('the run body carries the toggle', () => {
    assert.deepEqual(renderBody(DRAFT, PHOTO, false), { draft_id: DRAFT, product_image_url: PHOTO, music: false });
    assert.deepEqual(renderBody(DRAFT, PHOTO, true), { draft_id: DRAFT, product_image_url: PHOTO, music: true });
  });

  it('the Music Bed step shows as part of the cut, not back at the queue', () => {
    assert.equal((viewOfRun({ status: 'running', current_step: 'music_bed' }) as { stage: string }).stage, 'cut');
  });
});
