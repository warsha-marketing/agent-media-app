// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The Playbooks (#32), which category gets which, and how one is chosen for a
 * render: by the Product Profile's category (#30), falling back to the
 * conservative General Playbook for a category without its own rules.
 *
 * Adding a Playbook is DATA: a file in ./data/ and an entry in PLAYBOOKS (and
 * CATEGORY_PLAYBOOKS, when a category should use it). The pipeline (api-v2's
 * Shot Plan, quote and drafts; the worker's render) only ever calls the
 * functions below with a registry, never a Playbook by name. Every registry is
 * validated when it is made (playbookProblems): a Playbook whose patterns do
 * not fit a Preset's kinds or budget, or whose own text breaks a Guardrail or
 * its own banned motions, never loads.
 *
 * Category mapping: fashion_modest, home and other have no tested rules yet,
 * so they get General (hold it, show it, use it once; nothing taken apart,
 * unwrapped, poured, cut or thrown). The Modesty Default and the Guardrails
 * already carry what fashion needs most; a Fashion Playbook is a data change.
 *
 * Pure: the workflow sandbox imports it.
 */

import {
  PRESETS,
  PRODUCT_CATEGORIES,
  SHOT_ROLE_PATTERN,
  planPresetShots,
  presetProviderUsd,
  quotePresetCredits,
  slotKind,
  slotRole,
  type PresetDefinition,
  type ProductCategory,
  type ProductProfile,
} from '@agentmedia/schema';
import { guardrailIssue } from '../guardrail-check.js';
import { PEOPLE_FIELDS, SHOT_TEXT_FIELDS, isShotEnergy, shotFieldProblem, type ShotField } from '../shot-fields.js';
import { bannedMotionIssue, bannedMotionPatterns } from './banned-motion.js';
import { ELECTRONICS } from './data/electronics.js';
import { FOOD_CAFE } from './data/food-cafe.js';
import { FRAGRANCE_OUD } from './data/fragrance-oud.js';
import { GENERAL } from './data/general.js';
import { SKINCARE_BEAUTY } from './data/skincare-beauty.js';
import { playbookPreset } from './apply.js';
import type { Playbook, PlaybookChoice, PlaybookPattern, PlaybookProfileMatch, ResolvedPlaybook } from './types.js';

export interface PlaybookRegistry {
  /** Every Playbook, by id. */
  playbooks: Readonly<Record<string, Playbook>>;
  /** The Playbook id of each category that has one; any other category gets `fallback`. */
  categories: Readonly<Partial<Record<string, string>>>;
  /** The conservative Playbook, for a category not in `categories`. */
  fallback: string;
}

/** Every Playbook the pipeline knows. */
export const PLAYBOOKS: readonly Playbook[] = [FRAGRANCE_OUD, SKINCARE_BEAUTY, FOOD_CAFE, ELECTRONICS, GENERAL];

/** Each Product Profile category's Playbook (see the header for the ones that get General). */
export const CATEGORY_PLAYBOOKS: Readonly<Record<ProductCategory, string>> = {
  fragrance_oud: 'fragrance_oud',
  skincare_beauty: 'skincare_beauty',
  food_cafe: 'food_cafe',
  electronics: 'electronics',
  fashion_modest: 'general',
  home: 'general',
  other: 'general',
};

/** A refused Playbook choice (an unknown id, a stale version, a pattern it does not have). */
export class PlaybookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaybookError';
  }
}

/** Placeholders a Preset fills (`{hands}`, `{setting}`), as plain words for checking a Playbook's text. */
const unplaceheld = (text: string) => text.replace(/\{[a-z_]+\}/g, 'the hands');

/** Speech lengths a pattern's plan is checked at: every 100 ms of the Preset's band. */
function bandSamples(preset: PresetDefinition): number[] {
  const out: number[] = [];
  for (let ms = preset.minSpeechMs; ms < preset.maxSpeechMs; ms += 100) out.push(ms);
  out.push(preset.maxSpeechMs);
  return out;
}

