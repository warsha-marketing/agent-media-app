// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The Shot Plan (#26, #28): shot ids that do not
// depend on a shot's position, each shot's structured fields composed in a
// fixed order, the Guardrails every shot keeps per stage whatever its fields
// say, and the check that refuses an edit that cannot render. The default
// prompts themselves are pinned by golden.test.ts.

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
  type PresetDefinition,
} from '@agentmedia/schema';
import {
  AUDIO_OFF,
  FORMAT,
  FORMAT_FRAME,
  HANDS_ONLY,
  HANDS_ONLY_FRAME,
  HANDS_ON_PROMPTS,
  IMAGE_REFERENCES,
  MODESTY_PROMPTS,
  NO_PEOPLE,
  NO_SPEAKING_PERSON,
  PRODUCT_HERO_PROMPTS,
  REACTION_PROMPTS,
  REFERENCE_TOKENS,
  CAMERA_MOVES,
  ENERGY_WORDS,
  SHOT_ENERGIES,
  SHOT_FIELDS,
  SHOT_FIELD_MAX_CHARS,
  SIMPLE_PHYSICS,
  REALISM,
  PERSON_DESCRIPTION_MAX_CHARS,
  ShotEditError,
  cleanPersonDescription,
  personDescriptionLine,
  personWordsOf,
  composeFields,
  composeShotPlan,
  displayReferences,
  effectiveEdits,
  fillPrompt,
  presetPrompts,
  productInteractionAction,
  shotFieldProblem,
  shotHasPersonReference,
  shotIds,
  shotPrompt,
  type ReferenceWords,
  type ShotFields,
  type ShotPlanPreset,
} from '../index.js';

const HERO: ShotPlanPreset = { ...PRODUCT_HERO, ...PRODUCT_HERO_PROMPTS } as ShotPlanPreset;
const REACT: ShotPlanPreset = { ...REACTION, ...REACTION_PROMPTS } as ShotPlanPreset;
const HANDS: ShotPlanPreset = { ...HANDS_ON, ...HANDS_ON_PROMPTS } as ShotPlanPreset;
const EVOLINK: ReferenceWords = { start: '@image1', person: '@image2' };
const COVERED: Modesty = { arms: 'covered', hijab: false };
const HIJAB: Modesty = { arms: 'covered', hijab: true };
const PERFUME = 'holds the uncapped bottle, sprays once on the inner wrist, sets the bottle down, then raises the wrist to the nose and smiles';
/** The shots of a composed plan. */
const shotsOf = (...args: Parameters<typeof composeShotPlan>) => composeShotPlan(...args).shots;
const handsVars = HANDS_ON_PROMPTS.promptVars!({ hand_gender: 'female', setting: 'dressing_table' });

function refusal(fn: () => unknown): ShotEditError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ShotEditError) return e;
    throw e;
  }
  throw new Error('expected a ShotEditError');
}

describe('the Preset prompt registry', () => {
  it('has the wording of every Preset, by its id', () => {
    expect(presetPrompts(PRODUCT_HERO.id)).toBe(PRODUCT_HERO_PROMPTS);
    expect(presetPrompts(REACTION.id)).toBe(REACTION_PROMPTS);
    expect(presetPrompts(HANDS_ON.id)).toBe(HANDS_ON_PROMPTS);
    expect(() => presetPrompts('nope')).toThrow(/no prompts/);
  });

  it('gives every shot kind of every Preset a scene, and a frame scene to every kind that starts from a frame', () => {
    for (const p of [HERO, REACT, HANDS]) {
      for (const [kind, def] of Object.entries(p.shotKinds)) {
        expect(p.shots[kind]?.scene, `${p.id} ${kind}`).toBeTruthy();
        expect(Boolean(p.frameScenes?.[kind]), `${p.id} ${kind} frame`).toBe(Boolean(def.frame));
      }
    }
  });
});

