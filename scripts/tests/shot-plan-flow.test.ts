// Shot Plan review in the web flow (#26): reading the plan, turning the cards'
// text into `shot_edits` (only what changed), the request and its
// Idempotency-Key lifecycle with edits, what ran on the finished Short, and the
// mirrors of @agentmedia/shot-prompts (the length cap, the tidy, the local
// hints, the model names) held equal to the originals.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_NAMES,
  SCENE_TEXT_MAX,
  kindLabel,
  lengthLabel,
  modelLine,
  parseShotPlan,
  renderedShotsOf,
  sceneTextHint,
  shotEditsOf,
  tidyScene,
} from '../../apps/web/lib/shot-plan-flow.ts';
import {
  confirmationFor,
  initialRenderState,
  renderBody,
  renderReducer,
  shotPlanBody,
  viewOfRun,
  type RenderChoice,
  type RenderEvent,
  type RenderState,
} from '../../apps/web/lib/product-hero-flow.ts';
import {
  SCENE_TEXT_MAX_CHARS,
  VIDEO_MODEL_LABELS,
  sceneTextProblem,
  tidySceneText,
} from '../../packages/shot-prompts/src/shot-plan.ts';

const DRAFT = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';
const PHOTO = 'https://media.example/vnext/uploads/u/photo.png';

const PLAN_BODY = {
  skill: 'make_reaction',
  scene_text_max_chars: 1000,
  shots: [
    {
      shot_id: 'shot-1-reaction',
      number: 1,
      kind: 'reaction',
      shows: 'person',
      on_screen_ms: 4500,
      starting_frame: null,
      model: { id: 'kling-o3-pro', name: 'Kling O3 Pro' },
      fallback: { id: 'veo-3.1', name: 'Veo 3.1' },
      scene_text: 'The person holds the product and smiles.',
      default_scene_text: 'The person holds the product and smiles.',
      edited: false,
      guardrails: [
        { id: 'no_speaking', label: 'Nobody speaks', text: 'The person never speaks…', enforced_by: 'prompt' },
        { id: 'audio_off', label: 'Model audio off', text: 'The video model’s own audio is off…', enforced_by: 'request' },
      ],
    },
    {
      shot_id: 'shot-2-product',
      number: 2,
      kind: 'product',
      shows: 'product',
      on_screen_ms: 4500,
      starting_frame: null,
      model: { id: 'seedance-2.0', name: 'Seedance 2.0' },
      fallback: null,
      scene_text: 'A slow push-in on the product.',
      default_scene_text: 'A slow push-in on the product.',
      edited: false,
      guardrails: [{ id: 'no_people', label: 'No people', text: 'No people, no hands.', enforced_by: 'prompt' }],
    },
  ],
};

describe('parseShotPlan', () => {
  it('reads every card: number, kind, length, model → fallback, scene, locked Guardrails', () => {
    const plan = parseShotPlan(PLAN_BODY)!;
    assert.equal(plan.shots.length, 2);
    const [r, p] = plan.shots;
    assert.equal(r.shotId, 'shot-1-reaction');
    assert.equal(kindLabel(r.shows), 'Person');
    assert.equal(lengthLabel(r.onScreenMs), '4.5 s');
    assert.equal(modelLine(r), 'Kling O3 Pro → Veo 3.1');
    assert.equal(modelLine(p), 'Seedance 2.0');
    assert.deepEqual(r.guardrails.map((g) => [g.id, g.enforcedBy]), [['no_speaking', 'prompt'], ['audio_off', 'request']]);
  });

  it('is null for anything that is not a plan', () => {
    for (const b of [null, {}, { shots: 'x' }, { shots: [{ shot_id: 'a' }] }]) assert.equal(parseShotPlan(b), null);
  });
});

describe('shotEditsOf: only the shots whose scene changed', () => {
  const plan = parseShotPlan(PLAN_BODY)!;

  it('sends nothing for untouched, reset, re-spaced or emptied cards', () => {
    assert.deepEqual(shotEditsOf(plan, {}), {});
    assert.deepEqual(
      shotEditsOf(plan, {
        'shot-1-reaction': '  The person  holds the product and smiles. ',
        'shot-2-product': '   ',
      }),
      {},
    );
  });

  it('sends the changed scene, tidied, by shot id', () => {
    assert.deepEqual(shotEditsOf(plan, { 'shot-1-reaction': ' The person sniffs\n the wrist. ' }), { 'shot-1-reaction': 'The person sniffs the wrist.' });
  });

  it('ignores ids the plan does not have', () => {
    assert.deepEqual(shotEditsOf(plan, { 'shot-9-x': 'anything' }), {});
  });
});

