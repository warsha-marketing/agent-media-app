// The Caption editor on the Short's result page (#22): splitting, merging,
// nudging and validating lines, which line is on screen at a time, the .srt
// download, the overlay's style, the export request and its Idempotency-Key.
// Everything here is pure: the browser previews with HTML/CSS and never
// encodes video.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTION_LINE_LIMITS,
  DEFAULT_STYLE,
  exportBody,
  exportKeyFor,
  exportViewOf,
  lineAt,
  mergeWithNext,
  nudge,
  overlayStyle,
  parseSuggested,
  removeLine,
  setText,
  splitLine,
  srtTime,
  toSrt,
  validateLines,
  withIds,
  type EditorLine,
} from '../../apps/web/lib/caption-editor.ts';

const RLM = '\u200F';
const lines = (): EditorLine[] =>
  withIds([
    { text: 'رومي رويال،', start: 0.4, end: 1.5 },
    { text: 'فريش وراقية.', start: 1.5, end: 3 },
    { text: 'جلد ومسك', start: 3.2, end: 5 },
  ]);
const plain = (ls: EditorLine[]) => ls.map(({ text, start, end }) => ({ text, start, end }));

describe('splitLine', () => {
  it('splits at the word nearest the middle, timing each half by its share of the letters', () => {
    const out = splitLine(lines(), 2);
    assert.deepEqual(plain(out).slice(2), [
      { text: 'جلد', start: 3.2, end: 3.971 },
      { text: 'ومسك', start: 3.971, end: 5 },
    ]);
    assert.equal(out.length, 4);
    assert.notEqual(out[2].id, out[3].id);
  });

  it('splits at the space nearest the caret when one is given', () => {
    const ls = withIds([{ text: 'أ بب ججج دddd', start: 0, end: 4 }]);
    const out = splitLine(ls, 0, 1); // caret right after "أ"
    assert.equal(out[0].text, 'أ');
    assert.equal(out[1].text, 'بب ججج دddd');
  });

  it('leaves a one-word line, or one too short to halve, as it is', () => {
    const one = withIds([{ text: 'جلد', start: 0, end: 2 }]);
    assert.equal(splitLine(one, 0), one);
    const short = withIds([{ text: 'أ ب', start: 0, end: CAPTION_LINE_LIMITS.minSeconds * 1.5 }]);
    assert.equal(splitLine(short, 0), short);
  });
});

describe('mergeWithNext', () => {
  it('joins a line with the next: words in order, from the first start to the second end', () => {
    const out = mergeWithNext(lines(), 0);
    assert.deepEqual(plain(out)[0], { text: 'رومي رويال، فريش وراقية.', start: 0.4, end: 3 });
    assert.equal(out.length, 2);
  });

  it('does nothing on the last line', () => {
    const ls = lines();
    assert.equal(mergeWithNext(ls, 2), ls);
  });

  it('split then merge gives the line back', () => {
    const ls = lines();
    assert.deepEqual(plain(mergeWithNext(splitLine(ls, 1), 1)), plain(ls));
  });
});

describe('nudge', () => {
  it('moves an edge by the step, rounded to the millisecond', () => {
    assert.equal(nudge(lines(), 2, 'start', -0.1, 6)[2].start, 3.1);
    assert.equal(nudge(lines(), 2, 'end', 0.1, 6)[2].end, 5.1);
  });

  it('never overlaps a neighbour, leaves the Short, or makes a line too short to read', () => {
    assert.equal(nudge(lines(), 1, 'start', -0.5, 6)[1].start, 1.5); // prev ends at 1.5
    assert.equal(nudge(lines(), 1, 'end', 0.5, 6)[1].end, 3.2); // next starts at 3.2
    assert.equal(nudge(lines(), 0, 'start', -1, 6)[0].start, 0);
    assert.equal(nudge(lines(), 2, 'end', 5, 6)[2].end, 6);
    assert.equal(nudge(lines(), 2, 'start', 5, 6)[2].start, +(5 - CAPTION_LINE_LIMITS.minSeconds).toFixed(3));
  });
});

describe('setText and removeLine', () => {
  it('edit one line only', () => {
    const ls = lines();
    const edited = setText(ls, 1, 'فريش');
    assert.equal(edited[1].text, 'فريش');
    assert.equal(edited[0], ls[0]);
    assert.deepEqual(plain(removeLine(ls, 1)), plain([ls[0], ls[2]]));
  });
});

describe('validateLines (the same rules the server checks)', () => {
  const codes = (ls: Array<{ text: string; start: number; end: number }>, d = 6) => validateLines(ls, d).map((i) => `${i.code}@${i.line}`);

  it('accepts the suggested lines', () => {
    assert.deepEqual(codes(lines()), []);
  });

  it('flags overlap, disorder, leaving the Short, empty and over-long text', () => {
    assert.deepEqual(codes([{ text: 'أ', start: 0, end: 2 }, { text: 'ب', start: 1, end: 3 }]), ['overlap@1']);
    assert.deepEqual(codes([{ text: 'أ', start: 2, end: 3 }, { text: 'ب', start: 0, end: 1 }]), ['out_of_order@1']);
    assert.deepEqual(codes([{ text: 'أ', start: 5, end: 7 }]), ['outside_short@0']);
    assert.deepEqual(codes([{ text: ' ', start: 0, end: 1 }]), ['empty_text@0']);
    assert.deepEqual(codes([{ text: 'ب'.repeat(CAPTION_LINE_LIMITS.maxChars + 1), start: 0, end: 1 }]), ['text_too_long@0']);
  });
});

