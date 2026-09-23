// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The skill routes' OpenAPI refusal lines are derived from the skill registry:
// every Preset render skill (SkillEntry.preset) answers the shared render
// refusals (RENDER_REFUSALS) plus its own (SkillEntry.presetRefusals), and the
// Qualified Preset gate. A new Preset skill shows up in the spec without
// touching skills-openapi.ts.

import { describe, it, expect, afterEach } from 'vitest';
import { SKILLS } from '../skills/registry.js';
import { RENDER_REFUSALS } from '../skills/product-hero-render.js';
import { skillRouteOpenApi } from '../routes/v1/skills-openapi.js';

type Paths = Record<string, { post: { responses: Record<string, { description: string }> } }>;
const described = (path: string, status: number) => (skillRouteOpenApi().paths as Paths)[path].post.responses[String(status)]?.description ?? '';
const PATHS = ['/v1/skills/{slug}/run', '/v1/skills/{slug}/quote'];

/** The slugs a refusal line names, e.g. "`code` (a, b): when" → [a, b]. */
function slugsOf(description: string, code: string): string[] {
  const m = description.match(new RegExp(`\`${code}\` \\(([a-z_, ]+)\\)`));
  return m ? m[1].split(', ') : [];
}

afterEach(() => {
  delete SKILLS.make_test_preset;
});

describe('OpenAPI refusal lines come from the registry', () => {
  it('names every Preset render skill on every refusal it can answer, and no other skill', () => {
    const presetSkills = Object.values(SKILLS).filter((s) => s.preset);
    expect(presetSkills.map((s) => s.slug).sort()).toEqual(['make_hands_on', 'make_product_hero', 'make_reaction']);
    for (const path of PATHS) {
      const expected = new Map<string, { status: number; slugs: string[] }>();
      for (const skill of presetSkills) {
        for (const [code, r] of Object.entries({ ...RENDER_REFUSALS, ...(skill.presetRefusals ?? {}) })) {
          const e = expected.get(code) ?? { status: r.status, slugs: [] };
          e.slugs.push(skill.slug);
          expected.set(code, e);
        }
      }
      for (const [code, { status, slugs }] of expected) {
        expect(slugsOf(described(path, status), code), `${path} ${code}`).toEqual(slugs.sort());
      }
      expect(slugsOf(described(path, 422), 'PRESET_NOT_QUALIFIED')).toEqual(presetSkills.map((s) => s.slug).sort());
    }
  });

  it('a new Preset skill and its own refusal appear without touching the OpenAPI module', () => {
    SKILLS.make_test_preset = {
      ...SKILLS.make_product_hero,
      slug: 'make_test_preset',
      presetRefusals: { prop_not_found: { status: 404, when: 'no such prop on this account' } },
    };
    for (const path of PATHS) {
      expect(described(path, 404)).toContain('`prop_not_found` (make_test_preset): no such prop on this account');
      expect(slugsOf(described(path, 404), 'draft_not_found')).toContain('make_test_preset');
      expect(slugsOf(described(path, 422), 'PRESET_NOT_QUALIFIED')).toContain('make_test_preset');
    }
  });
});
