// The web Script editor mirrors the allowed Delivery Tags (it takes no
// imports); the list itself lives in @agentmedia/schema. Held equal here.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as schema from '../../packages/schema/src/delivery-tags.ts';
import { DELIVERY_TAGS, insertDeliveryTag, unknownDeliveryTags } from '../../apps/web/lib/product-hero-flow.ts';

const LIVE_SCRIPT =
  '[confidently] رومي رويال ريتشوالز، فريش وراقية. [softly] برغموت، فلفل زهري، جِلد ومِسك. [warmly] بتضلّ معك للسهرة. [excited] جرّبها.';

describe('Delivery Tags: web editor mirror', () => {
  it('lists exactly the allowed Delivery Tags, in the same order', () => {
    assert.deepEqual([...DELIVERY_TAGS], [...schema.DELIVERY_TAGS]);
  });

  it('spots the same unknown tags as the server', () => {
    for (const s of [LIVE_SCRIPT, LIVE_SCRIPT.replace('[softly]', '[wisper]'), '[Softly] أ [shouts] ب [ calm ]', 'بلا وسوم']) {
      assert.deepEqual(unknownDeliveryTags(s), schema.unknownDeliveryTags(s), s);
    }
    assert.deepEqual(unknownDeliveryTags(LIVE_SCRIPT.replace('[softly]', '[wisper]')), ['[wisper]']);
  });
});

describe('insertDeliveryTag', () => {
  it('puts the tag at the caret, spaced, and moves the caret after it', () => {
    assert.deepEqual(insertDeliveryTag('أ ب', 'softly', 2, 2), { script: 'أ [softly] ب', caret: 11 });
    assert.deepEqual(insertDeliveryTag('أب', 'softly', 0, 0), { script: '[softly] أب', caret: 9 });
    assert.deepEqual(insertDeliveryTag('أ', 'laughs', 1, 1), { script: 'أ [laughs] ', caret: 11 });
  });
});
