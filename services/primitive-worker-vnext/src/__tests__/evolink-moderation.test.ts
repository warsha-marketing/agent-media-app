import { afterEach, describe, expect, it, vi } from 'vitest';
import { pollEvolinkTask } from '../client/evolink.js';

afterEach(() => vi.unstubAllGlobals());

describe('Evolink completed-task failures', () => {
  it('stops Temporal from resubmitting a moderation-blocked video', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'failed',
      error: {
        code: 'content_policy_violation',
        message: 'The generated video was blocked by content moderation.',
      },
    })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(pollEvolinkTask('test-key', 'blocked-task')).rejects.toMatchObject({
      type: 'EVOLINK_CONTENT_POLICY_VIOLATION',
      nonRetryable: true,
      message: expect.stringContaining('blocked by content moderation'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps upstream failures eligible for the workflow retry policy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'failed',
      error: { code: 'upstream_error', message: 'Provider unavailable' },
    }))));

    const failure = await pollEvolinkTask('test-key', 'transient-task').catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('Provider unavailable');
    expect(failure.nonRetryable).not.toBe(true);
  });
});
