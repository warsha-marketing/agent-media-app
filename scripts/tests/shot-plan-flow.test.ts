// Shot Plan review in the web flow (#26, #28): reading the
// plan (structured fields, Guardrails per stage), turning the cards' fields
// into `shot_edits` ({ shot_id: { field: value } }, only what changed), the
// request and its Idempotency-Key lifecycle with edits, what ran on the
// finished Short, and what the page reads from the server instead of
// hard-coding (the length cap, the energies, the model names), with the tiny
// fallbacks for before the response arrives and the tidy and local hints held
// equal to @agentmedia/shot-prompts.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FALLBACK_ENERGIES,
  FALLBACK_SCENE_TEXT_MAX,
  fieldRows,
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
import { SHOT_ENERGIES, SHOT_FIELD_MAX_CHARS, shotFieldProblem, tidyFieldText } from '../../packages/shot-prompts/src/shot-fields.ts';

const DRAFT = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';
const PHOTO = 'https://media.example/vnext/uploads/u/photo.png';

const FIELDS = (over: Record<string, string>) => ({
  framing: '',
  scene: '',
  blocking: '',
  environment_interaction: '',
  performance: '',
  action: '',
  energy: 'calm',
  camera_move: '',
  lens_feel: '',
  lighting: '',
  ...over,
});
const REACTION_FIELDS = FIELDS({
  framing: 'UGC-style reaction shot, medium close-up.',
  scene: 'The person holds the product and smiles.',
  performance: 'A small approving nod.',
  energy: 'natural',
  camera_move: 'Gentle handheld feel.',
});
const PRODUCT_FIELDS = FIELDS({ scene: 'A slow push-in on the product.' });

const PLAN_BODY = {
  skill: 'make_reaction',
  set: null,
  fields: [
    { id: 'framing', label: 'Framing', max_chars: 300, required: false },
    { id: 'scene', label: 'Scene', max_chars: 1000, required: true },
    { id: 'performance', label: 'Performance', max_chars: 300, required: false },
    { id: 'energy', label: 'Energy', choices: ['calm', 'natural', 'lively'], required: false },
    { id: 'camera_move', label: 'Camera move', max_chars: 300, required: false },
  ],
  shots: [
    {
      shot_id: 'reaction',
      number: 1,
      kind: 'reaction',
      shows: 'person',
      on_screen_ms: 4500,
      starting_frame: null,
      model: { id: 'kling-o3-pro', name: 'Kling O3 Pro' },
      fallback: { id: 'veo-3.1', name: 'Veo 3.1' },
      fields: REACTION_FIELDS,
      default_fields: REACTION_FIELDS,
      edited: false,
      guardrails: {
        image: [],
        video: [
          { id: 'no_speaking', label: 'Nobody speaks', text: 'The person never speaks…', enforced_by: 'prompt' },
          { id: 'audio_off', label: 'Model audio off', text: 'The video model’s own audio is off…', enforced_by: 'request' },
        ],
      },
    },
    {
      shot_id: 'product-closer',
      number: 2,
      kind: 'product',
      shows: 'product',
      on_screen_ms: 4500,
      starting_frame: null,
      model: { id: 'seedance-2.0', name: 'Seedance 2.0' },
      fallback: null,
      fields: PRODUCT_FIELDS,
      default_fields: PRODUCT_FIELDS,
      edited: false,
      guardrails: { image: [], video: [{ id: 'no_people', label: 'No people', text: 'No people, no hands.', enforced_by: 'prompt' }] },
    },
  ],
};

