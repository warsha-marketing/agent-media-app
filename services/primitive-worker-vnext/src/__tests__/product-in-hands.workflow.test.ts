// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// product_in_hands, driven end to end through the real workflow code in
// Temporal's test workflow environment. Providers are faked at the activity
// boundary: the fakes record what ran, in what order, with what input, and
// return fixed media — so this asserts pipeline order and outcomes, never
// provider internals.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ApplicationFailure } from '@temporalio/activity';
import { WorkflowFailedError } from '@temporalio/client';
import { startWorkflowHarness, fakeActivities, type WorkflowHarness } from './support/workflow-harness.js';
import type {
  ProductInHandsActivityInput,
  ProductInHandsActivityResult,
} from '../activities/product-in-hands.js';

const input: ProductInHandsActivityInput = {
  primitive_run_id: 'run-123',
  user_id: 'user-1',
  input: { product_image_url: 'https://example.test/product.png', prompt: 'hold it up' },
};

const media: ProductInHandsActivityResult = {
  primitive_run_id: 'run-123',
  video_url: 'https://media.example.test/run-123.mp4',
  provider: 'seedance-2-0',
  credits_actual_usd: 0.42,
  artifact_id: 'artifact-1',
  duration_seconds: 5,
};

let harness: WorkflowHarness;

beforeAll(async () => {
  harness = await startWorkflowHarness();
}, 120_000);

afterAll(async () => {
  await harness?.teardown();
});

describe('productInHandsWorkflow', () => {
  it('renders once and returns the rendered media, with no compensation', async () => {
    const fakes = fakeActivities({
      productInHands: media,
      refundCredits: undefined,
      markPrimitiveRunFailed: undefined,
    });

    const result = await harness.execute('productInHandsWorkflow', [input], fakes);

    expect(result).toEqual(media);
    expect(fakes.calls).toEqual([{ name: 'productInHands', order: 0, input }]);
  });

  it('refunds and stamps the run failed when the render terminally fails', async () => {
    const fakes = fakeActivities({
      productInHands: () => {
        throw ApplicationFailure.nonRetryable('prompt rejected', 'EVOLINK_422');
      },
      refundCredits: undefined,
      markPrimitiveRunFailed: undefined,
    });

    const run = harness.execute('productInHandsWorkflow', [input], fakes);

    await expect(run).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(fakes.names()).toEqual(['productInHands', 'refundCredits', 'markPrimitiveRunFailed']);
    expect(fakes.callsTo('refundCredits')).toEqual([{ primitive_run_id: 'run-123' }]);
    expect(fakes.callsTo('markPrimitiveRunFailed')).toEqual([
      { primitive_run_id: 'run-123', error_code: 'EVOLINK_422', error_message: 'prompt rejected' },
    ]);
  });
});
