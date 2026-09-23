// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * make_hands_on (#18) — the Hands-on render phase as a composed, agent-facing
 * skill on the shared Preset render path (quote, run, refunds, draft claim:
 * routes/v1/skills.ts reads the SkillEntry and never branches on the slug).
 *
 * Its own inputs: `hand_gender` (female | male) and `setting` (one of
 * HANDS_ON_SETTINGS), plus the Modesty choice every Preset render takes. When
 * the user names neither, both default from the draft's Product Details (and
 * its Brief): pickHandsOnDefaults, a deterministic mapping — the same answer
 * for the quote and the run, free, and testable without a model. The quote
 * shows what was picked (`preset_inputs`), so the user can change it before
 * confirming.
 */

import { z } from 'zod';
import { HAND_GENDERS, HANDS_ON, HANDS_ON_SETTINGS, type HandGender, type HandsOnSetting, type ModestyChoice } from '@agentmedia/schema';
import { MODESTY_REFUSALS, presetRenderInputSchema, resolvePresetModesty, type PresetInputResolver } from './preset-inputs.js';
import type { RenderableDraft } from './product-hero-render.js';
import type { SkillEntry } from './registry.js';

export const MakeHandsOnSkillInputSchema = presetRenderInputSchema(HANDS_ON, {
  hand_gender: z
    .enum(HAND_GENDERS)
    .optional()
    .describe('Whose hands are on screen: "female" or "male". Omit to let the server pick from the Product Details (the quote says what it picked).'),
  setting: z
    .enum(HANDS_ON_SETTINGS)
    .optional()
    .describe(
      `Where the hands use the product, one of: ${HANDS_ON_SETTINGS.join(', ')}. Omit to let the server pick one that suits the product from its Product Details (e.g. a dressing table for perfume, a kitchen for coffee).`,
    ),
});

// ── Defaults from the Product Details ────────────────────────────────────────

/** Where a default came from: the user's own choice, or the Product Details. */
export type InputSource = 'user' | 'product_details';

export interface HandsOnDefaults {
  hand_gender: HandGender;
  setting: HandsOnSetting;
}

/**
 * Words that point at a setting, checked in this order (the first setting with
 * a match wins, so "Arabic coffee" is a majlis before "coffee" is a kitchen).
 * Arabic words match with the common prefixes (ال، و، ب، ل، لل).
 */
const SETTING_WORDS: ReadonlyArray<[HandsOnSetting, readonly string[]]> = [
  ['car', ['car', 'cars', 'vehicle', 'dashboard', 'سيارة', 'سيارات', 'سياره']],
  ['majlis', ['oud', 'bakhoor', 'bukhoor', 'incense', 'dallah', 'arabic coffee', 'majlis', 'عود', 'بخور', 'مبخرة', 'دلة', 'قهوة عربية', 'تمر', 'تمور', 'مجلس']],
  ['kitchen', ['coffee', 'tea', 'food', 'spice', 'spices', 'honey', 'chocolate', 'cook', 'cooking', 'kitchen', 'blender', 'recipe', 'snack', 'ice cream', 'قهوة', 'شاي', 'طعام', 'بهارات', 'عسل', 'شوكولاتة', 'شوكولا', 'مطبخ', 'طبخ', 'وجبة']],
  ['dressing_table', ['perfume', 'parfum', 'eau de toilette', 'fragrance', 'cologne', 'musk', 'beard', 'shaving', 'grooming', 'makeup', 'make-up', 'lipstick', 'skincare', 'skin care', 'cream', 'serum', 'lotion', 'moisturizer', 'moisturiser', 'jewelry', 'jewellery', 'necklace', 'earrings', 'hair', 'nail', 'cosmetic', 'cosmetics', 'عطر', 'عطور', 'برفان', 'مكياج', 'كريم', 'سيروم', 'بشرة', 'مجوهرات', 'خاتم', 'قلادة', 'شعر', 'أظافر', 'مرطب', 'مسك', 'لحية', 'حلاقة']],
  ['outdoors', ['sunscreen', 'sunglasses', 'water bottle', 'sport', 'sports', 'running', 'gym', 'camping', 'hiking', 'bike', 'outdoor', 'outdoors', 'واقي شمس', 'نظارة شمسية', 'رياضة', 'رياضي', 'تخييم', 'دراجة', 'قارورة']],
  ['desk', ['phone', 'laptop', 'headphones', 'earbuds', 'charger', 'keyboard', 'pen', 'notebook', 'gadget', 'هاتف', 'جوال', 'سماعات', 'شاحن', 'لابتوب', 'قلم', 'دفتر']],
];

