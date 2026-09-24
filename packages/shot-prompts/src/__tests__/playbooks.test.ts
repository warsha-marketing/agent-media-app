// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Playbooks (#32): five Playbooks as data, each loading only when it fits the
// Presets (kinds, budget) and its own text keeps the Guardrails and its own
// banned motions; the choice by the Product Profile's category, falling back
// to General; banned motions refused in English and Arabic (a negated rule is
// not a break); the Shot Plan's defaults and pattern per Playbook, with its
// negatives on the video stage and the choice recorded; and a Playbook added
// as data alone.

import { describe, it, expect } from 'vitest';
import {
  HANDS_ON,
  PRESETS,
  PRODUCT_HERO,
  REACTION,
  planPresetShots,
  quotePresetCredits,
  type Modesty,
  type ProductProfile,
} from '@agentmedia/schema';
import {
  CATEGORY_PLAYBOOKS,
  ELECTRONICS,
  FOOD_CAFE,
  FRAGRANCE_OUD,
  GENERAL,
  HANDS_ON_PROMPTS,
  PLAYBOOKS,
  PLAYBOOK_REGISTRY,
  PRODUCT_HERO_PROMPTS,
  PlaybookError,
  REACTION_PROMPTS,
  REFERENCE_TOKENS,
  SKINCARE_BEAUTY,
  ShotEditError,
  bannedMotionIssue,
  categoryPlaybooks,
  choosePlaybook,
  composeShotPlan,
  playbookChoice,
  playbookPreset,
  playbookProblems,
  playbookRegistry,
  playbookWriterRules,
  resolvePlaybookChoice,
  shotPrompt,
  type Playbook,
  type ShotPlanPreset,
} from '../index.js';

const REACT: ShotPlanPreset = { ...REACTION, ...REACTION_PROMPTS } as ShotPlanPreset;
const HANDS: ShotPlanPreset = { ...HANDS_ON, ...HANDS_ON_PROMPTS } as ShotPlanPreset;
const HERO: ShotPlanPreset = { ...PRODUCT_HERO, ...PRODUCT_HERO_PROMPTS } as ShotPlanPreset;
const GULF: Modesty = { arms: 'covered', hijab: true };
const handsVars = HANDS_ON_PROMPTS.promptVars!({ hand_gender: 'female', setting: 'dressing_table' });
const PERFUME = 'holds the uncapped bottle, sprays once on the inner wrist, sets the bottle down, then raises the wrist to the nose and smiles';

const profile = (p: Partial<ProductProfile> & Pick<ProductProfile, 'category'>): ProductProfile => ({
  dimensions: { height_cm: null, width_cm: null, volume_ml: null },
  size_class: 'palm',
  parts: [],
  used_state: 'ready to use',
  differs_from_photo: false,
  interaction_verbs: ['hold'],
  grip: 'one hand',
  physics_risks: [],
  confidence: 0.9,
  ...p,
});
const PERFUME_PROFILE = profile({ category: 'fragrance_oud', interaction_verbs: ['spray', 'smell'], physics_risks: ['separate_cap', 'liquid_spray'] });
const OUD_OIL_PROFILE = profile({ category: 'fragrance_oud', interaction_verbs: ['dab', 'smell'] });
const BAKHOOR_PROFILE = profile({ category: 'fragrance_oud', interaction_verbs: ['burn', 'waft'], physics_risks: ['hot_contents'] });
const CREAM_PROFILE = profile({ category: 'skincare_beauty', interaction_verbs: ['scoop', 'apply'] });
const COFFEE_PROFILE = profile({ category: 'food_cafe', interaction_verbs: ['sip'] });
const PHONE_PROFILE = profile({ category: 'electronics', interaction_verbs: ['tap'], physics_risks: ['screen_content'] });

function refusal(fn: () => unknown): ShotEditError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ShotEditError) return e;
    throw e;
  }
  throw new Error('expected a ShotEditError');
}

// ── The data ─────────────────────────────────────────────────────────────────

