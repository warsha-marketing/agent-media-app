// Copyright 2026 agent-media contributors. Apache-2.0 license.

'use client';

/**
 * Shot Plan review (#26, #28) on /dashboard/product-hero: an
 * optional, collapsed "Review shots" panel before Confirm. One card per shot
 * the render will make — number, kind, on-screen length, model → fallback —
 * with its scene (editable, "Reset to Preset"), its energy (calm | natural |
 * lively), its other structured fields (framing, blocking, camera move, …;
 * read-only here) and its Guardrails per stage as locked chips. The server
 * composes the plan and always adds the Guardrails itself; this panel only
 * reports the changed fields (lib/shot-plan-flow.ts shotEditsOf), which the
 * page adds to the request, re-quoting it. Never opening it renders exactly as
 * before. Also: RenderedShots, what ran, on the finished Short.
 */

import { useEffect, useState, type CSSProperties } from 'react';
import { ChevronDown, Clapperboard, Loader2, Lock, RotateCcw } from 'lucide-react';
import { postJson } from '@/lib/post-json';
import { apiErrorMessage, shotPlanBody, skillOf, type RenderChoice } from '@/lib/product-hero-flow';
import {
  ENERGIES,
  fieldRows,
  kindLabel,
  lengthLabel,
  modelLine,
  parseShotPlan,
  renderedShotsOf,
  sceneTextHint,
  shotEditsOf,
  tidyScene,
  type ShotGuardrail,
  type ShotPlan,
} from '@/lib/shot-plan-flow';