describe('the Preset defaults (the simple_physics Guardrail, one main action, the realism Guardrail)', () => {
  /** Every default text of the shots that show hands or a person, frame scenes included, filled with every Preset input. */
  const peopleTexts = (): Array<[string, string]> => {
    const out: Array<[string, string]> = [];
    for (const p of [HERO, REACT, HANDS]) {
      const varsList = p.promptVars
        ? HAND_GENDERS.flatMap((hand_gender) => HANDS_ON_SETTINGS.map((setting) => p.promptVars!({ hand_gender, setting })))
        : [{}];
      for (const [kind, def] of Object.entries(p.shotKinds)) {
        if (def.shows === 'product') continue;
        for (const vars of varsList) {
          for (const [field, text] of Object.entries(p.shots[kind])) {
            if (typeof text === 'string' && field !== 'energy') out.push([`${p.id} ${kind}.${field}`, fillPrompt(text, vars)]);
          }
          const frame = p.frameScenes?.[kind];
          if (frame) out.push([`${p.id} ${kind} frame`, fillPrompt(frame, vars)]);
        }
      }
    }
    return out;
  };

  it('start hands and person shots from the product already out of its packaging and in its used state: nothing unpacked or taken off on camera', () => {
    const texts = peopleTexts();
    expect(texts.length).toBeGreaterThan(10);
    for (const [where, text] of texts) {
      expect(text, where).not.toMatch(/\b(?:lift\w*|tak\w*|pull\w*)\b[^.]*\b(?:out of|clear of|from)\b[^.]*packag/i);
      expect(text, where).not.toMatch(/\b(?:unpack\w*|unbox\w*|unwrap\w*|remov\w*|uncap\w*|unscrew\w*|open(?:s|ing)?\b)/i);
    }
    expect(HANDS.frameScenes!.hands).toMatch(/already out of (?:its|any) packaging/);
    expect(HANDS.shots.hands.scene).toMatch(/already out of its packaging and in the state it is used in/);
  });

  it('give a hands shot one main action: the hands use the product once', () => {
    const hands = shotsOf(HANDS, { durationMs: 9_000, modesty: COVERED, vars: handsVars })[0];
    expect(hands.default_fields.scene).toMatch(/use it once/);
    expect(hands.default_fields.scene).not.toMatch(/turn it|a few angles|lift/);
  });

  it('never bring the product to a reacting face; a smell beat is on the skin, after the product is set down', () => {
    const reaction = REACT.shots.reaction;
    const all = Object.values(reaction).join(' ');
    expect(all).not.toMatch(/(?<!never )near (?:their|her|his|the) face/i);
    expect(reaction.blocking).toMatch(/never (?:near|brought to) the face/i);
    expect(all).toMatch(/sets? the product down[^.]*(?:wrist|skin)/i);
    expect(all).not.toMatch(/enjoying the scent/i);
  });

  it('carry no cinematic wording on a hands or person shot (the realism Guardrail, ADR 0003)', () => {
    for (const [where, text] of peopleTexts()) {
      expect(text, where).not.toMatch(/shallow depth of field|cinematic|bokeh|golden[\s-]hour|softly blurred|warm lamplight|flattering light/i);
    }
  });
});

describe('shot ids', () => {
  it('are the shot’s role from the Preset data, with an occurrence suffix only when a role repeats', () => {
    expect(shotIds(['reaction', 'product-cutaway', 'reaction', 'product-closer'])).toEqual(['reaction', 'product-cutaway', 'reaction-2', 'product-closer']);
    expect(shotIds(['hero', 'detail'])).toEqual(['hero', 'detail']);
    expect(shotsOf(REACT, { durationMs: 12_000, modesty: HIJAB }).map((s) => s.shot_id)).toEqual(['reaction', 'product-cutaway', 'reaction-2', 'product-closer']);
    expect(shotsOf(HANDS, { durationMs: 9_000, modesty: COVERED, vars: handsVars }).map((s) => s.shot_id)).toEqual(['hands-use', 'product-closer']);
    expect(shotsOf(HERO, { durationMs: 12_500, modesty: COVERED }).map((s) => s.shot_id)).toEqual(['hero', 'detail']);
  });

  it('are the priced plan’s shots, one id each, the same on every composition', () => {
    for (const ms of [5_000, 9_000, 12_500, 15_000]) {
      const plan = shotsOf(REACT, { durationMs: ms, modesty: HIJAB });
      const priced = planPresetShots(REACTION, ms);
      expect(plan.map((s) => s.kind)).toEqual(priced.map((s) => s.kind));
      expect(plan.map((s) => s.shot_id)).toEqual(shotIds(priced.map((s) => s.role)));
      expect(new Set(plan.map((s) => s.shot_id)).size).toBe(plan.length);
      expect(plan.reduce((sum, s) => sum + s.on_screen_ms, 0)).toBe(ms);
      expect(shotsOf(REACT, { durationMs: ms, modesty: HIJAB }).map((s) => s.shot_id)).toEqual(plan.map((s) => s.shot_id));
    }
  });

  // Two reaction shots with their own roles: a Playbook splitting spray and smell (#32).
  const withOrder = (order: ReadonlyArray<{ role: string; kind: string }>) =>
    ({ ...REACT, shotPlan: { ...REACT.shotPlan, order, last: { role: 'product-closer', kind: 'product' } } }) as ShotPlanPreset;
  const SPRAY = { role: 'reaction-spray', kind: 'reaction' };
  const SMELL = { role: 'reaction-smell', kind: 'reaction' };
  const CUTAWAY = { role: 'product-cutaway', kind: 'product' };
  const SPRAY_EDIT = 'The person sprays the inner wrist once and smiles.';
  const edit = { 'reaction-spray': { scene: SPRAY_EDIT } };
  const byId = (plan: ReturnType<typeof shotsOf>, id: string) => plan.find((s) => s.shot_id === id)!;

  it('keep an edit on its shot when the Preset inserts another shot of the same kind before it', () => {
    const before = shotsOf(withOrder([SPRAY, CUTAWAY]), { durationMs: 9_000, modesty: HIJAB }, edit);
    const after = shotsOf(withOrder([SMELL, SPRAY, CUTAWAY]), { durationMs: 14_000, modesty: HIJAB }, edit);
    expect(before.map((s) => s.shot_id)).toEqual(['reaction-spray', 'product-closer']);
    expect(after.map((s) => s.shot_id)).toEqual(['reaction-smell', 'reaction-spray', 'product-closer']);
    expect(byId(before, 'reaction-spray').fields.scene).toBe(SPRAY_EDIT);
    expect(byId(after, 'reaction-spray').fields.scene).toBe(SPRAY_EDIT);
    expect(byId(after, 'reaction-spray').index).toBe(1);
    expect(byId(after, 'reaction-smell').edited).toBe(false);
  });

  it('keep an edit on its shot when the Preset swaps two shots of the same kind', () => {
    const sprayFirst = shotsOf(withOrder([SPRAY, SMELL, CUTAWAY]), { durationMs: 14_000, modesty: HIJAB }, edit);
    const smellFirst = shotsOf(withOrder([SMELL, SPRAY, CUTAWAY]), { durationMs: 14_000, modesty: HIJAB }, edit);
    expect(sprayFirst.map((s) => s.shot_id)).toEqual(['reaction-spray', 'reaction-smell', 'product-closer']);
    expect(smellFirst.map((s) => s.shot_id)).toEqual(['reaction-smell', 'reaction-spray', 'product-closer']);
    for (const plan of [sprayFirst, smellFirst]) {
      expect(byId(plan, 'reaction-spray').fields.scene).toBe(SPRAY_EDIT);
      expect(byId(plan, 'reaction-smell').edited).toBe(false);
    }
    expect(effectiveEdits({ set: null, playbook: null, shots: sprayFirst })).toEqual(effectiveEdits({ set: null, playbook: null, shots: smellFirst }));
  });

  it('keep an edit on its shot when a Preset reorders shots of other kinds', () => {
    const productFirst = withOrder([CUTAWAY, SPRAY]);
    const before = shotsOf(withOrder([SPRAY, CUTAWAY]), { durationMs: 14_000, modesty: HIJAB }, edit);
    const after = shotsOf(productFirst, { durationMs: 14_000, modesty: HIJAB }, edit);
    expect(before.map((s) => s.shot_id)).toEqual(['reaction-spray', 'product-cutaway', 'reaction-spray-2', 'product-closer']);
    expect(after.map((s) => s.shot_id)).toEqual(['product-cutaway', 'reaction-spray', 'product-cutaway-2', 'product-closer']);
    expect(byId(after, 'reaction-spray').fields.scene).toBe(SPRAY_EDIT);
    expect(byId(after, 'reaction-spray').kind).toBe('reaction');
  });
});