describe('Playbooks as data (#32)', () => {
  it('ships five Playbooks, each valid against every Preset', () => {
    expect(PLAYBOOKS.map((p) => p.id)).toEqual(['fragrance_oud', 'skincare_beauty', 'food_cafe', 'electronics', 'general']);
    for (const pb of PLAYBOOKS) {
      expect(playbookProblems(pb), pb.id).toEqual([]);
      expect(pb.version).toBeGreaterThanOrEqual(1);
      expect(pb.allowed_interactions.length).toBeGreaterThan(0);
      expect(pb.banned_motions.length).toBeGreaterThan(0);
      expect(pb.negatives.people.length).toBeGreaterThan(0);
      for (const rule of pb.banned_motions) {
        expect(rule.en.length, `${pb.id}.${rule.id} en`).toBeGreaterThan(0);
        expect(rule.ar.length, `${pb.id}.${rule.id} ar`).toBeGreaterThan(0);
      }
    }
  });

  it('refuses a Playbook whose pattern uses a kind the Preset does not have', () => {
    const bad: Playbook = {
      ...GENERAL,
      id: 'bad_kind',
      patterns: [{ id: 'x', presets: { reaction: { order: [{ role: 'hands-use', kind: 'hands' }] } } }],
    };
    expect(playbookProblems(bad).join('\n')).toMatch(/not a Reaction kind \(hands\)/);
  });

  it('refuses a pattern that plans over the Preset budget', () => {
    const bad: Playbook = {
      ...GENERAL,
      id: 'over_budget',
      patterns: [
        {
          id: 'x',
          presets: {
            reaction: {
              order: [
                { role: 'a', kind: 'reaction' },
                { role: 'b', kind: 'reaction' },
                { role: 'c', kind: 'reaction' },
                { role: 'd', kind: 'reaction' },
                { role: 'e', kind: 'reaction' },
              ],
            },
          },
        },
      ],
    };
    expect(playbookProblems(bad).join('\n')).toMatch(/budget/);
  });

  it('refuses text that breaks a Guardrail or the Playbook’s own banned motions, and a rule without Arabic', () => {
    const bad: Playbook = {
      ...FRAGRANCE_OUD,
      id: 'bad_text',
      defaults: { energy: 'calm', performance: 'She talks to the camera.' },
      banned_motions: [...FRAGRANCE_OUD.banned_motions, { id: 'en_only', why: 'x', en: ['\\bfoo\\b'], ar: [] }],
      patterns: [
        {
          id: 'x',
          presets: { reaction: { roles: { reaction: { action: 'She brings the bottle to her nose and smells it.' } } } },
        },
      ],
    };
    const problems = playbookProblems(bad).join('\n');
    expect(problems).toMatch(/defaults\.performance: .*Guardrail/);
    expect(problems).toMatch(/roles\.reaction\.action: breaks its own banned motion bottle_to_face/);
    expect(problems).toMatch(/en_only: needs English and Arabic patterns/);
  });

  it('refuses a role the pattern never plans, and a people field on a product shot', () => {
    const bad: Playbook = {
      ...GENERAL,
      id: 'bad_roles',
      patterns: [{ id: 'x', presets: { reaction: { roles: { ghost: { scene: 'x' }, 'product-closer': { performance: 'smiles' } } } } }],
    };
    const problems = playbookProblems(bad).join('\n');
    expect(problems).toMatch(/roles\.ghost: is not a shot role/);
    expect(problems).toMatch(/product-closer\.performance: a product shot shows nobody/);
  });

  it('a registry refuses to load a bad Playbook or a mapping to a missing one', () => {
    expect(() => playbookRegistry([GENERAL], { fragrance_oud: 'fragrance_oud' })).toThrow(PlaybookError);
    expect(() => playbookRegistry([GENERAL, GENERAL], {})).toThrow(/listed twice/);
    expect(() => playbookRegistry([FRAGRANCE_OUD], {})).toThrow(/fallback: no Playbook general/);
  });
});

// ── The choice ───────────────────────────────────────────────────────────────