const card = { border: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#14151F' } as const;
const inner = { border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#0F1015' } as const;
const muted = { color: 'rgba(255,255,255,0.45)' } as const;
const text = { color: 'rgba(255,255,255,0.75)' } as const;
const label = 'text-[11px] uppercase tracking-wider';
const field: CSSProperties = { border: '1px solid rgba(255,255,255,0.1)', backgroundColor: '#0F1015', color: '#E9E9F0' };
const chip: CSSProperties = { border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.7)' };
const warn = { color: '#FCA5A5' } as const;

export function ShotPlanReview({
  choice,
  disabled,
  onEdits,
}: {
  /** The request as it stands (its edits are ignored: the plan is always fetched with the Preset's scenes). */
  choice: RenderChoice;
  disabled: boolean;
  /** The changed fields, by shot id then field, whenever a card is left or reset. */
  onEdits: (edits: Record<string, Record<string, string>>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<ShotPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Each shot's editable fields as they stand in the cards (scene, energy). */
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});

  // Fetched the first time the panel opens (the page remounts it for a new draft or Preset inputs).
  useEffect(() => {
    if (!open || plan) return;
    let live = true;
    void (async () => {
      setError(null);
      const r = await postJson(`/api/v1/skills/${skillOf(choice)}/shot-plan`, shotPlanBody(choice));
      if (!live) return;
      const parsed = r.status === 200 ? parseShotPlan(r.body) : null;
      if (!parsed) {
        setError(apiErrorMessage(r.body) ?? `Could not load the shots (HTTP ${r.status}).`);
        return;
      }
      setPlan(parsed);
      setValues(
        Object.fromEntries(
          parsed.shots.map((s) => [
            s.shotId,
            {
              scene: choice.shotEdits?.[s.shotId]?.scene ?? s.fields.scene,
              energy: choice.shotEdits?.[s.shotId]?.energy ?? s.fields.energy ?? '',
            },
          ]),
        ),
      );
    })();
    return () => {
      live = false;
    };
  }, [open, plan, choice]);

  const commit = (next: Record<string, Record<string, string>>) => {
    if (plan) onEdits(shotEditsOf(plan, next));
  };
  const setField = (shotId: string, field: string, value: string) =>
    setValues((cur) => ({ ...cur, [shotId]: { ...cur[shotId], [field]: value } }));
  const edited = plan ? Object.keys(shotEditsOf(plan, values)).length : 0;

  return (
    <section className="mt-6 rounded-2xl" style={card} aria-label="Review shots">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-5 py-4 text-left text-sm font-semibold"
        style={{ color: '#E9E9F0' }}
      >
        <Clapperboard className="h-4 w-4" />
        Review shots
        <span className="font-normal" style={muted}>
          {edited ? `· ${edited} edited` : '· optional'}
        </span>
        <ChevronDown className="ml-auto h-4 w-4 transition-transform" style={{ transform: open ? 'rotate(180deg)' : undefined, ...muted }} />
      </button>
      {open ? (
        <div className="flex flex-col gap-3 px-5 pb-5">
          <p className="text-xs" style={muted}>
            Every shot the render will make, and the prompt its video model gets. You can change what happens in a
            shot and how lively it feels; the locked lines are always added by the server. Editing never changes the
            price.
          </p>
          {error ? (
            <p role="alert" className="text-sm" style={warn}>{error}</p>
          ) : !plan ? (
            <p className="inline-flex items-center gap-2 text-sm" style={text}>
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the shots…
            </p>
          ) : (
            plan.shots.map((shot) => {
              const card = values[shot.shotId] ?? {};
              const value = card.scene ?? shot.fields.scene;
              const energy = card.energy ?? shot.fields.energy ?? '';
              const sceneChanged = tidyScene(value) !== tidyScene(shot.defaultFields.scene ?? '');
              const changed = sceneChanged || energy !== (shot.defaultFields.energy ?? '');
              const hint = sceneChanged ? sceneTextHint(value, plan.sceneTextMax) : null;
              const rows = fieldRows(plan, shot);
              return (
                <article key={shot.shotId} className="flex flex-col gap-2 rounded-xl p-4" style={inner} aria-label={`Shot ${shot.number}`}>
                  <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                    <span className="font-semibold" style={{ color: '#E9E9F0' }}>Shot {shot.number}</span>
                    <span style={text}>{kindLabel(shot.shows)}</span>
                    <span style={muted}>{lengthLabel(shot.onScreenMs)} on screen</span>
                    <span className="ml-auto text-xs" style={muted}>{modelLine(shot)}</span>
                  </header>
                  <label className={label} style={muted} htmlFor={`scene-${shot.shotId}`}>
                    Scene{sceneChanged ? <span className="ml-2 normal-case tracking-normal" style={{ color: '#C9B8FF' }}>edited</span> : null}
                  </label>
                  <textarea
                    id={`scene-${shot.shotId}`}
                    dir="ltr"
                    lang="en"
                    value={value}
                    readOnly={disabled}
                    maxLength={plan.sceneTextMax}
                    rows={4}
                    onChange={(e) => setField(shot.shotId, 'scene', e.target.value)}
                    onBlur={() => commit(values)}
                    className="w-full resize-y rounded-xl px-3 py-2 text-sm outline-none"
                    style={field}
                  />
                  {hint ? <p role="alert" className="text-xs" style={warn}>{hint}</p> : null}
                  <div className="flex flex-wrap items-center gap-2">
                    {energy ? (
                      <label className="inline-flex items-center gap-2 text-xs" style={muted}>
                        Energy
                        <select
                          value={energy}
                          disabled={disabled}
                          onChange={(e) => {
                            const next = { ...values, [shot.shotId]: { ...card, scene: value, energy: e.target.value } };
                            setValues(next);
                            commit(next);
                          }}
                          className="h-8 rounded-lg px-2 text-xs outline-none"
                          style={field}
                        >
                          {ENERGIES.map((e) => (
                            <option key={e} value={e}>
                              {e}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <button
                      type="button"
                      disabled={disabled || !changed}
                      onClick={() => {
                        const next = {
                          ...values,
                          [shot.shotId]: { scene: shot.defaultFields.scene ?? '', energy: shot.defaultFields.energy ?? '' },
                        };
                        setValues(next);
                        commit(next);
                      }}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold disabled:opacity-40"
                      style={{ border: '1px solid rgba(167,139,250,0.5)', color: '#C9B8FF' }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Reset to Preset
                    </button>
                  </div>
                  {rows.length ? (
                    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
                      {rows.map((r) => (
                        <div key={r.id} className="contents">
                          <dt style={muted}>{r.label}</dt>
                          <dd style={text}>{r.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {shot.guardrails.image.length ? <Guardrails title="Starting frame · always added" lines={shot.guardrails.image} /> : null}
                  <Guardrails title={shot.guardrails.image.length ? 'Video · always added' : 'Guardrails · always added'} lines={shot.guardrails.video} />
                </article>
              );
            })
          )}
        </div>
      ) : null}
    </section>
  );
}

/** One stage's locked Guardrails: chips, and the lines themselves on request. */
function Guardrails({ title, lines }: { title: string; lines: ShotGuardrail[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={label} style={muted}>{title}</span>
      <ul className="flex flex-wrap gap-1.5">
        {lines.map((g) => (
          <li key={g.id} title={g.text} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs" style={chip}>
            <Lock className="h-3 w-3" aria-hidden /> {g.label}
          </li>
        ))}
      </ul>
      <details className="text-xs" style={muted}>
        <summary className="cursor-pointer">The locked lines</summary>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
          {lines.map((g) => (
            <li key={g.id}>{g.text}{g.enforcedBy === 'request' ? ' (set on the request, not in the prompt)' : ''}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** What ran (#26): each shot's final prompt, as sent to its model, on the finished Short. */
export function RenderedShots({ shots }: { shots: unknown }) {
  const rendered = renderedShotsOf(shots);
  if (!rendered.length) return null;
  return (
    <details className="rounded-xl p-3 text-sm" style={inner}>
      <summary className="cursor-pointer" style={text}>The Shot Prompts that ran ({rendered.length} shots)</summary>
      <ol className="mt-2 flex flex-col gap-2">
        {rendered.map((s, i) => (
          <li key={s.shotId || i} className="flex flex-col gap-1">
            <span className="text-xs" style={muted}>
              Shot {i + 1} · {s.kind} · {s.modelName}
              {s.edited ? ' · your scene' : ''}
            </span>
            {s.framePrompt ? (
              <p className="whitespace-pre-wrap text-xs" style={muted}>Starting frame: {s.framePrompt}</p>
            ) : null}
            <p className="whitespace-pre-wrap text-xs" style={text}>{s.prompt}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}
