// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Shot Plan review (#26, the Shot List of #28) in the web flow, as pure
 * functions (tested by scripts/tests/shot-plan-flow.test.ts, without a browser).
 *
 *   quote on screen ─► "Review shots" (collapsed) ─► POST …/shot-plan ─► cards
 *                                                          │ edit a scene / energy
 *   Confirm ◄─ re-quote with shot_edits (a new request: a new Idempotency-Key) ◄┘
 *
 * The server composes the plan (every shot's structured fields and its locked
 * Guardrails per stage) and always adds the Guardrails itself; the page only
 * ever sends fields, `{ shot_id: { field: value } }`, and only the ones the
 * user changed.
 *
 * No imports: scripts/tests loads this file directly. The limits, energies and
 * model names mirror @agentmedia/shot-prompts (held equal by the parity test).
 */

/** The scene's length cap: SHOT_FIELD_MAX_CHARS.scene in @agentmedia/shot-prompts. */
export const SCENE_TEXT_MAX = 1000;

/** How alive a shot feels: SHOT_ENERGIES in @agentmedia/shot-prompts. */
export const ENERGIES = ['calm', 'natural', 'lively'] as const;

/** The fields the panel lets the user change (the server takes every field; the panel edits these). */
export const EDITABLE_FIELDS = ['scene', 'energy'] as const;

/** The video models by name: VIDEO_MODEL_LABELS in @agentmedia/shot-prompts. */
export const MODEL_NAMES: Readonly<Record<string, string>> = {
  'seedance-2.0': 'Seedance 2.0',
  'kling-o3-pro': 'Kling O3 Pro',
  'veo-3.1': 'Veo 3.1',
};

export interface ShotGuardrail {
  id: string;
  label: string;
  text: string;
  /** 'request': enforced by the request (the model's audio off), not prompt text. */
  enforcedBy: 'prompt' | 'request';
}

/** One field of a shot's card, in the server's composition order. */
export interface ShotFieldSpec {
  id: string;
  label: string;
  maxChars: number | null;
  choices: string[] | null;
  required: boolean;
}

/** A shot's fields, by field id (framing, scene, …, energy, …). */
export type ShotFieldValues = Readonly<Record<string, string>>;

export interface PlannedShot {
  shotId: string;
  number: number;
  kind: string;
  shows: 'product' | 'hands' | 'person';
  onScreenMs: number;
  startingFrame: string | null;
  model: { id: string; name: string };
  fallback: { id: string; name: string } | null;
  fields: ShotFieldValues;
  defaultFields: ShotFieldValues;
  /** The locked lines per stage: image (the starting frame's; empty without one) and video. */
  guardrails: { image: ShotGuardrail[]; video: ShotGuardrail[] };
}

export interface ShotPlan {
  shots: PlannedShot[];
  /** The fields in composition order, as the server lists them. */
  fieldSpecs: ShotFieldSpec[];
  sceneTextMax: number;
}

/** The user's changes to one shot, by field id; and to the plan, by shot id (the `shot_edits` body). */
export type ShotEdit = Readonly<Record<string, string>>;
export type ShotEdits = Readonly<Record<string, ShotEdit>>;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function model(v: unknown): { id: string; name: string } | null {
  const m = obj(v);
  const id = str(m?.id);
  if (!id) return null;
  return { id, name: str(m?.name) ?? MODEL_NAMES[id] ?? id };
}

function fieldValues(v: unknown): Record<string, string> | null {
  const o = obj(v);
  if (!o) return null;
  return Object.fromEntries(Object.entries(o).flatMap(([k, x]) => (typeof x === 'string' ? [[k, x]] : [])));
}

function guardrails(v: unknown): ShotGuardrail[] {
  return (Array.isArray(v) ? v : []).flatMap((g) => {
    const o = obj(g);
    const text = str(o?.text);
    if (!o || !text) return [];
    return [{ id: str(o.id) ?? '', label: str(o.label) ?? text, text, enforcedBy: o.enforced_by === 'request' ? ('request' as const) : ('prompt' as const) }];
  });
}

/** A 200 from POST /v1/skills/{slug}/shot-plan, or null if it is not one. */
export function parseShotPlan(body: unknown): ShotPlan | null {
  const b = obj(body);
  if (!b || !Array.isArray(b.shots)) return null;
  const shots: PlannedShot[] = [];
  for (const raw of b.shots) {
    const s = obj(raw);
    const shotId = str(s?.shot_id);
    const fields = fieldValues(s?.fields);
    const m = model(s?.model);
    if (!s || !shotId || !fields || typeof fields.scene !== 'string' || !m) return null;
    const shows = s.shows === 'hands' || s.shows === 'person' ? s.shows : 'product';
    const g = obj(s.guardrails);
    shots.push({
      shotId,
      number: typeof s.number === 'number' ? s.number : shots.length + 1,
      kind: str(s.kind) ?? '',
      shows,
      onScreenMs: typeof s.on_screen_ms === 'number' ? s.on_screen_ms : 0,
      startingFrame: str(s.starting_frame),
      model: m,
      fallback: model(s.fallback),
      fields,
      defaultFields: fieldValues(s.default_fields) ?? fields,
      guardrails: { image: guardrails(g?.image), video: guardrails(g?.video) },
    });
  }
  const fieldSpecs = (Array.isArray(b.fields) ? b.fields : []).flatMap((f): ShotFieldSpec[] => {
    const o = obj(f);
    const id = str(o?.id);
    if (!o || !id) return [];
    return [
      {
        id,
        label: str(o.label) ?? id,
        maxChars: typeof o.max_chars === 'number' ? o.max_chars : null,
        choices: Array.isArray(o.choices) ? o.choices.filter((c): c is string => typeof c === 'string') : null,
        required: o.required === true,
      },
    ];
  });
  const scene = fieldSpecs.find((f) => f.id === 'scene');
  return { shots, fieldSpecs, sceneTextMax: scene?.maxChars ?? SCENE_TEXT_MAX };
}