describe('choosing a Playbook by the Product Profile category', () => {
  it('maps every category, the ones without their own rules to General', () => {
    expect(categoryPlaybooks()).toEqual({
      fragrance_oud: 'fragrance_oud',
      skincare_beauty: 'skincare_beauty',
      food_cafe: 'food_cafe',
      electronics: 'electronics',
      fashion_modest: 'general',
      home: 'general',
      other: 'general',
    });
    expect(CATEGORY_PLAYBOOKS.other).toBe('general');
  });

  it('falls back to General for a category it does not know, and for a draft with no Product Profile', () => {
    expect(choosePlaybook({ category: 'jewellery' as ProductProfile['category'] })?.playbook.id).toBe('general');
    expect(playbookChoice(choosePlaybook(null))).toEqual({ id: 'general', version: GENERAL.version, pattern: null });
    expect(playbookChoice(choosePlaybook(undefined))).toEqual({ id: 'general', version: GENERAL.version, pattern: null });
  });

  it('picks the pattern from the Profile: a spray perfume, an oud oil; fragrance always splits (spray by default)', () => {
    const v = FRAGRANCE_OUD.version;
    expect(playbookChoice(choosePlaybook(PERFUME_PROFILE))).toEqual({ id: 'fragrance_oud', version: v, pattern: 'spray-then-smell' });
    expect(playbookChoice(choosePlaybook(OUD_OIL_PROFILE))).toEqual({ id: 'fragrance_oud', version: v, pattern: 'dab-then-smell' });
    expect(playbookChoice(choosePlaybook(BAKHOOR_PROFILE))).toEqual({ id: 'fragrance_oud', version: v, pattern: 'spray-then-smell' });
    expect(playbookChoice(choosePlaybook(PHONE_PROFILE))).toEqual({ id: 'electronics', version: 1, pattern: 'one-tap' });
    expect(playbookChoice(choosePlaybook(COFFEE_PROFILE))).toEqual({ id: 'food_cafe', version: 1, pattern: null });
  });

  it('fragrance ALWAYS applies a pattern: dab-then-smell when the Profile says oil, attar or dab (verbs), else spray-then-smell', () => {
    const pattern = (p: Partial<ProductProfile>) => choosePlaybook(profile({ category: 'fragrance_oud', ...p }))?.pattern?.id;
    // Oil, attar, a dab: by the verbs.
    for (const verbs of [['dab'], ['apply', 'smell'], ['anoint'], ['rub'], ['apply oil'], ['dab attar'], ['roll on']]) {
      expect(pattern({ interaction_verbs: verbs }), verbs.join()).toBe('dab-then-smell');
    }
    // A spray wins over an "apply" (verbs or the liquid_spray risk).
    expect(pattern({ interaction_verbs: ['spray', 'apply'] })).toBe('spray-then-smell');
    expect(pattern({ interaction_verbs: ['apply'], physics_risks: ['liquid_spray'] })).toBe('spray-then-smell');
    // Anything else: spray-then-smell by default — never the single shot.
    for (const verbs of [['hold'], ['smell'], ['wear'], ['burn', 'waft']]) {
      expect(pattern({ interaction_verbs: verbs }), verbs.join()).toBe('spray-then-smell');
    }
    // And it splits the spray (or dab) and the smell into two person shots wherever the Preset can host it.
    for (const p of [PERFUME_PROFILE, OUD_OIL_PROFILE, BAKHOOR_PROFILE]) {
      const plan = composeShotPlan(REACT, { durationMs: 8_000, modesty: GULF, playbook: choosePlaybook(p) });
      const people = plan.shots.filter((s) => s.shows === 'person').map((s) => s.shot_id);
      expect(people).toEqual([plan.playbook?.pattern === 'dab-then-smell' ? 'reaction-apply' : 'reaction-spray', 'reaction-smell']);
    }
  });

  it('refuses a pattern listed after one that always applies (it could never be picked)', () => {
    const always = FRAGRANCE_OUD.patterns.find((p) => !p.when)!;
    const bad: Playbook = { ...FRAGRANCE_OUD, patterns: [always, ...FRAGRANCE_OUD.patterns.filter((p) => p !== always)] };
    expect(playbookProblems(bad).join('\n')).toMatch(/never picked/);
  });

  it('resolves a recorded choice again (the quote, the worker), refusing a stale or unknown one', () => {
    const c = playbookChoice(choosePlaybook(PERFUME_PROFILE))!;
    const again = resolvePlaybookChoice(c)!;
    expect(again.playbook).toBe(FRAGRANCE_OUD);
    expect(again.pattern?.id).toBe('spray-then-smell');
    expect(resolvePlaybookChoice(null)).toBeNull();
    expect(resolvePlaybookChoice({ id: 'general', version: GENERAL.version, pattern: null })?.pattern).toBeNull();
    expect(() => resolvePlaybookChoice({ ...c, version: 99 })).toThrow(/rules changed/);
    expect(() => resolvePlaybookChoice({ ...c, id: 'nope' })).toThrow(/no Playbook nope/);
    expect(() => resolvePlaybookChoice({ ...c, pattern: 'nope' })).toThrow(/no pattern nope/);
    expect(() => resolvePlaybookChoice('fragrance_oud')).toThrow(PlaybookError);
  });

  it('tells the writer the Playbook: its allowed interactions and what it never does', () => {
    const rules = playbookWriterRules(choosePlaybook(PERFUME_PROFILE))!;
    expect(rules).toContain('Fragrance & oud');
    expect(rules).toContain('spray once onto the inner wrist and set the bottle down');
    expect(rules).toContain('the bottle never comes to the face or nose');
    expect(playbookWriterRules(null)).toBeNull();
  });
});

