// The web Script editor mirrors the allowed Delivery Tags, their formatting,
// the unknown-tag message, the Product Details limit and the Product
// Interaction's limit and tidying (it takes no imports); the originals live in
// @agentmedia/schema and api-v2. Held equal here, and the Product Interaction's
// limit also against the database CHECK.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as schema from '../../packages/schema/src/delivery-tags.ts';
import { PRODUCT_INTERACTION_MAX_CHARS, tidyProductInteraction as schemaTidy } from '../../packages/schema/src/product-interaction.ts';
import { PRODUCT_DETAILS_MAX_CHARS } from '../../services/api-v2/src/drafts/product-hero-draft.ts';
import {
  DELIVERY_TAGS,
  PRODUCT_DETAILS_MAX,
  PRODUCT_INTERACTION_MAX,
  formatDeliveryTags,
  tidyProductInteraction as webTidy,
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

describe('Product Interaction: one limit and one tidy, everywhere', () => {
  it('caps the web field at the schema limit', () => {
    assert.equal(PRODUCT_INTERACTION_MAX, PRODUCT_INTERACTION_MAX_CHARS);
  });

  it('the database CHECK bounds the column at the same limit', () => {
    const sql = readFileSync(
      new URL('../../supabase/migrations/20260924100000_short_drafts_product_interaction.sql', import.meta.url),
      'utf8',
    );
    const check = /CHECK\s*\(\s*product_interaction IS NULL OR char_length\(product_interaction\) BETWEEN 1 AND (\d+)\s*\)/.exec(sql);
    assert.ok(check, 'the migration declares the length CHECK');
    assert.equal(Number(check[1]), PRODUCT_INTERACTION_MAX_CHARS);
  });

  it('the web tidies exactly as the schema (and so the API) stores it', () => {
    const samples = [
      null,
      undefined,
      '',
      '   ',
      '  removes the cap,\n sprays once on the inner wrist  ',
      'x'.repeat(PRODUCT_INTERACTION_MAX_CHARS + 50),
      `${'a'.repeat(PRODUCT_INTERACTION_MAX_CHARS - 1)} b`,
      'يرش مرة على المعصم\t ثم يشمّه',
    ];
    for (const s of samples) assert.equal(webTidy(s), schemaTidy(s), String(s));
    // Stored text always fits the CHECK: 1..limit characters, or null.
    for (const s of samples) {
      const t = schemaTidy(s);
      if (t !== null) assert.ok(t.length >= 1 && t.length <= PRODUCT_INTERACTION_MAX_CHARS);
    }
  });
});

describe('insertDeliveryTag', () => {
  it('puts the tag at the caret, spaced, and moves the caret after it', () => {
    assert.deepEqual(insertDeliveryTag('أ ب', 'softly', 2, 2), { script: 'أ [softly] ب', caret: 11 });
    assert.deepEqual(insertDeliveryTag('أب', 'softly', 0, 0), { script: '[softly] أب', caret: 9 });
    assert.deepEqual(insertDeliveryTag('أ', 'laughs', 1, 1), { script: 'أ [laughs] ', caret: 11 });
  });
});
