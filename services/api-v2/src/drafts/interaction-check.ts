// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The Product Interaction guardrail check (#25). The check itself lives in
 * @agentmedia/shot-prompts (server-only, shared with the worker, which re-checks
 * edited Shot Prompt scenes with it, #26); this module keeps the drafts' import.
 */

export {
  foldForGuardrails,
  guardrailIssue,
  productInteractionGuardrailIssue,
  type InteractionGuardrail,
  type InteractionGuardrailIssue,
} from '@agentmedia/shot-prompts';