// ── Banned motions ───────────────────────────────────────────────────────────

describe('banned motions, per Playbook, English and Arabic', () => {
  const banned = (pb: Playbook, text: string) => bannedMotionIssue(text, pb)?.rule ?? null;

  it('fragrance & oud: never the bottle to the face or nose, no cap on camera, no spray at the face', () => {
    for (const t of [
      'She brings the bottle to her nose and smells it.',
      'raises the perfume bottle up to her face',
      'holds the bottle near her face',
      'smells the bottle',
      'sniffs the nozzle',
      'the bottle held under her nose',
    ]) {
      expect(banned(FRAGRANCE_OUD, t), t).toBe('bottle_to_face');
    }
    expect(banned(FRAGRANCE_OUD, 'sprays it directly at her face')).toBe('spray_at_face');
    expect(banned(FRAGRANCE_OUD, 'sprays her face')).toBe('spray_at_face');
    expect(banned(FRAGRANCE_OUD, 'removes the cap and sprays')).toBe('cap_removal');
    expect(banned(FRAGRANCE_OUD, 'twists the cap off')).toBe('cap_removal');
    expect(banned(FRAGRANCE_OUD, 'uncaps the perfume')).toBe('cap_removal');
    // Arabic (with diacritics and hamza forms, folded like the guardrail check).
    expect(banned(FRAGRANCE_OUD, 'تقرّب الزجاجة من أنفها وتبتسم')).toBe('bottle_to_face');
    expect(banned(FRAGRANCE_OUD, 'ترفع العطر إلى وجهها')).toBe('bottle_to_face');
    expect(banned(FRAGRANCE_OUD, 'تشمّ الزجاجة')).toBe('bottle_to_face');
    expect(banned(FRAGRANCE_OUD, 'ترش العطر على وجهها')).toBe('spray_at_face');
    expect(banned(FRAGRANCE_OUD, 'تفتح الغطاء ثم ترش')).toBe('cap_removal');
  });

  it('fragrance & oud: the owner’s own interaction and negatives pass (a negated rule is not a break)', () => {
    for (const t of [
      PERFUME,
      'holds the uncapped bottle at chest height and sprays once onto the inner wrist',
      'With empty hands, the person raises the inner wrist to the nose, smells the skin there and smiles.',
      'she never brings the bottle itself to her face',
      'The person never brings the bottle itself to their face or nose',
      'لا تقرب الزجاجة من وجهها، ترفع معصمها إلى أنفها',
      'dabs one drop from the open bottle onto the inner wrist',
    ]) {
      expect(banned(FRAGRANCE_OUD, t), t).toBeNull();
    }
    // A negation only covers its own clause.
    expect(banned(FRAGRANCE_OUD, 'never rushes, brings the bottle to her nose')).toBe('bottle_to_face');
  });

  it('a negation excuses a match only when it governs the verb: right before it, or with one auxiliary or pronoun between', () => {
    for (const t of [
      'she never brings the bottle to her face',
      'she does not bring the bottle to her face',
      'she doesn’t bring the bottle to her nose',
      "she doesn't ever bring the bottle to her nose",
      'without bringing the bottle to her face',
      'never smells the bottle',
      'لا تقرب الزجاجة من وجهها',
      'ولا تقرّب الزجاجة من أنفها',
      'ما تقرّب الزجاجة من وجهها',
      'لن تقرب الزجاجة من وجهها',
    ]) {
      expect(banned(FRAGRANCE_OUD, t), t).toBeNull();
    }
    for (const t of [
      'without hesitation she brings the bottle to her face',
      'without a pause brings the bottle to her nose',
      'not in a hurry she brings the bottle to her face',
      'never hesitating she lifts the bottle to her nose',
      'no doubt she smells the bottle',
      'بدون تردد تقرب الزجاجة من وجهها',
      'بلا تردد تقرّب الزجاجة من أنفها',
      'لا تتردد وتقرب الزجاجة من وجهها',
      'ما هي تقرب الزجاجة من وجهها',
      'ما بسرعة تقرب الزجاجة من وجهها',
    ]) {
      expect(banned(FRAGRANCE_OUD, t), t).toBe('bottle_to_face');
    }
  });

  it('skincare & beauty: one pump, one fingertip', () => {
    expect(banned(SKINCARE_BEAUTY, 'pumps the serum three times into her palm')).toBe('repeated_pumping');
    expect(banned(SKINCARE_BEAUTY, 'several pumps of lotion')).toBe('repeated_pumping');
    expect(banned(SKINCARE_BEAUTY, 'تضغط المضخة عدة مرات')).toBe('repeated_pumping');
    expect(banned(SKINCARE_BEAUTY, 'dips her fingers deep into the jar')).toBe('deep_dipping');
    expect(banned(SKINCARE_BEAUTY, 'takes a big scoop of cream')).toBe('deep_dipping');
    expect(banned(SKINCARE_BEAUTY, 'تغمس أصابعها في الكريم')).toBe('deep_dipping');
    expect(banned(SKINCARE_BEAUTY, 'takes a small amount of cream from the open jar with one fingertip and smooths it onto the back of the hand')).toBeNull();
    expect(banned(SKINCARE_BEAUTY, 'presses the pump once onto the fingertips, then rubs it gently into the back of the hand')).toBeNull();
  });

  it('food & café: no pouring, no cutting', () => {
    expect(banned(FOOD_CAFE, 'pours the coffee into a glass')).toBe('pouring');
    expect(banned(FOOD_CAFE, 'تصب القهوة في الفنجان')).toBe('pouring');
    expect(banned(FOOD_CAFE, 'slices the cake')).toBe('cutting');
    expect(banned(FOOD_CAFE, 'cuts a piece of cake')).toBe('cutting');
    expect(banned(FOOD_CAFE, 'تقطع الكيك')).toBe('cutting');
    expect(banned(FOOD_CAFE, 'lifts the cup, takes one slow sip through the straw, lowers it and smiles')).toBeNull();
    expect(banned(FOOD_CAFE, 'holds a slice of cake up to the camera and takes one bite')).toBeNull();
  });

  it('electronics: no unboxing or peeling, no typing', () => {
    expect(banned(ELECTRONICS, 'peels the protective film off the screen')).toBe('unboxing_peel');
    expect(banned(ELECTRONICS, 'opens the box and lifts the phone out')).toBe('unboxing_peel');
    expect(banned(ELECTRONICS, 'تنزع اللاصق عن الشاشة')).toBe('unboxing_peel');
    expect(banned(ELECTRONICS, 'types a long message')).toBe('long_typing');
    expect(banned(ELECTRONICS, 'تكتب رسالة طويلة')).toBe('long_typing');
    expect(banned(ELECTRONICS, 'unboxes the earbuds')).toBe('part_removal');
    expect(banned(ELECTRONICS, 'taps the screen once and smiles')).toBeNull();
  });

  it('general: nothing taken apart, unwrapped, poured, cut or thrown', () => {
    expect(banned(GENERAL, 'unwraps the gift')).toBe('part_removal');
    expect(banned(GENERAL, 'pulls the lid off with both hands')).toBe('part_removal');
    expect(banned(GENERAL, 'tosses the product in the air')).toBe('throwing');
    expect(banned(GENERAL, 'ترمي المنتج في الهواء')).toBe('throwing');
    expect(banned(GENERAL, 'pours water into the vase')).toBe('pouring_cutting');
    expect(banned(GENERAL, 'holds the cushion and turns it slightly toward the camera')).toBeNull();
  });

  it('no Playbook: nothing is banned', () => {
    expect(bannedMotionIssue('pours the coffee', null)).toBeNull();
  });
});