describe('composeShotPlan', () => {
  it('gives every shot its kind, length, model and fallback', () => {
    const plan = shotsOf(REACT, { durationMs: 12_000, modesty: HIJAB });
    for (const s of plan) {
      expect(s.video).toEqual(
        s.kind === 'reaction' ? { model: 'modelark-seedance-2.0-mini', fallback: ['kling-o3-pro', 'veo-3.1'] } : { model: 'seedance-2.0', fallback: [] },
      );
      // Every model of the chain has its own video-stage Guardrails; the model's are the shot's.
      expect(Object.keys(s.video_guardrails_by_model)).toEqual(
        s.kind === 'reaction' ? ['modelark-seedance-2.0-mini', 'kling-o3-pro', 'veo-3.1'] : ['seedance-2.0'],
      );
      expect(s.video_guardrails_by_model[s.video.model]).toEqual(s.guardrails.video);
      expect(s.clip_seconds).toBe(5);
    }
  });

  it('shows a back-to-back plan’s on-screen lengths as the cut plays them (Product Hero 12.5 s: 10 s, then 2.5 s)', () => {
    const plan = shotsOf(HERO, { durationMs: 12_500, modesty: COVERED });
    expect(plan.map((s) => [s.kind, s.clip_seconds, s.on_screen_ms, s.planned_on_screen_ms])).toEqual([
      ['hero', 10, 10_000, null],
      ['detail', 5, 2_500, null],
    ]);
    const shared = shotsOf(REACT, { durationMs: 9_000, modesty: COVERED });
    expect(shared.map((s) => s.planned_on_screen_ms)).toEqual([4_500, 4_500]);
  });

  it('marks the shots that start from a generated frame (Hands-on), with the frame’s own scene', () => {
    const plan = shotsOf(HANDS, { durationMs: 9_000, modesty: COVERED, vars: handsVars });
    expect(plan.map((s) => [s.kind, s.starting_frame])).toEqual([
      ['hands', 'product_in_hands'],
      ['product', null],
    ]);
    expect(plan[0].frame_scene).toContain("a woman's hands with neat, natural nails");
    expect(plan[1].frame_scene).toBeNull();
  });

  it('puts the Product Interaction in the action of hands and person shots only', () => {
    const react = shotsOf(REACT, { durationMs: 9_000, modesty: HIJAB, interaction: PERFUME });
    expect(react[0].fields.action).toBe(`How the product is used, as a real person uses it: ${PERFUME}.`);
    expect(react[1].fields.action).toBe('');
    const hands = shotsOf(HANDS, { durationMs: 9_000, modesty: COVERED, vars: handsVars, interaction: PERFUME });
    expect(hands[0].fields.action).toContain(PERFUME);
    expect(hands[1].fields.action).toBe('');
    const none = shotsOf(REACT, { durationMs: 9_000, modesty: HIJAB });
    expect(none[0].fields.action).toBe('');
  });

  it('fills every field of every shot, and the defaults are the fields until edited', () => {
    const plan = shotsOf(HANDS, { durationMs: 9_000, modesty: COVERED, vars: handsVars, interaction: PERFUME });
    for (const s of plan) {
      expect(Object.keys(s.fields)).toEqual([...SHOT_FIELDS]);
      expect(s.fields).toEqual(s.default_fields);
      expect(s.edited_fields).toEqual([]);
      expect(JSON.stringify(s.fields)).not.toMatch(/\{[a-z_]+\}/); // every placeholder filled
    }
  });

  it('keeps the body’s performance apart from the product action (Reaction: the silent reaction is the performance)', () => {
    const [reaction, product] = shotsOf(REACT, { durationMs: 9_000, modesty: HIJAB, interaction: PERFUME });
    expect(reaction.fields.performance).toMatch(/react silently with ONE natural reaction/);
    expect(reaction.fields.action).toContain(PERFUME);
    expect(product.fields.performance).toBe('');
  });

  it('gives every shot an energy: calm product shots, natural people', () => {
    const energies = (p: ShotPlanPreset, extra = {}) =>
      shotsOf(p, { durationMs: 9_000, modesty: COVERED, ...extra }).map((s) => [s.kind, s.fields.energy]);
    expect(energies(HERO, { durationMs: 12_500 })).toEqual([['hero', 'calm'], ['detail', 'calm']]);
    expect(energies(REACT)).toEqual([['reaction', 'natural'], ['product', 'calm']]);
    expect(energies(HANDS, { vars: handsVars })).toEqual([['hands', 'natural'], ['product', 'calm']]);
  });

  it('references the Short’s Set by id, on the plan and every shot, and never as location text of its own', () => {
    const none = composeShotPlan(REACT, { durationMs: 9_000, modesty: COVERED });
    expect(none.set).toBeNull();
    expect(none.shots.every((s) => s.set_id === null)).toBe(true);
    const withSet = composeShotPlan(REACT, { durationMs: 9_000, modesty: COVERED, set: { set_id: 'gulf-majlis-01' } });
    expect(withSet.set).toEqual({ set_id: 'gulf-majlis-01' });
    expect(withSet.shots.map((s) => s.set_id)).toEqual(['gulf-majlis-01', 'gulf-majlis-01']);
    expect(withSet.shots.map((s) => shotPrompt(s, 'video', EVOLINK))).toEqual(none.shots.map((s) => shotPrompt(s, 'video', EVOLINK)));
  });
});

