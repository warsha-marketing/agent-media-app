// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The Hands-on inputs in the web flow (#18), as pure functions so they are
 * testable without a browser (scripts/tests/hands-on-flow.test.ts).
 *
 * Hands-on renders through the same flow as Product Hero (draft, voice, quote,
 * Confirm, render, Short, Caption editor); it adds only two choices: whose
 * hands (female or male) and the setting, from a short list. The server picks
 * both from the draft's Product Details when the user does not, and says what
 * it picked in the quote (`preset_inputs`), so the page shows the server's
 * pick until the user changes it. Only what the user changed is sent: anything
 * left out the server defaults the same way for the quote and the run.
 *
 * No imports: scripts/tests loads this file directly. The lists mirror
 * @agentmedia/schema (HAND_GENDERS, HANDS_ON_SETTINGS, HANDS_ON_SETTING_NAMES),
 * held equal by the test.
 */

/** The Preset this flow is for, and the skill that renders it. */
export const HANDS_ON_PRESET = 'hands_on';

export const HAND_GENDERS = ['female', 'male'] as const;
export type HandGender = (typeof HAND_GENDERS)[number];

export const HAND_GENDER_NAMES: Readonly<Record<HandGender, string>> = { female: 'Female hands', male: 'Male hands' };

export const HANDS_ON_SETTINGS = ['dressing_table', 'car', 'majlis', 'kitchen', 'desk', 'outdoors'] as const;
export type HandsOnSetting = (typeof HANDS_ON_SETTINGS)[number];

export const HANDS_ON_SETTING_NAMES: Readonly<Record<HandsOnSetting, string>> = {
  dressing_table: 'Dressing table',
  car: 'Car',
  majlis: 'Majlis',
  kitchen: 'Kitchen',
  desk: 'Desk',
  outdoors: 'Outdoors',
};

/** What the user changed; null = leave it to the server's pick. */
export interface HandsOnChoice {
  handGender: HandGender | null;
  setting: HandsOnSetting | null;
}

export const NO_HANDS_ON_CHOICE: HandsOnChoice = { handGender: null, setting: null };

const isGender = (v: unknown): v is HandGender => typeof v === 'string' && (HAND_GENDERS as readonly string[]).includes(v);
const isSetting = (v: unknown): v is HandsOnSetting => typeof v === 'string' && (HANDS_ON_SETTINGS as readonly string[]).includes(v);

/** The body fields a choice sends (RenderChoice.presetInputs): only what the user set. */
export function handsOnInputs(choice: HandsOnChoice): Record<string, string> {
  return {
    ...(choice.handGender ? { hand_gender: choice.handGender } : {}),
    ...(choice.setting ? { setting: choice.setting } : {}),
  };
}

/** What the page shows for one input: the value, and whether the server picked it from the Product Details. */
export interface ShownInput<T> {
  value: T | null;
  fromProductDetails: boolean;
}

export interface HandsOnView {
  handGender: ShownInput<HandGender>;
  setting: ShownInput<HandsOnSetting>;
  /** How covered the arms are, as the server resolved it (the Modesty Default), if a quote said. */
  arms: 'covered' | 'sleeved' | null;
}

/**
 * What the Hands-on panel shows: the user's own choice wins; otherwise the
 * quote's `preset_inputs` (the server's pick from the Product Details). Null
 * while no quote has said (e.g. still quoting).
 */
export function handsOnView(choice: HandsOnChoice, presetInputs: Record<string, unknown> | null | undefined): HandsOnView {
  const q = presetInputs ?? {};
  const source = (q.source && typeof q.source === 'object' ? q.source : {}) as Record<string, unknown>;
  const modesty = (q.modesty && typeof q.modesty === 'object' ? q.modesty : {}) as Record<string, unknown>;
  const shown = <T,>(mine: T | null, theirs: unknown, ok: (v: unknown) => v is T, key: string): ShownInput<T> => {
    if (mine) return { value: mine, fromProductDetails: false };
    if (ok(theirs)) return { value: theirs, fromProductDetails: source[key] === 'product_details' };
    return { value: null, fromProductDetails: false };
  };
  return {
    handGender: shown(choice.handGender, q.hand_gender, isGender, 'hand_gender'),
    setting: shown(choice.setting, q.setting, isSetting, 'setting'),
    arms: modesty.arms === 'covered' || modesty.arms === 'sleeved' ? modesty.arms : null,
  };
}

/** The line under the Hands-on inputs about modesty. */
export function modestyLine(arms: HandsOnView['arms']): string {
  return arms === 'sleeved'
    ? 'Modest by default: sleeves reach at least the elbow.'
    : 'Modest by default: the arms are covered by long sleeves.';
}
