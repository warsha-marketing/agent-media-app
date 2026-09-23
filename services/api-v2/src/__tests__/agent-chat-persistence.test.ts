import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
const state = vi.hoisted(() => ({ responses: [] as unknown[], inserted: [] as Array<Array<Record<string, unknown>>> }));
vi.mock('../server.js', () => ({ supabase: { from: () => {
  const result = state.responses.shift();
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'order', 'limit', 'update']) query[method] = () => query;
  query.insert = (rows: Array<Record<string, unknown>>) => { state.inserted.push(rows); return query; };
  query.maybeSingle = () => Promise.resolve(result);
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return query;
} } }));
import { appendMessagesRoute } from '../routes/v1/agent-chats.js';
const id = '11111111-1111-4111-8111-111111111111';
const reads = (seq: number) => [{ data: { id, message_count: seq } }, { data: [] }, { data: { seq } }];
async function append() {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  await appendMessagesRoute({ userId: id, params: { id }, body: { messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool', content: '{"status":"succeeded"}' }], client_msg_id: 'tool', run_kind: 'primitive', skill_run_id: id }] } } as unknown as Request, response as unknown as Response);
  return response;
}
beforeEach(() => { state.responses = []; state.inserted = []; });
describe('chat result persistence', () => {
  it('normalizes an older client’s primitive ID before the foreign-key insert', async () => {
    state.responses = [...reads(2), { error: null }, { error: null }];
    const response = await append();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(state.inserted[0][0]).toMatchObject({ skill_run_id: null, primitive_run_id: id, run_kind: 'primitive' });
  });
  it('reassigns seq after a collision instead of losing the result', async () => {
    state.responses = [...reads(2), { error: { code: '23505' } }, ...reads(3), { error: null }, { error: null }];
    const response = await append();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(state.inserted.map(rows => rows[0].seq)).toEqual([3, 4]);
    expect(response.json).toHaveBeenCalledWith({ inserted: 1, message_count: 4 });
  });
});