describe('lineAt (the overlay follows the video)', () => {
  it('is the line on screen at time t (start inclusive, end exclusive), else -1', () => {
    const ls = lines();
    assert.equal(lineAt(ls, 0.1), -1);
    assert.equal(lineAt(ls, 0.4), 0);
    assert.equal(lineAt(ls, 1.5), 1);
    assert.equal(lineAt(ls, 3.1), -1);
    assert.equal(lineAt(ls, 4.99), 2);
    assert.equal(lineAt(ls, 5), -1);
  });
});

describe('.srt download', () => {
  it('formats times as HH:MM:SS,mmm with the carry done on the whole value', () => {
    assert.equal(srtTime(0), '00:00:00,000');
    assert.equal(srtTime(3.975), '00:00:03,975');
    assert.equal(srtTime(59.9996), '00:01:00,000');
    assert.equal(srtTime(3725.5), '01:02:05,500');
  });

  it('numbers the cues from 1, and starts every line with a right-to-left mark', () => {
    const srt = toSrt(lines());
    assert.equal(
      srt,
      [
        '1', '00:00:00,400 --> 00:00:01,500', `${RLM}رومي رويال،`, '',
        '2', '00:00:01,500 --> 00:00:03,000', `${RLM}فريش وراقية.`, '',
        '3', '00:00:03,200 --> 00:00:05,000', `${RLM}جلد ومسك`, '',
      ].join('\n'),
    );
  });

  it('tidies the text as the export does (one line, no bidi overrides) and skips empty lines', () => {
    const srt = toSrt(withIds([{ text: ' جلد\n\u202Eومسك ', start: 0, end: 1 }, { text: ' ', start: 1, end: 2 }]));
    assert.equal(srt, `1\n00:00:00,000 --> 00:00:01,000\n${RLM}جلد ومسك\n`);
  });
});

describe('overlayStyle (the preview matches the export)', () => {
  it('sizes and places text in the same units as the burn (canvas 1080×1920)', () => {
    const m = overlayStyle(DEFAULT_STYLE);
    assert.equal(m.fontSizeCqh, (96 / 1920) * 100);
    assert.equal(m.bottomPct, (560 / 1920) * 100);
    assert.equal(m.topPct, null);
    assert.equal(m.sidePct, (130 / 1080) * 100);
    assert.equal(m.color, '#FFFFFF');
    const top = overlayStyle({ position: 'top', size: 'l', colour: 'yellow' });
    assert.equal(top.topPct, (300 / 1920) * 100);
    assert.equal(top.bottomPct, null);
    assert.equal(top.fontSizeCqh, (120 / 1920) * 100);
    const centre = overlayStyle({ position: 'centre', size: 's', colour: 'mint' });
    assert.equal(centre.centred, true);
  });
});

describe('the export request', () => {
  it('sends only the lines (text + timing) and the style', () => {
    assert.deepEqual(exportBody(lines(), DEFAULT_STYLE), { lines: plain(lines()), style: DEFAULT_STYLE });
  });

  it('reuses the Idempotency-Key for the same request (a double click) and mints one for an edit', () => {
    const a = exportBody(lines(), DEFAULT_STYLE);
    const first = exportKeyFor(null, a, 'k1');
    assert.equal(exportKeyFor(first, exportBody(lines(), DEFAULT_STYLE), 'k2').key, 'k1');
    assert.equal(exportKeyFor(first, exportBody(setText(lines(), 0, 'رومي'), DEFAULT_STYLE), 'k2').key, 'k2');
    assert.equal(exportKeyFor(first, exportBody(lines(), { ...DEFAULT_STYLE, size: 'l' }), 'k3').key, 'k3');
  });

  it('reads the export run: rendering, the new file, or why it failed', () => {
    assert.deepEqual(exportViewOf({ status: 'running' }), { kind: 'running' });
    assert.deepEqual(exportViewOf({ status: 'succeeded', final_output: { video_url: 'https://r2.test/c.mp4' } }), { kind: 'succeeded', videoUrl: 'https://r2.test/c.mp4' });
    assert.deepEqual(exportViewOf({ status: 'failed', error: { code: 'X', message: 'boom' } }), { kind: 'failed', message: 'boom' });
    assert.equal(exportViewOf({ status: 'succeeded', final_output: {} }).kind, 'failed');
  });
});

describe('parseSuggested', () => {
  it('reads GET /v1/shorts/:id/captions, or null', () => {
    const got = parseSuggested({ short_id: 's', video_url: 'https://r2.test/clean.mp4', duration_ms: 6000, lines: plain(lines()), style: DEFAULT_STYLE });
    assert.equal(got?.videoUrl, 'https://r2.test/clean.mp4');
    assert.equal(got?.durationSeconds, 6);
    assert.deepEqual(plain(got!.lines), plain(lines()));
    assert.deepEqual(got?.style, DEFAULT_STYLE);
    assert.equal(parseSuggested({ lines: 'x' }), null);
    assert.equal(parseSuggested(null), null);
  });
});
