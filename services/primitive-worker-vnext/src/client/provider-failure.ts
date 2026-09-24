// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * A provider failure built from the failure policy (../failure-policy.ts): its
 * code decides whether Temporal may retry it, so no client decides that on its
 * own.
 */

import { ApplicationFailure } from '@temporalio/activity';
import { failurePolicy } from '../failure-policy.js';

export function providerFailure(message: string, code: string): ApplicationFailure {
  return ApplicationFailure.create({ message, type: code, nonRetryable: !failurePolicy(code).retryable });
}