// ── The Shot Plan per Playbook ───────────────────────────────────────────────

describe('the Shot Plan under a Playbook', () => {
  const fragrance = choosePlaybook(PERFUME_PROFILE);

  it('fragrance Reaction: spray and smell are two shots cut on action, then the product; the bottle set down between', () => {
    for (const ms of [5_000, 8_000, 15_000]) {
      const plan = composeShotPlan(REACT, { durationMs: ms, modesty: GULF, interaction: PERFUME, playbook: fragrance });
      expect(plan.shots.map((s) => s.shot_id)).toEqual(['reaction-spray', 'reaction-smell', 'product-closer']);
      expect(plan.playbook).toEqual({ id: 'fragrance_oud', version: FRAGRANCE_OUD.version, pattern: 'spray-then-smell' });
      const [spray, smell] = plan.shots;
      expect(spray.fields.action).toContain('sprays once onto the inner wrist, then sets the bottle down');
      expect(spray.fields.action).not.toMatch(/nose/);
      expect(smell.fields.action).toMatch(/^With empty hands, the person raises the inner wrist to the nose/);
      expect(smell.fields.blocking).toContain('already set down');
      expect(spray.fields.energy).toBe('calm');
      expect(spray.fields.performance).toContain('closed-mouth smile');
      expect(plan.shots.reduce((sum, s) => sum + s.on_screen_ms, 0)).toBe(ms);
    }
  });

  it('fragrance: the negatives are a locked line on the video stage of every shot (people’s and the product’s), never the image stage', () => {
    const plan = composeShotPlan(REACT, { durationMs: 8_000, modesty: GULF, interaction: PERFUME, playbook: fragrance });
    const [spray, , closer] = plan.shots;
    const line = spray.guardrails.video.find((g) => g.id === 'playbook')!;
    expect(line.label).toBe('Fragrance & oud rules');
    expect(line.text).toContain('never brings the bottle itself to their face or nose');
    // Before the format line: no text / 9:16 stays last.
    const ids = spray.guardrails.video.map((g) => g.id);
    expect(ids.indexOf('playbook')).toBe(ids.indexOf('format') - 1);
    for (const m of Object.keys(spray.video_guardrails_by_model)) {
      const prompt = shotPrompt(spray, 'video', REFERENCE_TOKENS, m as never);
      expect(prompt).toContain('never brings the bottle itself to their face or nose');
    }
    expect(closer.guardrails.video.find((g) => g.id === 'playbook')?.text).toContain('No spray or mist leaves the bottle');
    const hands = composeShotPlan(HANDS, { durationMs: 8_000, modesty: GULF, vars: handsVars, interaction: PERFUME, playbook: fragrance }).shots[0];
    expect(hands.guardrails.image.some((g) => g.id === 'playbook')).toBe(false);
    expect(hands.guardrails.video.some((g) => g.id === 'playbook')).toBe(true);
  });

  it('fragrance Hands-on: the hands spray once, the role fields filled from the Preset’s inputs', () => {
    const [hands] = composeShotPlan(HANDS, { durationMs: 8_000, modesty: GULF, vars: handsVars, interaction: PERFUME, playbook: fragrance }).shots;
    expect(hands.shot_id).toBe('hands-use');
    expect(hands.fields.scene).toBe("a woman's hands with neat, natural nails hold the uncapped bottle and spray it once onto the inner wrist.");
    expect(hands.fields.action).toBe('One spray onto the inner wrist, then the bottle is set down on the surface.');
    expect(hands.fields.performance).toBe(''); // a hands shot has no face
    expect(shotPrompt(hands, 'image', { start: 'image 1', person: 'image 2' })).toContain('One spray onto the inner wrist');
  });

  it('a pattern prices exactly what it plans, within the Preset budget', () => {
    for (const ms of [5_000, 10_000, 15_000]) {
      const effective = playbookPreset(REACTION, fragrance);
      expect(planPresetShots(effective, ms).length).toBe(composeShotPlan(REACT, { durationMs: ms, modesty: GULF, playbook: fragrance }).shots.length);
      expect(quotePresetCredits(effective, ms)).toBeLessThanOrEqual(REACTION.budget.maxCredits);
    }
    // No pattern for the Preset: its own order, its own price.
    expect(playbookPreset(PRODUCT_HERO, fragrance)).toBe(PRODUCT_HERO);
  });

  it('fragrance on a Preset that cannot host the split (Product Hero: no person): its own shots', () => {
    const plan = composeShotPlan(HERO, { durationMs: 8_000, modesty: GULF, playbook: choosePlaybook(BAKHOOR_PROFILE) });
    expect(plan.playbook?.pattern).toBe('spray-then-smell');
    expect(plan.shots.every((s) => s.shows === 'product')).toBe(true);
  });

  it('skincare: calm, a pleased smile, one small amount', () => {
    const plan = composeShotPlan(REACT, { durationMs: 8_000, modesty: GULF, interaction: 'smooths a little cream onto the back of the hand', playbook: choosePlaybook(CREAM_PROFILE) });
    const [reaction, closer] = plan.shots;
    expect(plan.playbook?.id).toBe('skincare_beauty');
    expect(reaction.fields.energy).toBe('calm');
    expect(reaction.fields.performance).toContain('pleased closed-mouth smile');
    expect(reaction.fields.action).toContain('smooths a little cream');
    expect(reaction.guardrails.video.find((g) => g.id === 'playbook')?.text).toContain('no repeated pumping');
    // A product shot keeps the Preset's energy.
    expect(closer.fields.energy).toBe(REACTION_PROMPTS.shots.product.energy);
  });

  it('food & café: lively, one bite or sip', () => {
    const plan = composeShotPlan(HANDS, { durationMs: 8_000, modesty: GULF, vars: handsVars, interaction: 'lifts the cup and takes one sip', playbook: choosePlaybook(COFFEE_PROFILE) });
    expect(plan.shots[0].fields.energy).toBe('lively');
    expect(plan.shots[0].guardrails.video.find((g) => g.id === 'playbook')?.text).toContain('nothing is poured, cut or unwrapped');
  });

  it('electronics Hands-on: one tap, no readable screen', () => {
    const plan = composeShotPlan(HANDS, { durationMs: 8_000, modesty: GULF, vars: handsVars, interaction: 'taps the screen', playbook: choosePlaybook(PHONE_PROFILE) });
    expect(plan.playbook).toEqual({ id: 'electronics', version: 1, pattern: 'one-tap' });
    expect(plan.shots[0].fields.action).toBe('One tap on the screen or one press of a button; the screen shows no readable text.');
    expect(plan.shots[1].guardrails.video.find((g) => g.id === 'playbook')?.text).toContain('no readable text');
  });

  it('general (home): the Preset’s shots, natural energy, one main action', () => {
    const plan = composeShotPlan(REACT, { durationMs: 8_000, modesty: GULF, interaction: 'holds the cushion', playbook: choosePlaybook(profile({ category: 'home' })) });
    expect(plan.playbook).toEqual({ id: 'general', version: GENERAL.version, pattern: null });
    expect(plan.shots.map((s) => s.shot_id)).toEqual(['reaction', 'product-closer']);
    expect(plan.shots[0].fields.energy).toBe('natural');
    expect(plan.shots[0].guardrails.video.find((g) => g.id === 'playbook')?.text).toContain('One main hand-and-product action');
    // General has no product negatives: a product shot gets no Playbook line.
    expect(plan.shots[1].guardrails.video.some((g) => g.id === 'playbook')).toBe(false);
  });

  it('Product Hero under any Playbook: its own shots; only product negatives', () => {
    const plan = composeShotPlan(HERO, { durationMs: 8_000, modesty: GULF, playbook: fragrance });
    expect(plan.shots.map((s) => s.shot_id)).toEqual(['hero']);
    expect(plan.shots[0].guardrails.video.find((g) => g.id === 'playbook')?.text).toContain('No spray or mist');
  });

  it('no Playbook: the Preset’s plan, unchanged, and none recorded', () => {
    const before = composeShotPlan(REACT, { durationMs: 8_000, modesty: GULF, interaction: PERFUME });
    expect(before.playbook).toBeNull();
    expect(before.shots.map((s) => s.shot_id)).toEqual(['reaction', 'product-closer']);
    expect(before.shots.every((s) => s.guardrails.video.every((g) => g.id !== 'playbook'))).toBe(true);
  });
});

