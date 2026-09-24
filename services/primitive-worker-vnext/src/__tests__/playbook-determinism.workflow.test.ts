// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Temporal determinism under a Playbook change (#32). A Playbook's version is
// bumped on every change and a stale choice is refused, so workflow code that
// resolved the Playbook itself would, on replay after a deploy, compose
// another plan or throw where the first run did not: a nondeterminism error
// mid-render. The render composes its plan in the presetPlan activity instead
// (workflows/preset-plan.ts, behind patched('preset-plan-in-activity')): the
// history records the plan, and a replay reads it back.
//
// The test records a fragrance Reaction render with today's Playbooks, then
// replays that history with a workflow bundle whose Playbooks are all one
// version on (every recorded choice now stale), as after a deploy.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { bundleWorkflowCode, DefaultLogger, Worker, type WorkflowBundle } from '@temporalio/worker';
import { FRAGRANCE_OUD, PLAYBOOKS, CATEGORY_PLAYBOOKS, playbookRegistry } from '@agentmedia/shot-prompts';
import { startWorkflowHarness, fakeActivities, type WorkflowHarness } from './support/workflow-harness.js';
import type { MakeReactionWorkflowInput } from '../workflows/make-reaction.js';
import type { FetchDraftAudioInput, PresetClipInput, PresetMuxInput } from '../activities/preset-render.js';
import { PRESET_PLAN_IN_ACTIVITY, PresetPlanRefusal, planPresetRender } from '../workflows/preset-plan.js';
import { presetRender } from '../presets/index.js';

const WORKFLOWS_PATH = fileURLToPath(new URL('./support/test-workflows.ts', import.meta.url));
const BUMPED_SHOT_PROMPTS = fileURLToPath(new URL('./support/bumped-playbooks.ts', import.meta.url));
const FRAGRANCE = { id: 'fragrance_oud', version: FRAGRANCE_OUD.version, pattern: 'spray-then-smell' };

const input: MakeReactionWorkflowInput = {
  skill_run_id: '44444444-2222-4333-8444-555555555555',
  user_id: 'user-1',
  draft_id: 'draft-44',
  audio_key: 'vnext/drafts/user-1/draft-44.mp3',
  duration_ms: 9_000,
  product_image_url: 'https://r2.example.test/uploads/product.png',
  character_image_url: 'https://r2.example.test/uploads/character.png',
  aspect_ratio: '9:16',
  modesty: { arms: 'covered', hijab: true },
  character_gender: 'female',
  product_interaction: 'holds the uncapped bottle, sprays once on the inner wrist, sets the bottle down, then raises the wrist to the nose and smiles',
  playbook: FRAGRANCE,
};

const fakes = () =>
  fakeActivities({
    composedSkillState: undefined,
    refundCredits: undefined,
    markPrimitiveRunFailed: undefined,
    releaseDraftRender: undefined,
    fetchDraftAudio: (i: FetchDraftAudioInput) => ({ primitive_run_id: i.primitive_run_id, audio_key: i.audio_key, duration_ms: i.duration_ms }),
    presetClip: (i: PresetClipInput) => ({
      primitive_run_id: i.primitive_run_id,
      video_url: `https://r2.example.test/clips/${i.shot_index}.mp4`,
      duration_seconds: i.duration,
      credits_actual_usd: 0.6,
      model: i.model ?? 'seedance-2.0',
      prompt: i.prompt,
    }),
    presetMux: (i: PresetMuxInput) => ({
      primitive_run_id: i.primitive_run_id,
      video_url: 'https://r2.example.test/shorts/final.mp4',
      duration_ms: i.audio_duration_ms,
      artifact_id: 'artifact-short',
    }),
  });

let harness: WorkflowHarness;
let afterDeploy: WorkflowBundle;

beforeAll(async () => {
  [harness, afterDeploy] = await Promise.all([
    startWorkflowHarness(),
    bundleWorkflowCode({
      workflowsPath: WORKFLOWS_PATH,
      logger: new DefaultLogger('WARN'),
      webpackConfigHook: (config) => {
        config.resolve = { ...config.resolve, alias: { ...(config.resolve?.alias as object), '@agentmedia/shot-prompts$': BUMPED_SHOT_PROMPTS } };
        return config;
      },
    }) as Promise<WorkflowBundle>,
  ]);
}, 180_000);

afterAll(async () => {
  await harness?.teardown();
});

describe('a Playbook version bump between a render’s start and its replay', () => {
  it('the recorded render replays deterministically on the bumped Playbooks (the plan is the activity’s)', async () => {
    const f = fakes();
    const taskQueue = `determinism-${randomUUID()}`;
    const worker = await Worker.create({ connection: harness.env.nativeConnection, taskQueue, workflowBundle: harness.bundle, activities: f.activities });
    await worker.runUntil(harness.env.client.workflow.execute('makeReactionWorkflow', { args: [input], taskQueue, workflowId: taskQueue }));
    // The plan was composed once, by the activity, with today's Playbook.
    expect(f.plans.map((p) => p.playbook)).toEqual([FRAGRANCE]);
    expect((f.callsTo('presetClip') as PresetClipInput[]).map((c) => c.shot_kind)).toEqual(['reaction', 'reaction', 'product']);
    const history = await harness.env.client.workflow.getHandle(taskQueue).fetchHistory();
    // The patch marker is in the history: a replay takes the activity path.
    const patches = (history.events ?? []).flatMap((e) =>
      (e.markerRecordedEventAttributes?.details?.['patch-data']?.payloads ?? []).map(
        (p) => (JSON.parse(Buffer.from(p.data as Uint8Array).toString('utf8')) as { id: string }).id,
      ),
    );
    expect(patches).toEqual([PRESET_PLAN_IN_ACTIVITY]);

    // "Deploy": every Playbook one version on. The replay must not diverge.
    await expect(Worker.runReplayHistory({ workflowBundle: afterDeploy }, history, taskQueue)).resolves.toBeUndefined();
  }, 120_000);

  it('composing that plan again after the bump would refuse it: why it is never composed in workflow code', () => {
    const bumped = playbookRegistry(PLAYBOOKS.map((p) => ({ ...p, version: p.version + 1 })), CATEGORY_PLAYBOOKS);
    const planInput = {
      preset: 'reaction',
      duration_ms: input.duration_ms,
      modesty: input.modesty!,
      vars: {},
      interaction: input.product_interaction ?? null,
      person: { gender: 'female' as const, description: null },
      product: { profile: null, inUseReference: false },
      playbook: FRAGRANCE,
      shot_edits: null,
    };
    expect(planPresetRender(planInput, presetRender('reaction')).shots).toHaveLength(3);
    expect(() => planPresetRender(planInput, presetRender('reaction'), bumped)).toThrow(PresetPlanRefusal);
    expect(() => planPresetRender(planInput, presetRender('reaction'), bumped)).toThrow(/rules changed/);
  });
});