/**
 * Why `playbook` cannot load, one line per problem; [] when it can. Checked
 * against `presets` (every Preset by id): each pattern's Preset exists, its
 * slots are that Preset's kinds with well-formed roles, it plans within the
 * Preset's budget at every speech length of its band, and its role fields
 * are fields that Preset's shot can have; every text the Playbook adds to a
 * shot passes the shot-field check (the Guardrails included) and its own
 * banned motions; every banned motion compiles, in English and Arabic.
 */
export function playbookProblems(
  playbook: Playbook,
  presets: Readonly<Record<string, PresetDefinition>> = PRESETS,
): string[] {
  const out: string[] = [];
  const at = (where: string, msg: string) => out.push(`${playbook.id}${where ? ` ${where}` : ''}: ${msg}`);
  if (!/^[a-z][a-z0-9_]*$/.test(playbook.id)) at('', 'id must be lower-case words joined by underscores');
  if (!Number.isInteger(playbook.version) || playbook.version < 1) at('version', 'must be a whole number from 1');
  if (!playbook.name.trim()) at('name', 'is empty');
  if (playbook.allowed_interactions.length === 0) at('allowed_interactions', 'lists none');
  const text = (where: string, t: string, field: ShotField = 'scene') => {
    const plain = unplaceheld(t);
    const problem = shotFieldProblem(field, plain);
    if (problem) at(where, problem.message);
    const banned = bannedMotionIssue(plain, playbook);
    if (banned) at(where, `breaks its own banned motion ${banned.rule} ("${banned.matched}")`);
  };
  playbook.allowed_interactions.forEach((t, i) => {
    const issue = guardrailIssue(t);
    if (issue) at(`allowed_interactions[${i}]`, `breaks a Guardrail ("${issue.matched}")`);
  });
  const ruleIds = new Set<string>();
  for (const rule of playbook.banned_motions) {
    if (ruleIds.has(rule.id)) at(`banned_motions.${rule.id}`, 'is listed twice');
    ruleIds.add(rule.id);
    if (!rule.why.trim()) at(`banned_motions.${rule.id}`, 'has no why');
    if (rule.en.length === 0 || rule.ar.length === 0) at(`banned_motions.${rule.id}`, 'needs English and Arabic patterns');
    try {
      bannedMotionPatterns(rule);
    } catch (err) {
      at(`banned_motions.${rule.id}`, `a pattern does not compile: ${(err as Error).message}`);
    }
  }
  for (const [list, lines] of Object.entries(playbook.negatives)) {
    (lines ?? []).forEach((t, i) => {
      if (!t.trim()) at(`negatives.${list}[${i}]`, 'is empty');
      const issue = guardrailIssue(t);
      if (issue) at(`negatives.${list}[${i}]`, `breaks a Guardrail ("${issue.matched}")`);
    });
  }
  if (!isShotEnergy(playbook.defaults.energy)) at('defaults.energy', 'is not an energy');
  if (playbook.defaults.performance !== undefined) text('defaults.performance', playbook.defaults.performance, 'performance');
  const patternIds = new Set<string>();
  let alwaysAt: string | null = null;
  for (const pattern of playbook.patterns) {
    const where = `patterns.${pattern.id}`;
    if (patternIds.has(pattern.id)) at(where, 'is listed twice');
    if (alwaysAt) at(where, `comes after ${alwaysAt}, which always applies: it is never picked`);
    else if (always(pattern.when) && !pattern.when?.unless) alwaysAt = pattern.id;
    patternIds.add(pattern.id);
    if (!SHOT_ROLE_PATTERN.test(pattern.id)) at(where, 'id must be lower-case words joined by hyphens');
    for (const [presetId, p] of Object.entries(pattern.presets)) {
      const preset = presets[presetId];
      const pw = `${where}.${presetId}`;
      if (!preset) {
        at(pw, 'is not a Preset');
        continue;
      }
      const slots = [...(p.order ?? []), ...(p.last !== undefined ? [p.last] : [])];
      for (const slot of slots) {
        if (!Object.hasOwn(preset.shotKinds, slotKind(slot))) at(pw, `slot ${slotRole(slot)} is not a ${preset.name} kind (${slotKind(slot)})`);
      }
      const effective = playbookPreset(preset, { playbook, pattern });
      const plannedRoles = new Map<string, string>();
      try {
        for (const ms of bandSamples(preset)) {
          for (const s of planPresetShots(effective, ms)) plannedRoles.set(s.role, s.kind);
          const credits = quotePresetCredits(effective, ms);
          const usd = presetProviderUsd(effective, ms);
          if (credits > preset.budget.maxCredits) at(pw, `plans ${credits} credits at ${ms} ms; the budget is ${preset.budget.maxCredits}`);
          if (usd > preset.budget.maxProviderUsd + 1e-9) at(pw, `costs $${usd.toFixed(2)} at ${ms} ms; the budget is $${preset.budget.maxProviderUsd}`);
          if (out.length > 20) return out;
        }
      } catch (err) {
        at(pw, (err as Error).message);
        continue;
      }
      for (const [role, fields] of Object.entries(p.roles ?? {})) {
        const kind = plannedRoles.get(role);
        if (kind === undefined) {
          at(`${pw}.roles.${role}`, 'is not a shot role this pattern plans');
          continue;
        }
        const shows = (preset.shotKinds as Record<string, { shows: string }>)[kind].shows;
        for (const [f, v] of Object.entries(fields)) {
          if (f === 'energy') {
            if (!isShotEnergy(v)) at(`${pw}.roles.${role}.energy`, 'is not an energy');
            continue;
          }
          if (!(SHOT_TEXT_FIELDS as readonly string[]).includes(f)) {
            at(`${pw}.roles.${role}.${f}`, 'is not a shot field');
            continue;
          }
          if (PEOPLE_FIELDS.includes(f as ShotField) && shows === 'product') at(`${pw}.roles.${role}.${f}`, 'a product shot shows nobody');
          text(`${pw}.roles.${role}.${f}`, v as string, f as ShotField);
        }
      }
    }
  }
  return out;
}

