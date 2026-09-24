// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Reaction render definition (#19). Its scenes and Guardrails are in
 * @agentmedia/shot-prompts (REACTION_PROMPTS; the no-speaking Guardrail on every
 * shot that shows a person); the public half is REACTION in @agentmedia/schema.
 */

export { REACTION_RENDER } from './index.js';

/** The no-speaking instruction every reaction prompt carries, verbatim: a Guardrail (#26). */
export { NO_SPEAKING_PERSON as SILENT_REACTION } from '@agentmedia/shot-prompts';