describe('the request with edits', () => {
  const choice = (shotEdits?: Record<string, string> | null): RenderChoice => ({ draftId: DRAFT, photoUrl: PHOTO, music: true, skill: 'make_reaction', shotEdits });

  it('carries shot_edits only when there are some; the shot plan is always asked without them', () => {
    assert.equal('shot_edits' in renderBody(choice()), false);
    assert.equal('shot_edits' in renderBody(choice({})), false);
    assert.deepEqual(renderBody(choice({ 'shot-1-reaction': 'x' })).shot_edits, { 'shot-1-reaction': 'x' });
    assert.equal('shot_edits' in shotPlanBody(choice({ 'shot-1-reaction': 'x' })), false);
  });

  it('an edit is a new request: a new Idempotency-Key; the same edits (any key order) keep the key', () => {
    const first = confirmationFor(null, choice({ a: '1', b: '2' }), 'k1');
    assert.equal(confirmationFor(first, choice({ b: '2', a: '1' }), 'k2').key, 'k1');
    assert.equal(confirmationFor(first, choice({ a: '1' }), 'k2').key, 'k2');
    assert.equal(confirmationFor(first, choice(), 'k3').key, 'k3');
  });
});

describe('what ran, on the finished Short', () => {
  const FINAL = {
    video_url: 'https://m/s.mp4',
    duration_ms: 9000,
    shots: [
      { shot_id: 'shot-1-reaction', kind: 'reaction', model: 'veo-3.1', edited: true, scene: 's', guardrails: [], prompt: 'P1' },
      { shot_id: 'shot-2-product', kind: 'product', model: 'seedance-2.0', edited: false, scene: 's', guardrails: [], prompt: 'P2' },
    ],
  };

  it('the succeeded run carries its shots to the result panel', () => {
    const view = viewOfRun({ status: 'succeeded', final_output: FINAL });
    assert.equal(view.kind, 'succeeded');
    const run = (s: RenderState, ...e: RenderEvent[]) => e.reduce(renderReducer, s);
    const done = run(initialRenderState, { type: 'resume', runId: RUN }, { type: 'run_polled', runId: RUN, run: { status: 'succeeded', final_output: FINAL } });
    assert.equal(done.render.phase, 'succeeded');
    const shots = done.render.phase === 'succeeded' ? renderedShotsOf(done.render.shots) : [];
    assert.deepEqual(shots.map((s) => [s.shotId, s.modelName, s.edited, s.prompt]), [
      ['shot-1-reaction', 'Veo 3.1', true, 'P1'],
      ['shot-2-product', 'Seedance 2.0', false, 'P2'],
    ]);
  });

  it('a Short from before #26 has none', () => {
    assert.deepEqual(renderedShotsOf(undefined), []);
    assert.deepEqual(viewOfRun({ status: 'succeeded', final_output: { video_url: 'https://m/x.mp4', duration_ms: 1 } }), {
      kind: 'succeeded',
      videoUrl: 'https://m/x.mp4',
      durationMs: 1,
    });
  });
});

describe('mirrors of @agentmedia/shot-prompts', () => {
  it('the same length cap and model names', () => {
    assert.equal(SCENE_TEXT_MAX, SCENE_TEXT_MAX_CHARS);
    assert.deepEqual({ ...MODEL_NAMES }, { ...VIDEO_MODEL_LABELS });
  });

  it('the same tidy, and a local hint wherever the server refuses for form (not the guardrail check)', () => {
    const samples = [
      '',
      '   ',
      ' a  b\n c ',
      'x'.repeat(SCENE_TEXT_MAX_CHARS + 1),
      '[excited] The person smiles.',
      'The person in {person} smiles.',
      'The person in @image2 smiles.',
      'The woman from the second reference image smiles.',
      'The person sniffs the product and smiles.',
    ];
    for (const s of samples) {
      assert.equal(tidyScene(s), tidySceneText(s), JSON.stringify(s));
      const server = sceneTextProblem(s);
      const formRefusal = server !== null && server.reason !== 'guardrail';
      assert.equal(sceneTextHint(s) !== null, formRefusal, JSON.stringify(s).slice(0, 60));
    }
  });
});
