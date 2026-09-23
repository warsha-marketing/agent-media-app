// The web Script editor mirrors the allowed Delivery Tags, their formatting,
// the unknown-tag message and the Product Details limit (it takes no imports);
// the originals live in @agentmedia/schema and api-v2. Held equal here.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as schema from '../../packages/schema/src/delivery-tags.ts';
import { PRODUCT_DETAILS_MAX_CHARS } from '../../services/api-v2/src/drafts/product-hero-draft.ts';
import {
  DELIVERY_TAGS,
  PRODUCT_DETAILS_MAX,
  formatDeliveryTags,
  insertDeliveryTag,
  unknownDeliveryTagMessage,
  unknownDeliveryTags,
} from '../../apps/web/lib/product-hero-flow.ts';

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

  it('formats tags and words the unknown-tag message exactly as the server does', () => {
    assert.equal(formatDeliveryTags(), schema.formatDeliveryTags());
    assert.equal(formatDeliveryTags(['softly']), schema.formatDeliveryTags(['softly']));
    for (const tags of [['[wisper]'], ['[wisper]', '[shouts]']]) {
      assert.equal(unknownDeliveryTagMessage(tags), schema.unknownDeliveryTagMessage(tags));
    }
  });
});

describe('Product Details limit: web field mirror', () => {
  it('caps the field at the API limit', () => {
    assert.equal(PRODUCT_DETAILS_MAX, PRODUCT_DETAILS_MAX_CHARS);
  });
});

describe('insertDeliveryTag', () => {
  it('puts the tag at the caret, spaced, and moves the caret after it', () => {
    assert.deepEqual(insertDeliveryTag('أ ب', 'softly', 2, 2), { script: 'أ [softly] ب', caret: 11 });
    assert.deepEqual(insertDeliveryTag('أب', 'softly', 0, 0), { script: '[softly] أب', caret: 9 });
    assert.deepEqual(insertDeliveryTag('أ', 'laughs', 1, 1), { script: 'أ [laughs] ', caret: 11 });
  });
});