// ── Shot edits ───────────────────────────────────────────────────────────────

describe('shot edits against the Playbook', () => {
  const fragrance = choosePlaybook(PERFUME_PROFILE);
  const plan = (edits: Record<string, unknown>) =>
    composeShotPlan(REACT, { durationMs: 8_000, modesty: GULF, interaction: PERFUME, playbook: fragrance }, edits);

  it('refuses a banned motion with SHOT_EDIT_BANNED_MOTION, the Playbook, the rule and the words', () => {
    const e = refusal(() => plan({ 'reaction-smell': { action: 'She brings the bottle to her nose.' } }));
    expect(e.code).toBe('SHOT_EDIT_BANNED_MOTION');
    expect(e.reason).toBe('banned_motion');
    expect(e.shotId).toBe('reaction-smell');
    expect(e.field).toBe('action');
    expect(e.playbook).toBe('fragrance_oud');
    expect(e.rule).toBe('bottle_to_face');
    expect(e.matched).toBe('brings the bottle to her nose');
    expect(e.message).toMatch(/Fragrance & oud Playbook bans/);
  });

  it('refuses it in Arabic, and in any text field, a product shot’s too', () => {
    expect(refusal(() => plan({ 'reaction-spray': { scene: 'تقرب الزجاجة من أنفها' } })).rule).toBe('bottle_to_face');
    expect(refusal(() => plan({ 'product-closer': { scene: 'A hand removes the cap.' } })).rule).toBe('cap_removal');
  });

  it('accepts an edit that keeps the rules, and the same edit with no Playbook', () => {
    expect(plan({ 'reaction-smell': { performance: 'She closes her eyes for a second and smiles.' } }).shots[1].edited).toBe(true);
    const noPlaybook = composeShotPlan(REACT, { durationMs: 8_000, modesty: GULF }, { reaction: { action: 'She brings the bottle to her nose.' } });
    expect(noPlaybook.shots[0].edited).toBe(true);
  });

  it('a Guardrail break is still SHOT_EDIT_BREAKS_GUARDRAIL (checked first)', () => {
    expect(refusal(() => plan({ 'reaction-spray': { performance: 'She talks to the camera.' } })).code).toBe('SHOT_EDIT_BREAKS_GUARDRAIL');
  });
});