/**
 * A registry of `playbooks`, with `categories` mapping a Product Profile
 * category to a Playbook id and `fallback` for the rest. Throws when a
 * Playbook cannot load (playbookProblems), an id repeats, or a mapping names
 * a Playbook it does not have.
 */
export function playbookRegistry(
  playbooks: readonly Playbook[],
  categories: Readonly<Partial<Record<string, string>>>,
  fallback = 'general',
  presets: Readonly<Record<string, PresetDefinition>> = PRESETS,
): PlaybookRegistry {
  const byId: Record<string, Playbook> = {};
  const problems: string[] = [];
  for (const pb of playbooks) {
    if (Object.hasOwn(byId, pb.id)) problems.push(`${pb.id}: listed twice`);
    byId[pb.id] = pb;
    problems.push(...playbookProblems(pb, presets));
  }
  for (const [cat, id] of Object.entries(categories)) {
    if (id === undefined || !Object.hasOwn(byId, id)) problems.push(`category ${cat}: no Playbook ${String(id)}`);
  }
  if (!Object.hasOwn(byId, fallback)) problems.push(`fallback: no Playbook ${fallback}`);
  if (problems.length) throw new PlaybookError(`Playbooks cannot load:\n- ${problems.join('\n- ')}`);
  return { playbooks: byId, categories: { ...categories }, fallback };
}

/** The Playbooks the pipeline renders with. */
export const PLAYBOOK_REGISTRY: PlaybookRegistry = playbookRegistry(PLAYBOOKS, CATEGORY_PLAYBOOKS);

/** The Playbook of `category`: its own, else the fallback (General). */
export function playbookForCategory(category: string | null | undefined, registry: PlaybookRegistry = PLAYBOOK_REGISTRY): Playbook {
  const id = (category && Object.hasOwn(registry.categories, category) ? registry.categories[category] : undefined) ?? registry.fallback;
  return registry.playbooks[id];
}

/** The Profile fields a Playbook choice reads. */
export type PlaybookProfile = Pick<ProductProfile, 'category'> & Partial<Pick<ProductProfile, 'interaction_verbs' | 'physics_risks'>>;

