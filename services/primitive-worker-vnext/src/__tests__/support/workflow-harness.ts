// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Workflow test harness: run a real workflow from ../../workflows (plus the
 * test-only drivers in ./test-workflows.ts) in Temporal's
 * time-skipping test environment against FAKE activities, so pipeline order and
 * outcomes are testable without providers, a database, or a Temporal server.
 *
 *   const harness = await startWorkflowHarness();      // once per file (beforeAll)
 *   const fakes = fakeActivities({ productInHands: media, refundCredits: undefined });
 *   const result = await harness.execute('productInHandsWorkflow', [input], fakes);
 *   fakes.calls  // [{ name: 'productInHands', order: 0, input }]
 *   await harness.teardown();                          // afterAll
 *
 * Time-skipping (not createLocal) because workflows here sleep through retry
 * backoff and long activity timeouts; the test server fast-forwards those.
 * The test server is a native binary the SDK downloads once and caches in the
 * OS temp dir. For fully offline runs, point TEMPORAL_TEST_SERVER_PATH at a
 * pre-fetched `temporal-test-server` executable.
 */

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Context, ApplicationFailure } from '@temporalio/activity';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { bundleWorkflowCode, DefaultLogger, Runtime, Worker, type WorkflowBundle } from '@temporalio/worker';
import type { PrimitiveActivities } from '../../activities/index.js';
import type * as workflows from './test-workflows.js';

type Workflows = typeof workflows;
type WorkflowName = keyof Workflows;

/** One recorded activity invocation. `order` is 0-based across the whole fake set. */
export interface ActivityCall {
  name: string;
  order: number;
  input: unknown;
}

/**
 * A canned result for one activity: either the value to return, or a function
 * standing in for the activity (throw from it to simulate a provider failure).
 */
export type Canned<F> = F extends (input: infer I) => Promise<infer R> ? R | ((input: I) => R | Promise<R>) : never;

export type CannedActivities = { [K in keyof PrimitiveActivities]?: Canned<PrimitiveActivities[K]> };

export interface FakeActivities {
  /** Register these on the Worker. */
  activities: Record<string, (input: unknown) => Promise<unknown>>;
  /** Every call, in the order the workflow made them (unregistered ones included). */
  calls: ActivityCall[];
  /** Activity names in call order. */
  names(): string[];
  /** Inputs of every call to one activity, in order. */
  callsTo(name: keyof PrimitiveActivities): unknown[];
}

/**
 * Fake activities keyed by the real activity names. Any activity the workflow
 * calls that was NOT canned is still recorded, then fails non-retryably with
 * FAKE_NOT_REGISTERED, so an unexpected step shows up loudly instead of
 * retrying until the workflow times out.
 */
export function fakeActivities(canned: CannedActivities): FakeActivities {
  const calls: ActivityCall[] = [];
  const record = (name: string, input: unknown) => calls.push({ name, order: calls.length, input });

  const activities: FakeActivities['activities'] = {};
  for (const [name, result] of Object.entries(canned)) {
    activities[name] = async (input: unknown) => {
      record(name, input);
      return typeof result === 'function' ? (result as (i: unknown) => unknown)(input) : result;
    };
  }
  // Temporal routes activity types with no registered function to 'default'.
  activities.default = async (input: unknown) => {
    const name = Context.current().info.activityType;
    record(name, input);
    throw ApplicationFailure.nonRetryable(`no fake canned for activity ${name}`, 'FAKE_NOT_REGISTERED');
  };

  return {
    activities,
    calls,
    names: () => calls.map((c) => c.name),
    callsTo: (name) => calls.filter((c) => c.name === name).map((c) => c.input),
  };
}

export interface WorkflowHarness {
  env: TestWorkflowEnvironment;
  /** Run one workflow to completion on a fresh task queue with the given fakes. */
  execute<K extends WorkflowName>(
    workflowType: K,
    args: Parameters<Workflows[K]>,
    fakes: FakeActivities,
  ): Promise<Awaited<ReturnType<Workflows[K]>>>;
  teardown(): Promise<void>;
}

// The worker's registered workflows plus test-only drivers of internal pipelines.
const WORKFLOWS_PATH = fileURLToPath(new URL('./test-workflows.ts', import.meta.url));

/** Start the test server and bundle the worker's workflows (once per test file). */
export async function startWorkflowHarness(): Promise<WorkflowHarness> {
  try {
    // Keep SDK chatter out of test output. ERROR, not WARN: failure-path tests
    // make activities and workflows fail on purpose, which the SDK logs at WARN.
    Runtime.install({ logger: new DefaultLogger('ERROR') });
  } catch {
    // Already installed by an earlier harness in this process; keep it.
  }

  const testServerPath = process.env.TEMPORAL_TEST_SERVER_PATH;
  const [env, workflowBundle] = await Promise.all([
    TestWorkflowEnvironment.createTimeSkipping(
      testServerPath ? { server: { executable: { type: 'existing-path', path: testServerPath } } } : undefined,
    ),
    bundleWorkflowCode({ workflowsPath: WORKFLOWS_PATH, logger: new DefaultLogger('WARN') }) as Promise<WorkflowBundle>,
  ]);

  // Untyped inside; the WorkflowHarness signature types calls per workflow.
  const execute = async (workflowType: WorkflowName, args: unknown[], fakes: FakeActivities) => {
    const taskQueue = `test-${workflowType}-${randomUUID()}`;
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowBundle,
      activities: fakes.activities,
    });
    return worker.runUntil(env.client.workflow.execute(workflowType, { args, taskQueue, workflowId: taskQueue }));
  };

  return {
    env,
    execute: execute as WorkflowHarness['execute'],
    teardown: () => env.teardown(),
  };
}
