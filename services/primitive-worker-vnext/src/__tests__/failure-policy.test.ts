// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The one failure policy (#25): code → { retryable, fallbackable }. The Preset
// render's non-retryable list and fallback rule, and the provider clients'
// failures, all read it.

import { describe, it, expect } from 'vitest';
import { CONTENT_POLICY_REFUSED, FAILURE_POLICY, NON_RETRYABLE_TYPES, PROVIDER_FAILED, failurePolicy } from '../failure-policy.js';
import { providerFailure } from '../client/provider-failure.js';

describe('the failure policy', () => {
  it('keeps the stored content-refusal value (persisted runs and the web read it)', () => {
    expect(CONTENT_POLICY_REFUSED).toBe('EVOLINK_CONTENT_POLICY_VIOLATION');
  });

  it('a content refusal is never retried, but another model may accept the shot', () => {
    expect(failurePolicy(CONTENT_POLICY_REFUSED)).toEqual({ retryable: false, fallbackable: true });
  });

  it('what no other model can fix neither retries nor falls back — a missing provider key included', () => {
    for (const code of ['INVALID_INPUT', 'BUDGET_CAP_DAY', 'INSUFFICIENT_CREDITS', 'REFERENCE_URL_NOT_ALLOWED', 'PROVIDER_UNCONFIGURED']) {
      expect(failurePolicy(code), code).toEqual({ retryable: false, fallbackable: false });
    }
  });

  it('every fal failure is final for its model and tries the fallback, listed or not', () => {
    for (const code of ['FAL_FAILED', 'FAL_TIMEOUT', 'FAL_UNAVAILABLE', 'FAL_BAD_RESPONSE', 'FAL_400', 'FAL_422', 'FAL_418', PROVIDER_FAILED]) {
      expect(failurePolicy(code), code).toEqual({ retryable: false, fallbackable: true });
    }
  });

  it('every ModelArk failure is final for its model and tries the fallback, listed or not (#29)', () => {
    for (const code of ['MODELARK_FAILED', 'MODELARK_TIMEOUT', 'MODELARK_UNAVAILABLE', 'MODELARK_BAD_RESPONSE', 'MODELARK_400', 'MODELARK_401', 'MODELARK_418']) {
      expect(failurePolicy(code), code).toEqual({ retryable: false, fallbackable: true });
    }
    expect(NON_RETRYABLE_TYPES).toContain('MODELARK_FAILED');
    expect(providerFailure('x', 'MODELARK_418')).toMatchObject({ nonRetryable: true });
  });

  it('an unknown code (a network blip) is transient', () => {
    expect(failurePolicy('FAILED')).toEqual({ retryable: true, fallbackable: true });
    expect(failurePolicy(undefined)).toEqual({ retryable: true, fallbackable: true });
  });

  it('the render’s non-retryable list is exactly the map’s non-retryable codes', () => {
    expect([...NON_RETRYABLE_TYPES].sort()).toEqual(Object.keys(FAILURE_POLICY).filter((c) => !FAILURE_POLICY[c].retryable).sort());
    expect(NON_RETRYABLE_TYPES).toContain(CONTENT_POLICY_REFUSED);
  });

  it('a client failure takes its retryability from the map', () => {
    expect(providerFailure('x', 'FAL_FAILED')).toMatchObject({ type: 'FAL_FAILED', nonRetryable: true });
    expect(providerFailure('x', 'PROVIDER_UNCONFIGURED')).toMatchObject({ nonRetryable: true });
    expect(providerFailure('x', 'SOMETHING_TRANSIENT')).toMatchObject({ nonRetryable: false });
  });
});
