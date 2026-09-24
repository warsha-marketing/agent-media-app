// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The Shot Plan (#26): stable shot ids from the priced plan, the default scene
// per shot, the Guardrails every shot keeps whatever its scene says, and the
// check that refuses a scene that cannot render.

import { describe, it, expect } from 'vitest';
import {
  HAND_GENDERS,
  HANDS_ON,
  HANDS_ON_SETTINGS,
  PRODUCT_HERO,
  PRODUCT_INTERACTION_MAX_CHARS,
  REACTION,
  planPresetShots,
  type Modesty,
} from '@agentmedia/schema';
import {
  AUDIO_OFF,
  FORMAT,
  HANDS_ONLY,
  HANDS_ON_PROMPTS,
  MODESTY_PROMPTS,
  NO_PEOPLE,
  NO_SPEAKING_PERSON,
  PRODUCT_HERO_PROMPTS,
  REACTION_PROMPTS,
  REFERENCE_TOKENS,
  SCENE_TEXT_MAX_CHARS,
  ShotEditError,
  composeShotPlan,
  displayReferences,
  effectiveEdits,
  presetPrompts,
  sceneTextProblem,
  shotPrompt,
  type ReferenceWords,
  type ShotPlanPreset,
} from '../index.js';

const HERO: ShotPlanPreset = { ...PRODUCT_HERO, ...PRODUCT_HERO_PROMPTS } as ShotPlanPreset;
const REACT: ShotPlanPreset = { ...REACTION, ...REACTION_PROMPTS } as ShotPlanPreset;
const HANDS: ShotPlanPreset = { ...HANDS_ON, ...HANDS_ON_PROMPTS } as ShotPlanPreset;
const EVOLINK: ReferenceWords = { start: '@image1', person: '@image2' };
const COVERED: Modesty = { arms: 'covered', hijab: false };
const HIJAB: Modesty = { arms: 'covered', hijab: true };
const PERFUME = 'removes the cap, sprays once on the inner wrist, brings the wrist to the nose, smiles';
const handsVars = HANDS_ON_PROMPTS.promptVars!({ hand_gender: 'female', setting: 'dressing_table' });

describe('the Preset prompt registry', () => {
  it('has the wording of every Preset, by its id', () => {
    expect(presetPrompts(PRODUCT_HERO.id)).toBe(PRODUCT_HERO_PROMPTS);
    expect(presetPrompts(REACTION.id)).toBe(REACTION_PROMPTS);
    expect(presetPrompts(HANDS_ON.id)).toBe(HANDS_ON_PROMPTS);
    expect(() => presetPrompts('nope')).toThrow(/no prompts/);
  });
});

describe('composeShotPlan', () => {
  it('gives every planned shot a stable id, its kind, length and model, in the priced plan’s order', () => {
    for (const ms of [5_000, 9_000, 12_500, 15_000]) {
      const plan = composeShotPlan(REACT, { durationMs: ms, modesty: HIJAB, personReference: true });
      const priced = planPresetShots(REACTION, ms);
      expect(plan.map((s) => s.kind)).toEqual(priced.map((s) => s.kind));
      expect(plan.map((s) => s.shot_id)).toEqual(priced.map((s, i) => `shot-${i + 1}-${s.kind}`));
      expect(plan.reduce((sum, s) => sum + s.on_screen_ms, 0)).toBe(ms);
      expect(composeShotPlan(REACT, { durationMs: ms, modesty: HIJAB, personReference: true }).map((s) => s.shot_id)).toEqual(
        plan.map((s) => s.shot_id),
      );
      for (const s of plan) {
        expect(s.video).toEqual(s.kind === 'reaction' ? { model: 'kling-o3-pro', fallback: 'veo-3.1' } : { model: 'seedance-2.0' });
      }
    }
  });

  it('shows a back-to-back plan’s on-screen lengths as the cut plays them (Product Hero 12.5 s: 10 s, then 2.5 s)', () => {
    const plan = composeShotPlan(HERO, { durationMs: 12_500, modesty: COVERED, personReference: false });
    expect(plan.map((s) => [s.kind, s.clip_seconds, s.on_screen_ms])).toEqual([
      ['hero', 10, 10_000],
      ['detail', 5, 2_500],
    ]);
  });

  it('marks the shots that start from a generated frame (Hands-on)', () => {
    const plan = composeShotPlan(HANDS, { durationMs: 9_000, modesty: COVERED, vars: handsVars, personReference: false });
    expect(plan.map((s) => [s.kind, s.starting_frame])).toEqual([
      ['hands', 'product_in_hands'],
      ['product', null],
    ]);
  });

  it('puts the Product Interaction in hands and person scenes only', () => {
    const react = composeShotPlan(REACT, { durationMs: 9_000, modesty: HIJAB, interaction: PERFUME, personReference: true });
    expect(react[0].scene).toContain(`How the product is used, as a real person uses it: ${PERFUME}.`);
    expect(react[1].scene).not.toContain(PERFUME);
    const hands = composeShotPlan(HANDS, { durationMs: 9_000, modesty: COVERED, vars: handsVars, interaction: PERFUME, personReference: false });
    expect(hands[0].scene).toContain(PERFUME);
    expect(hands[1].scene).not.toContain(PERFUME);
  });
});