/** The words of the Profile's interaction verbs ("apply oil" → apply, oil), lower case. */
function verbWords(profile: PlaybookProfile | null | undefined): Set<string> {
  return new Set((profile?.interaction_verbs ?? []).flatMap((v) => v.toLowerCase().split(/[^\p{L}]+/u)).filter(Boolean));
}

/** Whether `m` hits the Profile: any listed verb word or risk. */
function profileHits(m: PlaybookProfileMatch | undefined, verbs: Set<string>, risks: Set<string>): boolean {
  if (!m) return false;
  return (m.verbs_any ?? []).some((v) => verbs.has(v)) || (m.risks_any ?? []).some((r) => risks.has(r));
}

/** Whether `when` has nothing to match on: the pattern always applies. */
function always(w: PlaybookPattern['when']): boolean {
  return !w || (!w.verbs_any?.length && !w.risks_any?.length);
}

/**
 * The first of `playbook`'s patterns whose `when` matches `profile` (any
 * listed verb word or risk, and none of its `unless`; no `when` = always), or null.
 */
export function playbookPattern(playbook: Playbook, profile: PlaybookProfile | null | undefined): PlaybookPattern | null {
  const verbs = verbWords(profile);
  const risks = new Set<string>(profile?.physics_risks ?? []);
  for (const pattern of playbook.patterns) {
    const w = pattern.when;
    if (profileHits(w?.unless, verbs, risks)) continue;
    if (always(w) || profileHits(w, verbs, risks)) return pattern;
  }
  return null;
}

/**
 * The Playbook (and pattern) a render of a product with `profile` uses: by its
 * category, else General. Null for a draft without a Product Profile (drafts
 * from before #30): its Shorts render exactly as before.
 */
export function choosePlaybook(profile: PlaybookProfile | null | undefined, registry: PlaybookRegistry = PLAYBOOK_REGISTRY): ResolvedPlaybook | null {
  if (!profile) return null;
  const playbook = playbookForCategory(profile.category, registry);
  return { playbook, pattern: playbookPattern(playbook, profile) };
}

/** What a Shot Plan, a run input and the render record of a choice. */
export function playbookChoice(resolved: ResolvedPlaybook | null | undefined): PlaybookChoice | null {
  if (!resolved) return null;
  return { id: resolved.playbook.id, version: resolved.playbook.version, pattern: resolved.pattern?.id ?? null };
}

/**
 * A recorded choice (a run input's `playbook`) resolved again, as the quote
 * and the worker do: null for none. Throws PlaybookError on a choice that is
 * not one: an unknown Playbook, another version than the loaded one (the
 * rules changed since the quote: quote again), or a pattern it does not have.
 */
export function resolvePlaybookChoice(choice: unknown, registry: PlaybookRegistry = PLAYBOOK_REGISTRY): ResolvedPlaybook | null {
  if (choice === undefined || choice === null) return null;
  const c = choice as Partial<PlaybookChoice>;
  if (typeof c !== 'object' || typeof c.id !== 'string') throw new PlaybookError('playbook must be { id, version, pattern }');
  if (!Object.hasOwn(registry.playbooks, c.id)) throw new PlaybookError(`no Playbook ${c.id}`);
  const playbook = registry.playbooks[c.id];
  if (c.version !== playbook.version) {
    throw new PlaybookError(`Playbook ${c.id} is version ${playbook.version}, not ${String(c.version)}: its rules changed; ask for the quote again`);
  }
  if (c.pattern === undefined || c.pattern === null) return { playbook, pattern: null };
  const pattern = playbook.patterns.find((p) => p.id === c.pattern);
  if (!pattern) throw new PlaybookError(`Playbook ${c.id} has no pattern ${String(c.pattern)}`);
  return { playbook, pattern };
}

/** Every category and the Playbook it gets, for docs and the tests. */
export function categoryPlaybooks(registry: PlaybookRegistry = PLAYBOOK_REGISTRY): Record<ProductCategory, string> {
  return Object.fromEntries(PRODUCT_CATEGORIES.map((c) => [c, playbookForCategory(c, registry).id])) as Record<ProductCategory, string>;
}
