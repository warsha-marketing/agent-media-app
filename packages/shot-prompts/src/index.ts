// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * @agentmedia/shot-prompts — the Shot Prompt wording, server-side only (#26).
 *
 * The scene templates, the Guardrail lines and the guardrail check that api-v2
 * (to compose and show the Shot Plan, and to validate shot edits) and
 * primitive-worker-vnext (to render, re-checking every edit and always adding
 * its own Guardrails) both need. A private workspace package: never published,
 * unlike @agentmedia/schema, because the prompt craft is the quality authority
 * and stays on the server (CONTRIBUTING.md, "the spine").
 */

export * from './guardrail-check.js';
export * from './modesty.js';
export * from './references.js';
export * from './guardrails.js';
export * from './scenes.js';
export * from './shot-fields.js';
export * from './shot-plan.js';
