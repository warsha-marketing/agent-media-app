// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Product Profile (#30): what the system understands about one product from its
 * photo and Product Details. One schema, used to validate the vision reply, a
 * user's edit and what the draft stores.
 */

import { describe, it, expect } from 'vitest';
import {
  PHYSICS_RISKS,
  PRODUCT_CATEGORIES,
  PRODUCT_PROFILE_OUTPUT_SCHEMA,
  ProductProfileSchema,
  SIZE_CLASSES,
  parseProductProfile,
  productProfileIssues,
} from '../product-profile.js';

const PERFUME = {
  category: 'fragrance_oud',
  dimensions: { height_cm: 11, width_cm: 5, volume_ml: 100 },
  size_class: 'palm',
  parts: [{ name: 'cap', removable: true }, { name: 'bottle', removable: false }],
  used_state: 'uncapped, spray neck visible',
  differs_from_photo: true,
  interaction_verbs: ['spray', 'smell'],
  grip: 'one hand around the bottle, index finger on the nozzle',
  physics_risks: ['separate_cap', 'small_text'],
  confidence: 0.86,
};

describe('Product Profile schema', () => {
  it('holds the fixed category and size lists', () => {
    expect(PRODUCT_CATEGORIES).toEqual(['fragrance_oud', 'skincare_beauty', 'food_cafe', 'electronics', 'fashion_modest', 'home', 'other']);
    expect(SIZE_CLASSES).toEqual(['tiny', 'palm', 'hand', 'two_hands', 'large']);
    expect(PHYSICS_RISKS).toContain('separate_cap');
    expect(PHYSICS_RISKS).toContain('liquid_pour');
    expect(PHYSICS_RISKS).toContain('small_text');
  });

  it('accepts a perfume Profile as the vision call returns it', () => {
    expect(parseProductProfile(PERFUME)).toEqual(PERFUME);
  });

  it('normalises missing or null dimensions to null', () => {
    const p = parseProductProfile({ ...PERFUME, dimensions: { height_cm: 11, width_cm: null } });
    expect(p.dimensions).toEqual({ height_cm: 11, width_cm: null, volume_ml: null });
  });

  it('tidies text and drops duplicate verbs and risks', () => {
    const p = parseProductProfile({
      ...PERFUME,
      used_state: '  uncapped,\n spray neck   visible ',
      interaction_verbs: ['Spray', 'spray', ' smell '],
      physics_risks: ['separate_cap', 'separate_cap'],
    });
    expect(p.used_state).toBe('uncapped, spray neck visible');
    expect(p.interaction_verbs).toEqual(['spray', 'smell']);
    expect(p.physics_risks).toEqual(['separate_cap']);
  });

  it('refuses an unknown category, size class or risk, and a confidence outside 0–1', () => {
    for (const bad of [
      { ...PERFUME, category: 'perfume' },
      { ...PERFUME, size_class: 'huge' },
      { ...PERFUME, physics_risks: ['explodes'] },
      { ...PERFUME, confidence: 1.4 },
      { ...PERFUME, confidence: -0.1 },
      { ...PERFUME, interaction_verbs: [] },
      { ...PERFUME, used_state: '' },
      { ...PERFUME, extra: 'field' },
    ]) {
      expect(ProductProfileSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('refuses negative or absurd dimensions', () => {
    expect(ProductProfileSchema.safeParse({ ...PERFUME, dimensions: { height_cm: -2 } }).success).toBe(false);
    expect(ProductProfileSchema.safeParse({ ...PERFUME, dimensions: { height_cm: 9000 } }).success).toBe(false);
  });

  it('names what is wrong, one line per issue, for the rewrite and the user', () => {
    const issues = productProfileIssues({ ...PERFUME, category: 'perfume', confidence: 3 });
    expect(issues.length).toBe(2);
    expect(issues.join(' ')).toMatch(/category/);
    expect(issues.join(' ')).toMatch(/confidence/);
    expect(productProfileIssues(PERFUME)).toEqual([]);
  });

  it('the structured-output schema uses no numeric constraints (unsupported) and requires every field', () => {
    const text = JSON.stringify(PRODUCT_PROFILE_OUTPUT_SCHEMA);
    expect(text).not.toMatch(/minimum|maximum|minItems|maxItems|minLength|maxLength/);
    expect([...PRODUCT_PROFILE_OUTPUT_SCHEMA.required].sort()).toEqual(Object.keys(PERFUME).sort());
    expect(PRODUCT_PROFILE_OUTPUT_SCHEMA.properties.category.enum).toEqual([...PRODUCT_CATEGORIES]);
  });
});