/** Words that say whose product it is. Male is checked first: "for men" is explicit where "her" can be incidental. */
const GENDER_WORDS: ReadonlyArray<[HandGender, readonly string[]]> = [
  ['male', ['men', "men's", 'mens', 'for him', 'masculine', 'gentleman', 'gentlemen', 'beard', 'shaving', 'shave', 'رجالي', 'رجالية', 'رجال', 'للرجال', 'لحية', 'حلاقة', 'شماغ', 'غترة', 'عقال']],
  ['female', ['women', "women's", 'womens', 'woman', 'for her', 'ladies', 'feminine', 'girls', 'makeup', 'make-up', 'lipstick', 'mascara', 'abaya', 'نسائي', 'نسائية', 'نساء', 'للنساء', 'سيدات', 'للسيدات', 'بنات', 'مكياج', 'عباية', 'ماسكارا']],
];

/** With no word to go by, the hands that suit the setting best. */
const SETTING_GENDER: Readonly<Record<HandsOnSetting, HandGender>> = {
  dressing_table: 'female',
  kitchen: 'female',
  car: 'male',
  majlis: 'male',
  desk: 'male',
  outdoors: 'male',
};

/** The setting when nothing in the Product Details points at one. */
export const FALLBACK_SETTING: HandsOnSetting = 'desk';

const TASHKEEL = /[\u064B-\u065F\u0670\u0640]/g;
const normalise = (s: string) => s.toLowerCase().replace(TASHKEEL, '').replace(/[أإآ]/g, 'ا');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function mentions(text: string, word: string): boolean {
  const w = escape(normalise(word));
  const arabic = /[\u0600-\u06FF]/.test(word);
  const prefix = arabic ? '(?:ال|و|ب|لل|ل|وال|بال)?' : '';
  return new RegExp(`(?:^|[^\\p{L}\\p{N}'])${prefix}${w}(?=$|[^\\p{L}\\p{N}])`, 'u').test(text);
}

function firstMatch<T>(text: string, table: ReadonlyArray<[T, readonly string[]]>): T | null {
  for (const [value, words] of table) if (words.some((w) => mentions(text, w))) return value;
  return null;
}

/**
 * The default hand gender and setting for a product, from its Product Details
 * (and the Brief, which often names the product when no details were given).
 * Deterministic: the quote and the run always agree.
 */
export function pickHandsOnDefaults(draft: Pick<RenderableDraft, 'product_details' | 'brief'>): HandsOnDefaults {
  const text = normalise([draft.product_details, draft.brief].filter(Boolean).join('\n'));
  const setting = firstMatch(text, SETTING_WORDS) ?? FALLBACK_SETTING;
  const hand_gender = firstMatch(text, GENDER_WORDS) ?? SETTING_GENDER[setting];
  return { hand_gender, setting };
}

// ── The render's inputs ──────────────────────────────────────────────────────

/**
 * Hands-on's own inputs for one render (quote and run alike): the user's
 * choice, else the default from the Product Details, and the Modesty Default.
 * Nothing to re-host: the frames are made from the product photo.
 */
export const resolveHandsOnInputs: PresetInputResolver = async ({ body, draft }) => {
  const defaults = pickHandsOnDefaults(draft);
  const chosenGender = body.hand_gender as HandGender | undefined;
  const chosenSetting = body.setting as HandsOnSetting | undefined;
  const hand_gender = chosenGender ?? defaults.hand_gender;
  const setting = chosenSetting ?? defaults.setting;
  const modesty = resolvePresetModesty(HANDS_ON, draft, hand_gender, body.modesty as ModestyChoice | undefined);
  const source = (chosen: unknown): InputSource => (chosen === undefined ? 'product_details' : 'user');
  const inputs = { hand_gender, setting, modesty };
  return {
    run: inputs,
    workflow: inputs,
    quote: { preset_inputs: { ...inputs, source: { hand_gender: source(chosenGender), setting: source(chosenSetting) } } },
  };
};

// ── The skill ────────────────────────────────────────────────────────────────

export const MAKE_HANDS_ON_SKILL: SkillEntry = {
  slug: 'make_hands_on',
  name: 'Hands-on',
  version: '1.0.0',
  description:
    'Render an APPROVED draft into a finished 9:16 Hands-on Short: first-person hands unboxing, holding and using your product (starting frames made from your product photo, then animated silently), in a setting that suits it, closing on the product — cut to the exact length of the draft\'s voice-over, which plays unchanged. Needs `draft_id` (an approved 5–15 s draft of yours, voiced by an Approved Voice, not already rendered or rendering) and the product photo (`product_image_url`, or `product_image_base64`). `hand_gender` (female | male) and `setting` default from the Product Details — the quote says what it picked; change them if the user wants. Hands and arms are modestly covered by default. Show the user the Script and play the voice preview, and get their OK and the quoted cost, before calling this.',
  primitive: 'composed:make_hands_on',
  workflowType: 'makeHandsOnWorkflow',
  inputSchema: MakeHandsOnSkillInputSchema,
  agentFacing: true,
  preset: HANDS_ON,
  presetInputs: resolveHandsOnInputs,
  presetRefusals: MODESTY_REFUSALS,
};
