// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Shot Plan review (#26) in the web flow, as pure functions (tested by
 * scripts/tests/shot-plan-flow.test.ts, without a browser).
 *
 *   quote on screen ─► "Review shots" (collapsed) ─► POST …/shot-plan ─► cards
 *                                                                     │ edit a scene
 *   Confirm ◄─ re-quote with shot_edits (a new request: a new Idempotency-Key) ◄┘
 *
 * The server composes the plan (every shot's scene text and its locked
 * Guardrails) and always adds the Guardrails itself; the page only ever sends
 * scene text, and only for the shots whose scene the user changed.
 *
 * No imports: scripts/tests loads this file directly. The limits and model
 * names mirror @agentmedia/shot-prompts (held equal by the parity test).
 */

/** A scene's length cap: SCENE_TEXT_MAX_CHARS in @agentmedia/shot-prompts. */
export const SCENE_TEXT_MAX = 1000;

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

export interface PlannedShot {
  shotId: string;
  number: number;
  kind: string;
  shows: 'product' | 'hands' | 'person';
  onScreenMs: number;
  startingFrame: string | null;
  model: { id: string; name: string };
  fallback: { id: string; name: string } | null;
  sceneText: string;
  defaultSceneText: string;
  guardrails: ShotGuardrail[];
}

export interface ShotPlan {
  shots: PlannedShot[];
  sceneTextMax: number;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function model(v: unknown): { id: string; name: string } | null {
  const m = obj(v);
  const id = str(m?.id);
  if (!id) return null;
  return { id, name: str(m?.name) ?? MODEL_NAMES[id] ?? id };
}

/** A 200 from POST /v1/skills/{slug}/shot-plan, or null if it is not one. */
export function parseShotPlan(body: unknown): ShotPlan | null {
  const b = obj(body);
  if (!b || !Array.isArray(b.shots)) return null;
  const shots: PlannedShot[] = [];
  for (const raw of b.shots) {
    const s = obj(raw);
    const shotId = str(s?.shot_id);
    const sceneText = str(s?.scene_text);
    const m = model(s?.model);
    if (!s || !shotId || sceneText === null || !m) return null;
    const shows = s.shows === 'hands' || s.shows === 'person' ? s.shows : 'product';
    shots.push({
      shotId,
      number: typeof s.number === 'number' ? s.number : shots.length + 1,
      kind: str(s.kind) ?? '',
      shows,
      onScreenMs: typeof s.on_screen_ms === 'number' ? s.on_screen_ms : 0,
      startingFrame: str(s.starting_frame),
      model: m,
      fallback: model(s.fallback),
      sceneText,
      defaultSceneText: str(s.default_scene_text) ?? sceneText,
      guardrails: (Array.isArray(s.guardrails) ? s.guardrails : []).flatMap((g) => {
        const o = obj(g);
        const text = str(o?.text);
        if (!o || !text) return [];
        return [{ id: str(o.id) ?? '', label: str(o.label) ?? text, text, enforcedBy: o.enforced_by === 'request' ? ('request' as const) : ('prompt' as const) }];
      }),
    });
  }
  return { shots, sceneTextMax: typeof b.scene_text_max_chars === 'number' ? b.scene_text_max_chars : SCENE_TEXT_MAX };
}

/** Scene text as the server checks and stores it: whitespace collapsed, trimmed (tidySceneText). */
export function tidyScene(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * What the request sends as `shot_edits`: only the shots whose scene text the
 * user changed from the Preset's (tidied); none for an untouched, reset or
 * emptied shot. Keys in plan order, so the same edits are the same request.
 */
export function shotEditsOf(plan: ShotPlan, texts: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const shot of plan.shots) {
    if (!Object.hasOwn(texts, shot.shotId)) continue;
    const t = tidyScene(texts[shot.shotId]);
    if (t && t !== tidyScene(shot.defaultSceneText)) out[shot.shotId] = t;
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
  /** The final prompt exactly as sent to the model. */
  prompt: string;
}

/** A finished Short's shots as they rendered (final_output.shots); [] for a Short from before #26. */
export function renderedShotsOf(shots: unknown): RenderedShot[] {
  if (!Array.isArray(shots)) return [];
  return shots.flatMap((raw) => {
    const s = obj(raw);
    const prompt = str(s?.prompt);
    if (!s || !prompt) return [];
    const id = str(s.model) ?? '';
    return [{ shotId: str(s.shot_id) ?? '', kind: str(s.kind) ?? '', modelName: MODEL_NAMES[id] ?? id, edited: s.edited === true, prompt }];
  });
}