describe('the person reference', () => {
  it('goes with a person shot of a Preset that takes a character, and nothing else', () => {
    expect(shotHasPersonReference(REACTION, 'reaction')).toBe(true);
    expect(shotHasPersonReference(REACTION, 'product')).toBe(false);
    expect(shotHasPersonReference(HANDS_ON, 'hands')).toBe(false);
    const noCharacter = { ...REACTION, requiredInputs: ['product_image'] } as PresetDefinition;
    expect(shotHasPersonReference(noCharacter, 'reaction')).toBe(false);
  });

  it('decides the person_reference Guardrail, per model (ADR 0003: never a re-hosted face on ModelArk)', () => {
    const [reaction] = shotsOf(REACT, { durationMs: 9_000, modesty: COVERED });
    const ids = (m: 'modelark-seedance-2.0-mini' | 'kling-o3-pro' | 'veo-3.1') => reaction.video_guardrails_by_model[m]!.map((g) => g.id);
    expect(ids('modelark-seedance-2.0-mini')).not.toContain('person_reference');
    expect(ids('kling-o3-pro')).toContain('person_reference');
    expect(ids('veo-3.1')).toContain('person_reference');
    const noCharacter = { ...REACT, requiredInputs: ['product_image'] } as ShotPlanPreset;
    const [bare] = shotsOf(noCharacter, { durationMs: 9_000, modesty: COVERED });
    for (const list of Object.values(bare.video_guardrails_by_model)) expect(list!.map((g) => g.id)).not.toContain('person_reference');
  });

  it('sends the face to ModelArk only when it is the same account’s own output', () => {
    expect(shotHasPersonReference(REACTION, 'reaction', 'modelark-seedance-2.0-mini')).toBe(false);
    expect(shotHasPersonReference(REACTION, 'reaction', 'modelark-seedance-2.0-mini', 'rehosted')).toBe(false);
    expect(shotHasPersonReference(REACTION, 'reaction', 'modelark-seedance-2.0-mini', 'modelark_output')).toBe(true);
    expect(shotHasPersonReference(REACTION, 'reaction', 'kling-o3-pro')).toBe(true);
    expect(shotHasPersonReference(REACTION, 'product', 'kling-o3-pro')).toBe(false);
    const [trusted] = shotsOf(REACT, { durationMs: 9_000, modesty: COVERED, personImage: 'modelark_output' });
    expect(trusted.guardrails.video.map((g) => g.id)).toContain('person_reference');
  });
});

