// Copyright 2026 agent-media contributors. Apache-2.0 license.

import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../server.js', () => ({ supabase: { from } }));

const { quoteSkillRoute } = await import('../routes/v1/skills.js');

beforeEach(() => {
  from.mockReset();
  from.mockImplementation(() => {
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      is: () => query,
      gte: () => query,
      limit: async () => ({ data: [] }),
      maybeSingle: async () => ({
        data: { monthly_credits_remaining: 0, purchased_balance: 0 },
      }),
    };
    return query;
  });
});
afterEach(() => vi.unstubAllEnvs());

async function quote(body: unknown = { script: 'A quick local video test.' }, userId: string | undefined = 'test-user') {
  const req = { userId, params: { slug: 'make_ugc' }, body } as unknown as Request;
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  await quoteSkillRoute(req, res as unknown as Response);
  return res;
}

describe('skill quote billing mode', () => {
  it.each(['disabled', ' DISABLED '])('does not block a zero-balance self-hoster with mode %s', async (mode) => {
    vi.stubEnv('BILLING_MODE', mode);
    const res = await quote();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      slug: 'make_ugc', credits: 0, available: null, committed: 0, sufficient: true,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'enabled', 'disable'])('still blocks insufficient credits with mode %s', async (mode) => {
    vi.stubEnv('BILLING_MODE', mode);
    const res = await quote();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      credits: expect.any(Number), available: 0, sufficient: false,
    }));
    expect(res.json.mock.calls[0][0].credits).toBeGreaterThan(0);
  });

  it('still rejects invalid input when billing is disabled', async () => {
    vi.stubEnv('BILLING_MODE', 'disabled');
    const res = await quote({ script: '' });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('still requires authentication when billing is disabled', async () => {
    vi.stubEnv('BILLING_MODE', 'disabled');
    const req = { params: { slug: 'make_ugc' }, body: { script: 'Test' } } as unknown as Request;
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    await quoteSkillRoute(req, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(from).not.toHaveBeenCalled();
  });
});
