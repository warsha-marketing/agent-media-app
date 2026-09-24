// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * How a chosen Playbook shapes a render (#32), as pure functions the Shot
 * Plan (../shot-plan.ts), the quote (api-v2 credit-quotes) and the writer
 * (api-v2 drafts) call — never branching on a Playbook's id:
 *
 *   playbookPreset       — the Preset with the pattern's shot order: what is
 *                          planned AND priced (planPresetShots), so the quote
 *                          stays the charge;
 *   playbookRoleDefaults — a shot's default fields from the Playbook: the
 *                          energy (and a person's performance), then the
 *                          pattern role's own fields;
 *   playbookGuardrail    — the Playbook's negatives as one locked line on the
 *                          video stage;
 *   playbookWriterRules  — the Playbook as the Product Interaction writer is told it.
 *
 * Pure: the workflow sandbox imports it.
 */

import type { PresetDefinition, ShotSubject } from '@agentmedia/schema';
import type { Guardrail } from '../guardrails.js';
import type { PlaybookPresetPattern, PlaybookRoleFields, ResolvedPlaybook } from './types.js';

/** The pattern `resolved` has for Preset `presetId`, or null. */
export function playbookPresetPattern(resolved: ResolvedPlaybook | null | undefined, presetId: string): PlaybookPresetPattern | null {
  const presets = resolved?.pattern?.presets;
  return presets && Object.hasOwn(presets, presetId) ? presets[presetId] : null;
}

/**
 * `preset` with the shot order of `resolved`'s pattern for it (its `order`
 * and `last` replace the Preset's; the intercut rule, band and budget stay);
 * `preset` itself when the pattern leaves its order alone.
 */
export function playbookPreset<P extends Pick<PresetDefinition, 'id' | 'shotPlan'>>(preset: P, resolved: ResolvedPlaybook | null | undefined): P {
  const p = playbookPresetPattern(resolved, preset.id);
  if (!p?.order) return preset;
  const shotPlan: PresetDefinition['shotPlan'] = { order: p.order };
  if (p.last !== undefined) shotPlan.last = p.last;
  if (preset.shotPlan.maxShotMs !== undefined) shotPlan.maxShotMs = preset.shotPlan.maxShotMs;
  return { ...preset, shotPlan };
}

/**
 * The Playbook's default fields for the shot of `role` (showing `shows`) of
 * Preset `presetId`, over the Preset's: the Playbook's energy on hands and
 * person shots and its performance on person shots, then the pattern role's
 * fields. Placeholders are the Preset's (`{hands}`), filled by the caller.
 */
export function playbookRoleDefaults(
  resolved: ResolvedPlaybook | null | undefined,
  presetId: string,
  role: string,
  shows: ShotSubject,
): PlaybookRoleFields {
  if (!resolved) return {};
  const out: PlaybookRoleFields = {};
  const { defaults } = resolved.playbook;
  if ((shows === 'hands' || shows === 'person') && defaults.energy) out.energy = defaults.energy;
  if (shows === 'person' && defaults.performance) out.performance = defaults.performance;
  const roles = playbookPresetPattern(resolved, presetId)?.roles;
  if (roles && Object.hasOwn(roles, role)) Object.assign(out, roles[role]);
  return out;
}

/** The Playbook's negatives for a shot showing `shows`, as its video-stage Guardrail; null when it has none. */
export function playbookGuardrail(resolved: ResolvedPlaybook | null | undefined, shows: ShotSubject): Guardrail | null {
  if (!resolved) return null;
  const { negatives, name } = resolved.playbook;
  const lines = shows === 'product' ? negatives.product ?? [] : negatives.people;
  if (lines.length === 0) return null;
  return { id: 'playbook', label: `${name} Playbook`, text: lines.join(' '), at: 'after_scene' };
}

/**
 * `list` (a shot's video-stage Guardrails) with the Playbook's line in it,
 * after the other rules and before the format line (so no text / 9:16 stays
 * the prompt's last word).
 */
export function withPlaybookGuardrail(list: Guardrail[], line: Guardrail | null): Guardrail[] {
  if (!line) return list;
  const at = list.findIndex((g) => g.id === 'format');
  const out = [...list];
  out.splice(at < 0 ? out.length : at, 0, line);
  return out;
}

/** The Playbook as the Product Interaction writer is told it (a data block in its prompt). */
export function playbookWriterRules(resolved: ResolvedPlaybook | null | undefined): string | null {
  if (!resolved) return null;
  const pb = resolved.playbook;
  return [
    `Playbook: ${pb.name}.`,
    `Allowed interactions (pick the one that fits, keep it to ONE main action): ${pb.allowed_interactions.join(' ')}`,
    `Never: ${pb.banned_motions.map((r) => r.why).join('; ')}.`,
  ].join('\n');
}