describe('the default Shot Prompts say what today’s prompts said', () => {
  it('Product Hero: the exact product in @image1, nobody on screen, no text, 9:16', () => {
    const [hero, detail] = composeShotPlan(HERO, { durationMs: 12_500, modesty: COVERED, personReference: false }).map((s) => shotPrompt(s, EVOLINK));
    expect(hero).toBe(
      'The product is exactly the product in @image1: it keeps its exact shape, colours, logo and label text. ' +
        'Premium product commercial, hero shot of the product: it stands centered on a clean, softly lit surface, the camera slowly pushes in and orbits a few degrees, gentle rim light glides across its surfaces. Shallow depth of field, smooth cinematic motion. ' +
        `${NO_PEOPLE} ${FORMAT}`,
    );
    expect(detail).toMatch(/macro slide/);
    for (const p of [hero, detail]) {
      expect(p).not.toMatch(/Modest styling|never speaks|@image2/);
      expect(p).not.toContain(AUDIO_OFF); // enforced by the request, not prompt text
    }
  });

  it('Reaction: the character in @image2, the product in @image1, silent, modest; the product shot has nobody', () => {
    const [reaction, product] = composeShotPlan(REACT, { durationMs: 9_000, modesty: HIJAB, personReference: true }).map((s) => shotPrompt(s, EVOLINK));
    expect(reaction.startsWith('The person is exactly the person in @image2: identical face, hair, skin and features. The product is exactly the product in @image1')).toBe(true);
    expect(reaction).toContain('reacts to it silently with ONE natural reaction');
    expect(reaction).toContain(NO_SPEAKING_PERSON);
    expect(reaction).toContain(MODESTY_PROMPTS.person.covered);
    expect(reaction.endsWith(`${MODESTY_PROMPTS.hijab} ${FORMAT}`)).toBe(true);
    expect(product).toContain(NO_PEOPLE);
    expect(product).not.toMatch(/@image2|never speaks|Modest styling/);
  });

  it('Hands-on: starts from the frame in @image1, hands only, modest arms, the setting and hands words filled', () => {
    const [hands, product] = composeShotPlan(HANDS, { durationMs: 9_000, modesty: COVERED, vars: handsVars, personReference: false }).map((s) =>
      shotPrompt(s, EVOLINK),
    );
    expect(hands.startsWith('The video starts exactly from the frame in @image1')).toBe(true);
    expect(hands).toContain("a woman's hands with neat, natural nails lift the product");
    expect(hands).toContain(`${HANDS_ONLY} ${MODESTY_PROMPTS.hands.covered} ${FORMAT}`);
    expect(product).toContain('standing on a clean surface at an elegant dressing table');
    expect(product).toContain(NO_PEOPLE);
    expect(product).not.toMatch(/Modest styling/);
  });

  it('names no person reference where no person image goes with the shot', () => {
    const [reaction] = composeShotPlan(REACT, { durationMs: 9_000, modesty: COVERED, personReference: false });
    expect(reaction.guardrails.map((g) => g.id)).not.toContain('person_reference');
  });

  it('leaves the reference tokens for the provider adapter, and names the images in plain words for the user', () => {
    const [reaction] = composeShotPlan(REACT, { durationMs: 9_000, modesty: COVERED, personReference: true });
    expect(shotPrompt(reaction, REFERENCE_TOKENS)).toContain(REFERENCE_TOKENS.person);
    const shown = shotPrompt(reaction, displayReferences(false));
    expect(shown).toContain('the character’s photo');
    expect(shown).toContain('the product photo');
    expect(shown).not.toMatch(/@image|\{\{/);
  });
});

describe('scene edits', () => {
  const ctx = { durationMs: 9_000, modesty: HIJAB, personReference: true };

  it('replace only the scene: every Guardrail stays, in place, even when the edit leaves them all out', () => {
    const plain = composeShotPlan(REACT, ctx);
    const edited = composeShotPlan(REACT, ctx, { 'shot-1-reaction': '  The person   sniffs the product and smiles. ' });
    expect(edited[0].scene).toBe('The person sniffs the product and smiles.');
    expect(edited[0].edited).toBe(true);
    expect(edited[0].guardrails).toEqual(plain[0].guardrails);
    const prompt = shotPrompt(edited[0], EVOLINK);
    for (const line of [NO_SPEAKING_PERSON, MODESTY_PROMPTS.person.covered, MODESTY_PROMPTS.hijab, FORMAT, '@image1', '@image2']) {
      expect(prompt).toContain(line);
    }
    expect(prompt.indexOf('sniffs')).toBeLessThan(prompt.indexOf(NO_SPEAKING_PERSON));
    expect(edited[1]).toEqual(plain[1]);
    expect(effectiveEdits(edited)).toEqual({ 'shot-1-reaction': 'The person sniffs the product and smiles.' });
  });

  it('an edit equal to the Preset’s scene is no edit', () => {
    const plain = composeShotPlan(REACT, ctx);
    const same = composeShotPlan(REACT, ctx, { 'shot-1-reaction': plain[0].default_scene });
    expect(same[0].edited).toBe(false);
    expect(effectiveEdits(same)).toEqual({});
  });

  it('refuses an edit that contradicts a Guardrail, with SHOT_EDIT_BREAKS_GUARDRAIL', () => {
    for (const [text, guardrail] of [
      ['She talks to the camera about the scent.', 'speech'],
      ['The person, no headscarf, smiles at the bottle.', 'hijab'],
      ['She takes off her hijab and smiles.', 'hijab'],
      ['Bare arms reaching for the bottle.', 'exposed'],
      ['تتكلم عن العطر', 'speech'],
    ] as const) {
      let err: unknown;
      try {
        composeShotPlan(REACT, ctx, { 'shot-1-reaction': text });
      } catch (e) {
        err = e;
      }
      expect(err, text).toBeInstanceOf(ShotEditError);
      expect((err as ShotEditError).code).toBe('SHOT_EDIT_BREAKS_GUARDRAIL');
      expect((err as ShotEditError).guardrail).toBe(guardrail);
      expect((err as ShotEditError).shotId).toBe('shot-1-reaction');
    }
  });

  it('refuses a shot the plan does not have, and text that cannot be a scene, with SHOT_EDIT_INVALID', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ 'shot-9-reaction': 'The person smiles.' }, 'unknown_shot'],
      [{ 'shot-2-reaction': 'The person smiles.' }, 'unknown_shot'], // shot 2 is a product shot
      [{ 'shot-1-reaction': '   ' }, 'empty'],
      [{ 'shot-1-reaction': 42 }, 'not_text'],
      [{ 'shot-1-reaction': 'x'.repeat(SCENE_TEXT_MAX_CHARS + 1) }, 'too_long'],
      [{ 'shot-1-reaction': '[excited] The person smiles.' }, 'brackets'],
      [{ 'shot-1-reaction': 'The person in {person} smiles.' }, 'brackets'],
      [{ 'shot-1-reaction': 'The person in @image2 smiles.' }, 'reference_syntax'],
      [{ 'shot-1-reaction': 'The woman from the second reference image smiles.' }, 'reference_syntax'],
    ];
    for (const [edits, reason] of cases) {
      let err: unknown;
      try {
        composeShotPlan(REACT, ctx, edits);
      } catch (e) {
        err = e;
      }
      expect(err, JSON.stringify(edits).slice(0, 60)).toBeInstanceOf(ShotEditError);
      expect((err as ShotEditError).code).toBe('SHOT_EDIT_INVALID');
      expect((err as ShotEditError).reason).toBe(reason);
    }
  });
});

