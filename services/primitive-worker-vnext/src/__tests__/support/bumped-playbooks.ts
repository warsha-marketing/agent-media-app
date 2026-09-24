// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * TEST-ONLY: @agentmedia/shot-prompts as it would be after a deploy that
 * bumped every Playbook's version (new rules). Bundled in place of the real
 * package (a webpack alias, playbook-determinism.workflow.test.ts) to replay a
 * history recorded before the "deploy".
 */

// The real package, by path (the alias only catches the bare specifier).
export * from '../../../../../packages/shot-prompts/dist/index.js';
import {
  CATEGORY_PLAYBOOKS,
  PLAYBOOKS,
  playbookRegistry,
  resolvePlaybookChoice as resolveWith,
  type PlaybookRegistry,
} from '../../../../../packages/shot-prompts/dist/index.js';

/** Every Playbook one version on: a choice recorded before is now stale. */
export const PLAYBOOK_REGISTRY: PlaybookRegistry = playbookRegistry(
  PLAYBOOKS.map((p) => ({ ...p, version: p.version + 1 })),
  CATEGORY_PLAYBOOKS,
);

export function resolvePlaybookChoice(choice: unknown, registry: PlaybookRegistry = PLAYBOOK_REGISTRY) {
  return resolveWith(choice, registry);
}