describe('the person in words (ADR 0003: a shot whose model does not take the face)', () => {
  const WOMAN = { gender: 'female', description: 'Gulf woman in her late twenties, warm brown eyes, light makeup' } as const;

  it('describes the saved character on the ModelArk attempt, and pins the face on the fallback', () => {
    const [reaction, product] = shotsOf(REACT, { durationMs: 9_000, modesty: HIJAB, person: WOMAN });
    const ark = reaction.guardrails.video.find((g) => g.id === 'person_description');
    expect(ark).toMatchObject({ at: 'before_scene' });
    expect(ark!.text).toBe('The person is a woman: Gulf woman in her late twenties, warm brown eyes, light makeup. The same person in every shot.');
    const onArk = shotPrompt(reaction, 'video', REFERENCE_TOKENS);
    expect(onArk).not.toContain(REFERENCE_TOKENS.person);
    expect(onArk).toContain(MODESTY_PROMPTS.hijab);
    const onKling = shotPrompt(reaction, 'video', REFERENCE_TOKENS, 'kling-o3-pro');
    expect(onKling).toContain(REFERENCE_TOKENS.person);
    expect(onKling).not.toContain(ark!.text);
    expect(product.guardrails.video.map((g) => g.id)).not.toContain('person_description');
  });

  it('reads the person from a render input’s fields, one way for api-v2 and the worker (personWordsOf)', () => {
    expect(personWordsOf({ character_gender: 'female', character_description: 'Gulf woman, late twenties' })).toEqual({
      gender: 'female',
      description: 'Gulf woman, late twenties',
    });
    expect(personWordsOf({})).toEqual({ gender: null, description: null });
    expect(personWordsOf({ character_gender: 'robot', character_description: 42 })).toEqual({ gender: null, description: null });
    expect(personWordsOf(null)).toEqual({ gender: null, description: null });
  });

  it('says only the gender when the character has no usable description', () => {
    expect(personDescriptionLine({ gender: 'male' })).toBe('The person is a man, an ordinary real person, the same in every shot.');
    expect(personDescriptionLine({ gender: 'female', description: 'takes off her hijab and smiles' })).toBe(
      'The person is a woman, an ordinary real person, the same in every shot.',
    );
    expect(personDescriptionLine(null)).toBeNull();
    expect(personDescriptionLine({})).toBeNull();
  });

  it('cleans the user’s description: no syntax, no Guardrail breaks, capped at a word', () => {
    expect(cleanPersonDescription('  a man [smiling] with @image2 {{x}}  a beard.  ')).toBe('a man smiling with image2 x a beard');
    expect(cleanPersonDescription('she talks to the camera')).toBeNull();
    expect(cleanPersonDescription('with bare arms')).toBeNull();
    expect(cleanPersonDescription('   ')).toBeNull();
    const long = cleanPersonDescription('word '.repeat(200))!;
    expect(long.length).toBeLessThanOrEqual(PERSON_DESCRIPTION_MAX_CHARS);
    expect(long.endsWith('word')).toBe(true);
  });

  it('refuses a model the shot does not render on', () => {
    const [reaction] = shotsOf(REACT, { durationMs: 9_000, modesty: COVERED });
    expect(() => shotPrompt(reaction, 'video', REFERENCE_TOKENS, 'seedance-2.0')).toThrow(/does not render on/);
  });
});

describe('the realism Guardrail (ADR 0003, #29)', () => {
  it('is on every person and hands shot, both stages, and never on a product shot', () => {
    const plans = [
      shotsOf(REACT, { durationMs: 12_000, modesty: HIJAB }),
      shotsOf(HANDS, { durationMs: 12_000, modesty: COVERED, vars: handsVars }),
      shotsOf(HERO, { durationMs: 12_000, modesty: COVERED }),
    ];
    let people = 0;
    for (const s of plans.flat()) {
      const stages = [...Object.values(s.video_guardrails_by_model), s.guardrails.image].filter((l) => l!.length > 0);
      for (const list of stages) {
        const has = list!.some((g) => g.id === 'realism' && g.text === REALISM && g.at === 'after_scene');
        expect(has, `${s.shot_id}`).toBe(s.shows !== 'product');
      }
      const video = shotPrompt(s, 'video', EVOLINK);
      if (s.shows === 'product') expect(video, s.shot_id).not.toContain(REALISM);
      else {
        people += 1;
        expect(video, s.shot_id).toContain(REALISM);
      }
    }
    expect(people).toBeGreaterThan(0);
  });

  it('says the look the owner accepted: raw phone video, flat light, sharp background, matte skin with pores, no beauty filter', () => {
    for (const words of ['Raw unedited iPhone', 'not cinematic', 'flat soft everyday light', 'no bokeh', 'visible pores', 'no beauty filter', 'no waxy']) {
      expect(REALISM).toContain(words);
    }
  });

  it('is on the hands frame too (the image stage)', () => {
    const [hands] = shotsOf(HANDS, { durationMs: 9_000, modesty: COVERED, vars: handsVars });
    expect(shotPrompt(hands, 'image', IMAGE_REFERENCES)).toContain(REALISM);
  });
});

describe('fields compose in a fixed order', () => {
  const fields: ShotFields = {
    framing: 'medium close-up',
    scene: 'the person smiles at the product',
    blocking: 'the product is held near the face.',
    environment_interaction: 'she leans on the counter',
    performance: 'she turns to the camera and raises her eyebrows',
    action: 'she sprays once on the wrist!',
    energy: 'lively',
    camera_move: 'handheld follow, then a quick push-in',
    lens_feel: '',
    lighting: 'flat daylight',
  };

  it('framing, scene, blocking, environment interaction, performance, action, energy, camera move, lens feel, lighting — each a sentence, empty ones left out', () => {
    expect(composeFields(fields)).toBe(
      'Medium close-up. The person smiles at the product. The product is held near the face. She leans on the counter. ' +
        'She turns to the camera and raises her eyebrows. She sprays once on the wrist! ' +
        `${ENERGY_WORDS.lively} Handheld follow, then a quick push-in. Flat daylight.`,
    );
  });

  it('says every energy, and the lively one keeps the hands simple', () => {
    for (const e of SHOT_ENERGIES) expect(composeFields({ ...fields, energy: e })).toContain(ENERGY_WORDS[e]);
    expect(ENERGY_WORDS.lively).toMatch(/hands keep one simple action/);
  });

  it('can name every camera move of the vocabulary: handheld follow, quick push-in, whip to the product, orbit, …', () => {
    for (const id of ['handheld_follow', 'quick_push_in', 'whip_to_product', 'orbit'] as const) expect(CAMERA_MOVES[id]).toBeTruthy();
    for (const words of Object.values(CAMERA_MOVES)) {
      expect(shotFieldProblem('camera_move', words), words).toBeNull();
      expect(composeFields({ ...fields, camera_move: words })).toContain(words);
    }
  });

  it('is the same whatever order the fields are given in', () => {
    const shuffled = Object.fromEntries(Object.entries(fields).reverse()) as ShotFields;
    expect(composeFields(shuffled)).toBe(composeFields(fields));
  });
});