describe('every default scene is a scene the user could have written', () => {
  it('passes the scene check and fits the cap, for every Preset, hands and setting, with the longest Product Interaction', () => {
    const longest = `removes the cap, ${'sprays once on the wrist, '.repeat(20)}`.slice(0, PRODUCT_INTERACTION_MAX_CHARS);
    const modesties: Modesty[] = [COVERED, HIJAB, { arms: 'sleeved', hijab: true }];
    const plans = [
      ...[5_000, 15_000].flatMap((ms) => [
        composeShotPlan(HERO, { durationMs: ms, modesty: COVERED, personReference: false }),
        ...modesties.map((m) => composeShotPlan(REACT, { durationMs: ms, modesty: m, interaction: longest, personReference: true })),
      ]),
      ...HAND_GENDERS.flatMap((g) =>
        HANDS_ON_SETTINGS.map((setting) =>
          composeShotPlan(HANDS, {
            durationMs: 15_000,
            modesty: COVERED,
            vars: HANDS_ON_PROMPTS.promptVars!({ hand_gender: g, setting }),
            interaction: longest,
            personReference: false,
          }),
        ),
      ),
    ];
    for (const shot of plans.flat()) {
      expect(sceneTextProblem(shot.default_scene), shot.default_scene).toBeNull();
      expect(shot.default_scene.length).toBeLessThanOrEqual(SCENE_TEXT_MAX_CHARS);
    }
  });
});