describe('parseShotPlan', () => {
  it('reads every card: number, kind, length, model → fallback, fields, locked Guardrails per stage', () => {
    const plan = parseShotPlan(PLAN_BODY)!;
    assert.equal(plan.shots.length, 2);
    assert.equal(plan.sceneTextMax, 1000);
    const [r, p] = plan.shots;
    assert.equal(r.shotId, 'reaction');
    assert.equal(kindLabel(r.shows), 'Person');
    assert.equal(lengthLabel(r.onScreenMs), '4.5 s');
    assert.equal(modelLine(r), 'Kling O3 Pro → Veo 3.1');
    assert.equal(modelLine(p), 'Seedance 2.0');
    assert.equal(r.fields.scene, 'The person holds the product and smiles.');
    assert.equal(r.fields.energy, 'natural');
    assert.deepEqual(r.guardrails.image, []);
    assert.deepEqual(r.guardrails.video.map((g) => [g.id, g.enforcedBy]), [['no_speaking', 'prompt'], ['audio_off', 'request']]);
  });

  it('lists the structured fields read-only, labelled, in the server’s order — not the ones the card edits, nor empty ones', () => {
    const plan = parseShotPlan(PLAN_BODY)!;
    assert.deepEqual(fieldRows(plan, plan.shots[0]), [
      { id: 'framing', label: 'Framing', value: 'UGC-style reaction shot, medium close-up.' },
      { id: 'performance', label: 'Performance', value: 'A small approving nod.' },
      { id: 'camera_move', label: 'Camera move', value: 'Gentle handheld feel.' },
    ]);
    assert.deepEqual(fieldRows(plan, plan.shots[1]), []);
  });

  it('takes the scene cap, the energies and the model names from the response, not from a copy', () => {
    const plan = parseShotPlan(PLAN_BODY)!;
    assert.deepEqual(plan.energies, ['calm', 'natural', 'lively']);
    const custom = parseShotPlan({
      ...PLAN_BODY,
      fields: PLAN_BODY.fields.map((f) =>
        f.id === 'scene' ? { ...f, max_chars: 640 } : f.id === 'energy' ? { ...f, choices: ['calm', 'lively', 'frantic'] } : f,
      ),
      shots: [{ ...PLAN_BODY.shots[0], model: { id: 'seedance-2.0-mini', name: 'Seedance 2.0 Mini' }, fallback: { id: 'new-model' } }],
    })!;
    assert.equal(custom.sceneTextMax, 640);
    assert.deepEqual(custom.energies, ['calm', 'lively', 'frantic']);
    assert.equal(modelLine(custom.shots[0]), 'Seedance 2.0 Mini → new-model');
    // A response without a field catalog (an older server) falls back to the tiny defaults.
    const bare = parseShotPlan({ ...PLAN_BODY, fields: undefined })!;
    assert.equal(bare.sceneTextMax, FALLBACK_SCENE_TEXT_MAX);
    assert.deepEqual(bare.energies, [...FALLBACK_ENERGIES]);
  });

  it('is null for anything that is not a plan (#26’s scene_text shape too)', () => {
    const old = { shots: [{ shot_id: 'shot-1-reaction', scene_text: 'x', model: { id: 'veo-3.1' } }] };
    for (const b of [null, {}, { shots: 'x' }, { shots: [{ shot_id: 'a' }] }, old]) assert.equal(parseShotPlan(b), null);
  });
});

describe('shotEditsOf: only the fields that changed', () => {
  const plan = parseShotPlan(PLAN_BODY)!;

  it('sends nothing for untouched, reset, re-spaced or emptied cards', () => {
    assert.deepEqual(shotEditsOf(plan, {}), {});
    assert.deepEqual(
      shotEditsOf(plan, {
        'reaction': { scene: '  The person  holds the product and smiles. ', energy: 'natural' },
        'product-closer': { scene: '   ' },
      }),
      {},
    );
  });

  it('sends the changed fields, tidied, by shot id then field', () => {
    assert.deepEqual(shotEditsOf(plan, { 'reaction': { scene: ' The person sniffs\n the wrist. ', energy: 'natural' } }), {
      'reaction': { scene: 'The person sniffs the wrist.' },
    });
    assert.deepEqual(shotEditsOf(plan, { 'reaction': { energy: 'lively' }, 'product-closer': { scene: 'A quick whip pan to the product.' } }), {
      'reaction': { energy: 'lively' },
      'product-closer': { scene: 'A quick whip pan to the product.' },
    });
  });

  it('ignores ids and fields the plan does not have', () => {
    assert.deepEqual(shotEditsOf(plan, { 'shot-9-x': { scene: 'anything' }, 'reaction': { mood: 'happy' } }), {});
  });
});