describe('the Guardrails, per stage', () => {
  it('video: the Reaction person shot — references first, then no speaking, modest, hijab, format; audio off on the request', () => {
    const [reaction, product] = shotsOf(REACT, { durationMs: 9_000, modesty: HIJAB, person: { gender: 'female' } });
    // On ModelArk (the shot's model): the person in words, the product reference alone.
    expect(reaction.guardrails.video.map((g) => [g.id, g.at])).toEqual([
      ['person_description', 'before_scene'],
      ['product_reference', 'before_scene'],
      ['realism', 'after_scene'],
      ['no_speaking', 'after_scene'],
      ['simple_physics', 'after_scene'],
      ['modesty', 'after_scene'],
      ['hijab', 'after_scene'],
      ['format', 'after_scene'],
      ['audio_off', 'request'],
    ]);
    // On the Kling fallback: the face.
    expect(reaction.video_guardrails_by_model['kling-o3-pro']!.map((g) => [g.id, g.at])).toEqual([
      ['person_reference', 'before_scene'],
      ['product_reference', 'before_scene'],
      ['realism', 'after_scene'],
      ['no_speaking', 'after_scene'],
      ['simple_physics', 'after_scene'],
      ['modesty', 'after_scene'],
      ['hijab', 'after_scene'],
      ['format', 'after_scene'],
      ['audio_off', 'request'],
    ]);
    expect(reaction.guardrails.image).toEqual([]); // no starting frame, no image stage
    expect(product.guardrails.video.map((g) => g.id)).toEqual(['product_reference', 'no_people', 'format', 'audio_off']);
  });

  it('image: the Hands-on frame keeps the product, hands only, modest arms and no text — never speech or audio', () => {
    const [hands, product] = shotsOf(HANDS, { durationMs: 9_000, modesty: COVERED, vars: handsVars });
    expect(hands.guardrails.image.map((g) => g.id)).toEqual(['product_reference', 'realism', 'hands_only', 'modesty', 'format']);
    expect(hands.guardrails.image.map((g) => g.text)).toEqual([
      expect.stringContaining(REFERENCE_TOKENS.start),
      REALISM,
      HANDS_ONLY_FRAME,
      MODESTY_PROMPTS.hands.covered,
      FORMAT_FRAME,
    ]);
    expect(hands.guardrails.video.map((g) => g.id)).toEqual(['start_frame', 'realism', 'hands_only', 'simple_physics', 'modesty', 'format', 'audio_off']);
    expect(product.guardrails.image).toEqual([]);
    const image = shotPrompt(hands, 'image', IMAGE_REFERENCES);
    expect(image).not.toMatch(/speak|audio/i);
    expect(image).not.toContain(SIMPLE_PHYSICS); // a still does not move
  });

  it('keep hand–object physics simple on every hands and person clip, never on a product shot', () => {
    const plans = [
      shotsOf(REACT, { durationMs: 12_000, modesty: HIJAB }),
      shotsOf(HANDS, { durationMs: 12_000, modesty: COVERED, vars: handsVars }),
      shotsOf(HERO, { durationMs: 12_000, modesty: COVERED }),
    ];
    for (const s of plans.flat()) {
      const video = shotPrompt(s, 'video', EVOLINK);
      if (s.shows === 'product') expect(video, s.shot_id).not.toContain(SIMPLE_PHYSICS);
      else expect(video, s.shot_id).toContain(SIMPLE_PHYSICS);
    }
  });

  it('are appended to every stage’s prompt, the locked lines after the fields', () => {
    const [hands] = shotsOf(HANDS, { durationMs: 9_000, modesty: COVERED, vars: handsVars, interaction: PERFUME });
    const video = shotPrompt(hands, 'video', EVOLINK);
    expect(video.startsWith('The video starts exactly from the frame in @image1')).toBe(true);
    expect(video.endsWith(`${HANDS_ONLY} ${SIMPLE_PHYSICS} ${MODESTY_PROMPTS.hands.covered} ${FORMAT}`)).toBe(true);
    expect(video).not.toContain(AUDIO_OFF); // enforced by the request, not prompt text
    const image = shotPrompt(hands, 'image', IMAGE_REFERENCES);
    expect(image.startsWith('The product is exactly the product in the reference image')).toBe(true);
    expect(image.indexOf(PERFUME)).toBeGreaterThan(-1);
    expect(image.indexOf(PERFUME)).toBeLessThan(image.indexOf(MODESTY_PROMPTS.hands.covered));
    expect(image.endsWith(`${HANDS_ONLY_FRAME} ${MODESTY_PROMPTS.hands.covered} ${FORMAT_FRAME}`)).toBe(true);
  });

  it('a shot with no starting frame has no image prompt', () => {
    const [hero] = shotsOf(HERO, { durationMs: 9_000, modesty: COVERED });
    expect(() => shotPrompt(hero, 'image', IMAGE_REFERENCES)).toThrow(/starting frame/);
  });

  it('leave the reference tokens for the provider adapter, and name the images in plain words for the user', () => {
    const [reaction] = shotsOf(REACT, { durationMs: 9_000, modesty: COVERED });
    expect(shotPrompt(reaction, 'video', REFERENCE_TOKENS, 'kling-o3-pro')).toContain(REFERENCE_TOKENS.person);
    const shown = shotPrompt(reaction, 'video', displayReferences(false), 'kling-o3-pro');
    expect(shown).toContain('the character’s photo');
    expect(shown).toContain('the product photo');
    expect(shown).not.toMatch(/@image|\{\{/);
  });
});

describe('shot edits', () => {
  const ctx = { durationMs: 9_000, modesty: HIJAB, interaction: PERFUME };

  it('replace only the fields they name: every Guardrail stays, in place, even when the edit leaves them all out', () => {
    const plain = shotsOf(REACT, ctx);
    const editedPlan = composeShotPlan(REACT, ctx, {
      'reaction': { scene: '  The person   sniffs the product and smiles. ', lighting: 'Flat, even daylight from a window' },
    });
    const edited = editedPlan.shots;
    expect(edited[0].fields.scene).toBe('The person sniffs the product and smiles.');
    expect(edited[0].fields.lighting).toBe('Flat, even daylight from a window');
    expect(edited[0].fields.framing).toBe(plain[0].fields.framing);
    expect(edited[0].edited_fields).toEqual(['scene', 'lighting']);
    expect(edited[0].edited).toBe(true);
    expect(edited[0].default_fields).toEqual(plain[0].default_fields);
    expect(edited[0].guardrails).toEqual(plain[0].guardrails);
    const prompt = shotPrompt(edited[0], 'video', EVOLINK, 'kling-o3-pro');
    for (const line of [NO_SPEAKING_PERSON, MODESTY_PROMPTS.person.covered, MODESTY_PROMPTS.hijab, FORMAT, '@image1', '@image2']) {
      expect(prompt).toContain(line);
    }
    expect(prompt).toContain('Flat, even daylight from a window.');
    expect(prompt.indexOf('sniffs')).toBeLessThan(prompt.indexOf(NO_SPEAKING_PERSON));
    expect(edited[1]).toEqual(plain[1]);
    expect(effectiveEdits(editedPlan)).toEqual({
      'reaction': { scene: 'The person sniffs the product and smiles.', lighting: 'Flat, even daylight from a window' },
    });
  });

  it('may change the energy and the performance, the lively way', () => {
    const [reaction] = shotsOf(REACT, ctx, {
      'reaction': { energy: 'lively', performance: 'She turns to the camera with a small laugh', camera_move: CAMERA_MOVES.whip_to_product },
    });
    expect(reaction.edited_fields).toEqual(['performance', 'energy', 'camera_move']);
    const prompt = shotPrompt(reaction, 'video', EVOLINK);
    expect(prompt).toContain(`She turns to the camera with a small laugh. ${reaction.fields.action} ${ENERGY_WORDS.lively} ${CAMERA_MOVES.whip_to_product}`);
    expect(prompt).toContain(SIMPLE_PHYSICS);
  });

  it('may clear a field other than the scene', () => {
    const [reaction] = shotsOf(REACT, ctx, { 'reaction': { lens_feel: '  ' } });
    expect(reaction.fields.lens_feel).toBe('');
    expect(reaction.edited_fields).toEqual(['lens_feel']);
    expect(shotPrompt(reaction, 'video', EVOLINK)).not.toMatch(/depth of field/);
  });

  it('an edit equal to the Preset’s field is no edit', () => {
    const plain = shotsOf(REACT, ctx);
    const same = composeShotPlan(REACT, ctx, { 'reaction': { scene: plain[0].default_fields.scene, framing: ` ${plain[0].default_fields.framing} ` } });
    expect(same.shots[0].edited).toBe(false);
    expect(effectiveEdits(same)).toEqual({});
  });

  it('an edited action goes into the starting frame too (Hands-on), past the frame’s Guardrails check', () => {
    const plan = shotsOf(HANDS, { durationMs: 9_000, modesty: COVERED, vars: handsVars, interaction: PERFUME }, {
      'hands-use': { action: 'She pours the coffee into a small cup' },
    });
    expect(shotPrompt(plan[0], 'image', IMAGE_REFERENCES)).toContain('She pours the coffee into a small cup.');
    expect(shotPrompt(plan[0], 'image', IMAGE_REFERENCES)).not.toContain(PERFUME);
  });

  it('refuses an edit that contradicts a Guardrail, in any field, with SHOT_EDIT_BREAKS_GUARDRAIL', () => {
    for (const [field, text, guardrail] of [
      ['scene', 'She talks to the camera about the scent.', 'speech'],
      ['scene', 'The person, no headscarf, smiles at the bottle.', 'hijab'],
      ['action', 'She takes off her hijab and smiles.', 'hijab'],
      ['blocking', 'Bare arms reaching for the bottle.', 'exposed'],
      ['framing', 'تتكلم عن العطر', 'speech'],
      ['performance', 'She laughs and says hello to the camera.', 'speech'],
    ] as const) {
      const err = refusal(() => shotsOf(REACT, ctx, { 'reaction': { [field]: text } }));
      expect(err.code, text).toBe('SHOT_EDIT_BREAKS_GUARDRAIL');
      expect(err.guardrail).toBe(guardrail);
      expect(err.shotId).toBe('reaction');
      expect(err.field).toBe(field);
    }
  });

  it('refuses a shot or field the plan does not have, and text that cannot be a field, with SHOT_EDIT_INVALID', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ 'reaction-9': { scene: 'The person smiles.' } }, 'unknown_shot'],
      [{ 'shot-1-reaction': { scene: 'The person smiles.' } }, 'unknown_shot'], // #26's positional ids are gone
      [{ 'reaction-1': { scene: 'The person smiles.' } }, 'unknown_shot'], // and #28's kind-ordinal ids
      [{ 'reaction': 'The person smiles.' }, 'not_object'], // #26's { shot_id: text } shape
      [{ 'reaction': null }, 'not_object'],
      [{ 'reaction': ['The person smiles.'] }, 'not_object'],
      [{ 'reaction': { model: 'veo-3.1' } }, 'unknown_field'],
      [{ 'reaction': { duration: 10 } }, 'unknown_field'],
      [{ 'reaction': { mood: 'happy' } }, 'unknown_field'],
      [{ 'reaction': { energy: 'frantic' } }, 'not_choice'],
      [{ 'product-closer': { performance: 'She waves.' } }, 'field_not_on_shot'],
      [{ 'product-closer': { action: 'Someone sprays it.' } }, 'field_not_on_shot'],
      [{ 'reaction': { scene: '   ' } }, 'empty'],
      [{ 'reaction': { scene: 42 } }, 'not_text'],
      [{ 'reaction': { scene: 'x'.repeat(SHOT_FIELD_MAX_CHARS.scene + 1) } }, 'too_long'],
      [{ 'reaction': { lighting: 'x'.repeat(SHOT_FIELD_MAX_CHARS.lighting + 1) } }, 'too_long'],
      [{ 'reaction': { scene: '[excited] The person smiles.' } }, 'brackets'],
      [{ 'reaction': { camera_move: 'Push in on {person}.' } }, 'brackets'],
      [{ 'reaction': { scene: 'The person in @image2 smiles.' } }, 'reference_syntax'],
      [{ 'reaction': { blocking: 'The woman from the second reference image holds it.' } }, 'reference_syntax'],
    ];
    for (const [edits, reason] of cases) {
      const err = refusal(() => shotsOf(REACT, ctx, edits));
      expect(err.code, JSON.stringify(edits).slice(0, 60)).toBe('SHOT_EDIT_INVALID');
      expect(err.reason, JSON.stringify(edits).slice(0, 60)).toBe(reason);
    }
  });

  it('checks a field on its own: shotFieldProblem', () => {
    expect(shotFieldProblem('scene', 'The person smiles.')).toBeNull();
    expect(shotFieldProblem('lighting', '')).toBeNull();
    expect(shotFieldProblem('scene', '')?.reason).toBe('empty');
  });
});