/** Field text as the server checks and stores it: whitespace collapsed, trimmed (tidyFieldText). */
export function tidyScene(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * What the request sends as `shot_edits`: per shot, only the fields the user
 * changed from the Preset's (tidied); nothing for an untouched, reset or
 * emptied scene. Shots and fields in plan order, so the same edits are the
 * same request.
 */
export function shotEditsOf(plan: ShotPlan, values: Readonly<Record<string, ShotEdit>>): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const shot of plan.shots) {
    const v = values[shot.shotId];
    if (!v) continue;
    const edit: Record<string, string> = {};
    for (const field of Object.keys(shot.defaultFields)) {
      if (!Object.hasOwn(v, field)) continue;
      const t = tidyScene(v[field]);
      if (field === 'scene' && !t) continue;
      if (t !== tidyScene(shot.defaultFields[field] ?? '')) edit[field] = t;
    }
    if (Object.keys(edit).length) out[shot.shotId] = edit;
  }
  return out;
}

/** Why the server would refuse this scene text before its guardrail check, in its words; null if it would not. */
export function sceneTextHint(text: string, max = SCENE_TEXT_MAX): string | null {
  const t = tidyScene(text);
  if (!t) return 'Empty: reset it to the Preset’s scene, or describe the shot.';
  if (t.length > max) return `${t.length} characters; the most is ${max}.`;
  if (/[[\]{}<>]/.test(t)) return 'No bracketed tags ([ ], { }, < >): describe the shot in plain words.';
  if (/@\s*image|\bimage\s*[12]\b|\breference\s+images?\b|\b(?:first|second)\s+(?:reference|image)\b/i.test(t)) {
    return 'Say "the product" or "the person": the render pins them to your photos itself.';
  }
  return null;
}

/**
 * The shot's structured fields as the card lists them, read-only: every
 * non-empty field but the ones the panel edits, labelled, in composition order.
 */
export function fieldRows(plan: Pick<ShotPlan, 'fieldSpecs'>, shot: Pick<PlannedShot, 'fields'>): Array<{ id: string; label: string; value: string }> {
  const editable = new Set<string>(EDITABLE_FIELDS);
  return plan.fieldSpecs.flatMap((f) => {
    const value = shot.fields[f.id];
    return !editable.has(f.id) && value ? [{ id: f.id, label: f.label, value }] : [];
  });
}

/** "Kling O3 Pro → Veo 3.1", or just the model. */
export function modelLine(shot: Pick<PlannedShot, 'model' | 'fallback'>): string {
  return shot.fallback ? `${shot.model.name} → ${shot.fallback.name}` : shot.model.name;
}

/** What a shot shows, as the card header says it. */
export function kindLabel(shows: PlannedShot['shows']): string {
  return shows === 'person' ? 'Person' : shows === 'hands' ? 'Hands' : 'Product';
}

/** On-screen length, e.g. "2.5 s". */
export function lengthLabel(ms: number): string {
  return `${(Math.round(ms / 100) / 10).toFixed(1)} s`;
}

// ── What ran (the result) ───────────────────────────────────────────────────

export interface RenderedShot {
  shotId: string;
  kind: string;
  modelName: string;
  edited: boolean;
  /** The final clip prompt exactly as sent to the model. */
  prompt: string;
  /** The starting frame's prompt as sent (#28), on a shot that has one. */
  framePrompt: string | null;
}

/** A finished Short's shots as they rendered (final_output.shots); [] for a Short from before #26. */
export function renderedShotsOf(shots: unknown): RenderedShot[] {
  if (!Array.isArray(shots)) return [];
  return shots.flatMap((raw) => {
    const s = obj(raw);
    const prompt = str(s?.prompt);
    if (!s || !prompt) return [];
    const id = str(s.model) ?? '';
    return [
      {
        shotId: str(s.shot_id) ?? '',
        kind: str(s.kind) ?? '',
        modelName: MODEL_NAMES[id] ?? id,
        edited: s.edited === true,
        prompt,
        framePrompt: str(s.frame_prompt),
      },
    ];
  });
}