describe('the request with edits', () => {
  const choice = (shotEdits?: Record<string, Record<string, string>> | null): RenderChoice => ({
    draftId: DRAFT,
    photoUrl: PHOTO,
    music: true,
    skill: 'make_reaction',
    shotEdits,
  });

  it('carries shot_edits only when there are some; the shot plan is always asked without them', () => {
    assert.equal('shot_edits' in renderBody(choice()), false);
    assert.equal('shot_edits' in renderBody(choice({})), false);
    assert.deepEqual(renderBody(choice({ 'reaction': { scene: 'x' } })).shot_edits, { 'reaction': { scene: 'x' } });
    assert.equal('shot_edits' in shotPlanBody(choice({ 'reaction': { scene: 'x' } })), false);
  });

  it('an edit is a new request: a new Idempotency-Key; the same edits (any shot or field order) keep the key', () => {
    const first = confirmationFor(null, choice({ a: { scene: '1', energy: 'lively' }, b: { scene: '2' } }), 'k1');
    assert.equal(confirmationFor(first, choice({ b: { scene: '2' }, a: { energy: 'lively', scene: '1' } }), 'k2').key, 'k1');
    assert.equal(confirmationFor(first, choice({ a: { scene: '1' }, b: { scene: '2' } }), 'k2').key, 'k2');
    assert.equal(confirmationFor(first, choice(), 'k3').key, 'k3');
  });
});

describe('what ran, on the finished Short', () => {
  const FINAL = {
    video_url: 'https://m/s.mp4',
    duration_ms: 9000,
    shots: [
      { shot_id: 'reaction', kind: 'reaction', model: 'veo-3.1', model_name: 'Veo 3.1', edited: true, fields: {}, guardrails: { image: [], video: [] }, prompt: 'P1' },
      { shot_id: 'hands-use', kind: 'hands', model: 'seedance-2.0', model_name: 'Seedance 2.0', edited: false, fields: {}, guardrails: { image: [], video: [] }, frame_prompt: 'F2', prompt: 'P2' },
      // A Short rendered before the result named its models: the id.
      { shot_id: 'product-closer', kind: 'product', model: 'seedance-2.0', edited: false, fields: {}, guardrails: { image: [], video: [] }, prompt: 'P3' },
    ],
  };

  it('the succeeded run carries its shots to the result panel', () => {
    const view = viewOfRun({ status: 'succeeded', final_output: FINAL });
    assert.equal(view.kind, 'succeeded');
    const run = (s: RenderState, ...e: RenderEvent[]) => e.reduce(renderReducer, s);
    const done = run(initialRenderState, { type: 'resume', runId: RUN }, { type: 'run_polled', runId: RUN, run: { status: 'succeeded', final_output: FINAL } });
    assert.equal(done.render.phase, 'succeeded');
    const shots = done.render.phase === 'succeeded' ? renderedShotsOf(done.render.shots) : [];
    assert.deepEqual(shots.map((s) => [s.shotId, s.modelName, s.edited, s.framePrompt, s.prompt]), [
      ['reaction', 'Veo 3.1', true, null, 'P1'],
      ['hands-use', 'Seedance 2.0', false, 'F2', 'P2'],
      ['product-closer', 'seedance-2.0', false, null, 'P3'],
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
  it('the fallbacks for before the response arrives are the server’s own values', () => {
    assert.equal(FALLBACK_SCENE_TEXT_MAX, SHOT_FIELD_MAX_CHARS.scene);
    assert.deepEqual([...FALLBACK_ENERGIES], [...SHOT_ENERGIES]);
  });

  it('the same tidy, and a local hint wherever the server refuses for form (not the guardrail check)', () => {
    const samples = [
      '',
      '   ',
      ' a  b\n c ',
      'x'.repeat(SHOT_FIELD_MAX_CHARS.scene + 1),
      '[excited] The person smiles.',
      'The person in {person} smiles.',
      'The person in @image2 smiles.',
      'The woman from the second reference image smiles.',
      'The person sniffs the product and smiles.',
    ];
    for (const s of samples) {
      assert.equal(tidyScene(s), tidyFieldText(s), JSON.stringify(s));
      const server = shotFieldProblem('scene', s);
      const formRefusal = server !== null && server.reason !== 'guardrail';
      assert.equal(sceneTextHint(s) !== null, formRefusal, JSON.stringify(s).slice(0, 60));
    }
  });
});