// ── A Playbook added as data ─────────────────────────────────────────────────

describe('adding a Playbook needs no pipeline change', () => {
  /** A test-only Playbook: plugged in as data, then chosen, planned, checked and recorded like the shipped ones. */
  const JEWELLERY: Playbook = {
    id: 'jewellery',
    version: 3,
    name: 'Jewellery',
    allowed_interactions: ['The ring is already on the finger; the hand turns slowly so it catches the light.'],
    banned_motions: [
      { id: 'clasp', why: 'the piece is already on: no clasp is opened or closed on camera', en: ['\\b(?:clasp(?:s|ing|ed)?|fasten\\w*)\\b'], ar: ['(?<!\\p{L})(?:تشبك|يشبك)'] },
    ],
    negatives: { people: ['The piece is already on; no clasp is touched.'], product: ['The piece lies still on the surface.'] },
    defaults: { energy: 'calm', performance: 'A small proud smile at the hand.' },
    patterns: [
      {
        id: 'turn-then-show',
        presets: {
          reaction: {
            order: [
              { role: 'reaction-turn', kind: 'reaction' },
              { role: 'product-cutaway', kind: 'product' },
            ],
            last: { role: 'product-closer', kind: 'product' },
            roles: { 'reaction-turn': { action: 'The hand turns slowly so the ring catches the light.' } },
          },
        },
      },
    ],
  };
  const registry = playbookRegistry([...PLAYBOOKS, JEWELLERY], { ...CATEGORY_PLAYBOOKS, home: 'jewellery' });

  it('loads, and a category mapped to it chooses it', () => {
    expect(playbookProblems(JEWELLERY, PRESETS)).toEqual([]);
    const chosen = choosePlaybook(profile({ category: 'home' }), registry);
    expect(playbookChoice(chosen)).toEqual({ id: 'jewellery', version: 3, pattern: 'turn-then-show' });
    // The shipped registry is untouched.
    expect(choosePlaybook(profile({ category: 'home' }))?.playbook.id).toBe('general');
  });

  it('plans, prices, checks and records like any Playbook', () => {
    const chosen = resolvePlaybookChoice({ id: 'jewellery', version: 3, pattern: 'turn-then-show' }, registry);
    const plan = composeShotPlan(REACT, { durationMs: 8_000, modesty: GULF, interaction: 'shows the ring', playbook: chosen });
    expect(plan.playbook).toEqual({ id: 'jewellery', version: 3, pattern: 'turn-then-show' });
    expect(plan.shots.map((s) => s.shot_id)).toEqual(['reaction-turn', 'product-closer']);
    expect(plan.shots[0].fields.action).toBe('The hand turns slowly so the ring catches the light.');
    expect(plan.shots[0].guardrails.video.find((g) => g.id === 'playbook')?.label).toBe('Jewellery rules');
    expect(quotePresetCredits(playbookPreset(REACTION, chosen), 12_000)).toBeLessThanOrEqual(REACTION.budget.maxCredits);
    const e = refusal(() => composeShotPlan(REACT, { durationMs: 12_000, modesty: GULF, playbook: chosen }, { 'reaction-turn': { action: 'She fastens the clasp.' } }));
    expect([e.code, e.playbook, e.rule]).toEqual(['SHOT_EDIT_BANNED_MOTION', 'jewellery', 'clasp']);
    expect(bannedMotionIssue('تشبك السوار', JEWELLERY)?.rule).toBe('clasp');
  });

  it('the shipped registry resolves only its own Playbooks', () => {
    expect(PLAYBOOK_REGISTRY.playbooks.jewellery).toBeUndefined();
    expect(() => resolvePlaybookChoice({ id: 'jewellery', version: 3, pattern: null })).toThrow(/no Playbook jewellery/);
  });
});