describe('every default field is one the user could have written', () => {
  it('passes the field check and fits its cap, for every Preset, hands and setting, with the longest Product Interaction', () => {
    const longest = `holds the uncapped bottle, ${'sprays once on the wrist, '.repeat(20)}`.slice(0, PRODUCT_INTERACTION_MAX_CHARS);
    const modesties: Modesty[] = [COVERED, HIJAB, { arms: 'sleeved', hijab: true }];
    const plans = [
      ...[5_000, 15_000].flatMap((ms) => [
        shotsOf(HERO, { durationMs: ms, modesty: COVERED }),
        ...modesties.map((m) => shotsOf(REACT, { durationMs: ms, modesty: m, interaction: longest })),
      ]),
      ...HAND_GENDERS.flatMap((g) =>
        HANDS_ON_SETTINGS.map((setting) =>
          shotsOf(HANDS, {
            durationMs: 15_000,
            modesty: COVERED,
            vars: HANDS_ON_PROMPTS.promptVars!({ hand_gender: g, setting }),
            interaction: longest,
          }),
        ),
      ),
    ];
    for (const shot of plans.flat()) {
      for (const field of SHOT_FIELDS) {
        expect(shotFieldProblem(field, shot.default_fields[field]), `${shot.shot_id} ${field}`).toBeNull();
      }
    }
  });
});

describe('productInteractionAction (moved from the worker with #28)', () => {
  it('is empty for a product shot, or a draft with none', () => {
    expect(productInteractionAction('product', 'sprays once on the wrist')).toBe('');
    expect(productInteractionAction('person', null)).toBe('');
    expect(productInteractionAction('hands', '   ')).toBe('');
  });

  it('words the action for hands and person shots, tidied, as one sentence', () => {
    for (const subject of ['hands', 'person'] as const) {
      expect(productInteractionAction(subject, '  holds the uncapped bottle,\n sprays once on the inner wrist.  ')).toBe(
        'How the product is used, as a real person uses it: holds the uncapped bottle, sprays once on the inner wrist.',
      );
    }
  });

  it('never carries more than the cap', () => {
    const long = 'a'.repeat(PRODUCT_INTERACTION_MAX_CHARS + 200);
    expect(productInteractionAction('person', long)).toContain('a'.repeat(PRODUCT_INTERACTION_MAX_CHARS));
    expect(productInteractionAction('person', long)).not.toContain('a'.repeat(PRODUCT_INTERACTION_MAX_CHARS + 1));
  });
});
