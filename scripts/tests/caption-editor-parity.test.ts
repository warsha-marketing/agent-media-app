// The web Caption editor (#22) mirrors the caption-lines contract of
// @agentmedia/schema (limits, style whitelist, text tidying, the checks and
// their codes) and the burn's placement from the worker's ASS style, because
// it takes no imports. Held equal here, so the preview matches the export and
// the editor refuses exactly what the server refuses.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as schema from '../../packages/schema/src/caption-lines.ts';
import { ARABIC_CAPTION_STYLE, assCaptionStyle } from '../../services/primitive-worker-vnext/src/lib/arabic-captions-ass.ts';
import * as web from '../../apps/web/lib/caption-editor.ts';

const CASES: Array<{ lines: Array<{ text: string; start: number; end: number }>; d: number }> = [
  { lines: [], d: 5 },
  { lines: [{ text: 'رومي رويال،', start: 0.4, end: 1.5 }, { text: 'جلد ومسك', start: 1.5, end: 3 }], d: 5 },
  { lines: [{ text: 'أ', start: 0, end: 2 }, { text: 'ب', start: 1, end: 3 }], d: 5 },
  { lines: [{ text: 'أ', start: 2, end: 3 }, { text: 'ب', start: 0, end: 1 }], d: 5 },
  { lines: [{ text: 'أ', start: 4, end: 6 }, { text: 'ب', start: -1, end: 0.5 }], d: 5 },
  { lines: [{ text: ' \n ', start: 0, end: 1 }, { text: 'ب'.repeat(49), start: 1, end: 1.1 }], d: 5 },
  { lines: [{ text: 'أ', start: 1, end: 1 }, { text: 'ب', start: Number.NaN, end: 2 }], d: 5 },
  { lines: Array.from({ length: 61 }, (_, i) => ({ text: 'أ', start: i * 0.2, end: i * 0.2 + 0.2 })), d: 20 },
  { lines: [{ text: 'أ', start: 4.8, end: 5.0005 }], d: 5 },
];

describe('Caption editor: web mirror of the caption-lines contract', () => {
  it('has the same limits, style whitelist and default style', () => {
    assert.deepEqual({ ...web.CAPTION_LIMITS }, { ...schema.CAPTION_LINE_LIMITS });
    assert.deepEqual([...web.CAPTION_POSITIONS], [...schema.CAPTION_POSITIONS]);
    assert.deepEqual([...web.CAPTION_SIZES], [...schema.CAPTION_SIZES]);
    assert.deepEqual({ ...web.CAPTION_COLOURS }, { ...schema.CAPTION_COLOURS });
    assert.deepEqual({ ...web.DEFAULT_STYLE }, { ...schema.DEFAULT_CAPTION_STYLE });
  });

  it('tidies text the same way', () => {
    for (const t of ['  جلد\n\n ومسك\t ', 'جلد\u0000\u202E ومسك\u2066', 'Rumi  رومي', '']) {
      assert.equal(web.normaliseText(t), schema.normaliseCaptionText(t), JSON.stringify(t));
    }
  });

  it('refuses the same lines, with the same codes, messages and line numbers', () => {
    for (const { lines, d } of CASES) {
      assert.deepEqual(web.validateLines(lines, d), schema.validateCaptionLines(lines, d), JSON.stringify(lines).slice(0, 80));
    }
  });
});

describe('Caption editor: the overlay is placed like the burn', () => {
  it('for every style: size, vertical placement and colour match the ASS style', () => {
    for (const position of schema.CAPTION_POSITIONS) {
      for (const size of schema.CAPTION_SIZES) {
        for (const colour of Object.keys(schema.CAPTION_COLOURS) as schema.CaptionColour[]) {
          const style = { position, size, colour };
          const ass = assCaptionStyle(style);
          const css = web.overlayStyle(style);
          assert.equal(css.fontSizeCqh, (ass.fontSize / 1920) * 100);
          if (ass.alignment === 2) assert.equal(css.bottomPct, (ass.marginV / 1920) * 100); // bottom centre
          else if (ass.alignment === 8) assert.equal(css.topPct, (ass.marginV / 1920) * 100); // top centre
          else assert.equal(css.centred, ass.alignment === 5);
          const hex = schema.CAPTION_COLOURS[colour];
          assert.equal(ass.primaryColour, `&H00${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`);
          assert.equal(css.color, hex);
        }
      }
    }
    assert.equal(web.overlayStyle(web.DEFAULT_STYLE).sidePct, (ARABIC_CAPTION_STYLE.marginL / 1080) * 100);
    assert.equal(web.OUTLINE_PX, ARABIC_CAPTION_STYLE.outline);
    assert.equal(web.SHADOW_PX, ARABIC_CAPTION_STYLE.shadow);
  });
});
