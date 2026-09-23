// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The workflow bundle the test harness runs: every workflow the worker
 * registers (../../workflows/index.ts), plus TEST-ONLY workflows that exist to
 * drive internal pipelines directly. Never part of the worker's workflowsPath.
 */

export * from '../../workflows/index.js';
export { renderTestPresetWorkflow } from './test-preset-workflow.js';
