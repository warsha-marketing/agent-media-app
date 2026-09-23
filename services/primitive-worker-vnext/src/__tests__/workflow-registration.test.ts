// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// What the worker registers as Temporal workflow types (workflows/index.ts is
// the worker's workflowsPath: every export is a startable type). The shared
// Preset render pipeline is internal: anyone who can start a workflow must not
// be able to hand it their own shot prompts. Only the per-Preset wrappers are
// registered, their input carries no prompts, and the definition is resolved
// inside the workflow from the server-side registry by id.

import { describe, it, expect, expectTypeOf } from 'vitest';
import * as workflows from '../workflows/index.js';
import type { MakeProductHeroWorkflowInput } from '../workflows/make-product-hero.js';
import { PRESET_RENDERS, PRODUCT_HERO_RENDER, presetRender } from '../presets/index.js';

describe('registered workflow types', () => {
  it('do not include the shared Preset render pipeline', () => {
    const names = Object.keys(workflows);
    expect(names).toContain('makeProductHeroWorkflow');
    expect(names).not.toContain('renderPresetWorkflow');
    expect(names.filter((n) => /renderpreset/i.test(n))).toEqual([]);
    for (const n of names) expect(n, n).toMatch(/Workflow$/);
  });

  it('the Product Hero wrapper takes no prompts and no Preset definition', () => {
    expectTypeOf<MakeProductHeroWorkflowInput>().not.toHaveProperty('preset');
    expectTypeOf<MakeProductHeroWorkflowInput>().not.toHaveProperty('shotPrompts');
    expectTypeOf<MakeProductHeroWorkflowInput>().not.toHaveProperty('prompt');
  });
});

describe('the server-side Preset render registry', () => {
  it('resolves a Preset render definition by id', () => {
    expect(presetRender('product_hero')).toBe(PRODUCT_HERO_RENDER);
    for (const [id, def] of Object.entries(PRESET_RENDERS)) expect(def.id).toBe(id);
  });

  it('refuses an unknown id', () => {
    expect(() => presetRender('not_a_preset')).toThrow(/unknown Preset/);
    expect(() => presetRender('__proto__')).toThrow(/unknown Preset/);
  });
});
