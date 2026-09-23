// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The Preset picker and Dialect choice at the start of the web flow (#8), as
 * pure functions so they are testable without a browser
 * (scripts/tests/preset-picker.test.ts).
 *
 *   GET /v1/presets ─► pick a Preset ─► pick a Dialect ─► Brief, Voice, Script …
 *
 * The list comes from the API, so a Preset that becomes a Qualified Preset
 * (Hands-on and Reaction, #15) shows up here without a web change. A Dialect is
 * selectable only if the Preset is qualified for it; every other Dialect shows
 * as "coming soon". Operators may also pick an unqualified Dialect the server
 * marks `sample`, to make the sample Shorts native reviewers judge.
 *
 * No imports: scripts/tests loads this file directly.
 */

export interface PresetDialect {
  dialect: string;
  name: string;
  status: 'available' | 'coming_soon';
  /** Operators only: an unqualified Dialect they can draft to make reviewer samples. */
  sample?: boolean;
}

export interface PresetOption {
  slug: string;
  name: string;
  summary: string;
  /** The skill that renders it (quote / run). */
  skill: string;
  dialects: PresetDialect[];
}

export interface PresetPicker {
  presets: PresetOption[];
  operator: boolean;
}

/** The Presets that have a web flow today. Any other Preset is listed but not pickable yet. */
export const WEB_FLOWS: ReadonlySet<string> = new Set(['product_hero']);

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** A 200 body of GET /v1/presets, or null if it is not one. Malformed entries are dropped. */
export function parsePresets(body: unknown): PresetPicker | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { presets?: unknown; operator?: unknown };
  if (!Array.isArray(b.presets)) return null;
  const presets: PresetOption[] = [];
  for (const raw of b.presets as Array<Record<string, unknown>>) {
    if (!raw || !str(raw.slug) || !str(raw.name) || !Array.isArray(raw.dialects)) continue;
    const dialects: PresetDialect[] = [];
    for (const d of raw.dialects as Array<Record<string, unknown>>) {
      if (!d || !str(d.dialect)) continue;
      dialects.push({
        dialect: d.dialect,
        name: str(d.name) ? d.name : d.dialect,
        status: d.status === 'available' ? 'available' : 'coming_soon',
        ...(d.sample === true ? { sample: true } : {}),
      });
    }
    presets.push({
      slug: raw.slug,
      name: raw.name,
      summary: str(raw.summary) ? raw.summary : '',
      skill: str(raw.skill) ? raw.skill : '',
      dialects,
    });
  }
  return { presets, operator: b.operator === true };
}

export interface DialectChoice {
  dialect: string;
  label: string;
  selectable: boolean;
  /** Picked by an operator although the pair is not qualified: a reviewer sample. */
  sample: boolean;
}

/** The Dialect options for a Preset: available ones, then "coming soon" (or "reviewer sample" for operators). */
export function dialectChoices(preset: PresetOption | null, operator: boolean): DialectChoice[] {
  if (!preset) return [];
  return preset.dialects.map((d) => {
    if (d.status === 'available') return { dialect: d.dialect, label: d.name, selectable: true, sample: false };
    const sample = operator && d.sample === true;
    return {
      dialect: d.dialect,
      label: sample ? `${d.name} (coming soon · reviewer sample)` : `${d.name} (coming soon)`,
      selectable: sample,
      sample,
    };
  });
}

/**
 * The Dialect to show selected: `current` if it can still be picked, else the
 * first available one; operators fall back to a sampleable one. Null = nothing
 * can be drafted for this Preset.
 */
export function defaultDialect(choices: DialectChoice[], current: string | null): string | null {
  if (current && choices.some((c) => c.dialect === current && c.selectable)) return current;
  return choices.find((c) => c.selectable && !c.sample)?.dialect ?? choices.find((c) => c.selectable)?.dialect ?? null;
}

/** The Preset to show selected: `current` if listed and it has a web flow, else the first that does. */
export function defaultPreset(picker: PresetPicker | null, current: string | null): PresetOption | null {
  const presets = picker?.presets.filter((p) => WEB_FLOWS.has(p.slug)) ?? [];
  return presets.find((p) => p.slug === current) ?? presets[0] ?? null;
}
