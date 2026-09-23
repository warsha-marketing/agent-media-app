import { describe, expect, it } from 'vitest';
import { repairToolHistory } from '../lib/agent-history.js';

const call = (id: string) => ({ type: 'tool_use', id, name: 'make_product_in_hands', input: {} });
const result = (id: string) => ({ type: 'tool_result', tool_use_id: id, content: '{"status":"succeeded"}' });

describe('interrupted agent history', () => {
  it('repairs a missing generation result while preserving the subsequent voice choice', () => {
    const messages = [
      { role: 'assistant', content: [call('missing')] },
      { role: 'assistant', content: [{ type: 'text', text: 'Choose a voice.' }] },
      { role: 'user', content: 'Use Lama, Gulf Arabic woman.' },
    ];
    const original = structuredClone(messages);
    const repaired = repairToolHistory(messages);
    expect(repaired[1]).toMatchObject({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'missing', is_error: true }] });
    expect(JSON.stringify(repaired[1])).toContain('Do not retry paid generation');
    expect(repaired.slice(2)).toEqual(messages.slice(1));
    expect(messages).toEqual(original);
    expect(repairToolHistory(repaired)).toEqual(repaired);
  });

  it('preserves valid successful exchanges exactly', () => {
    const messages = [{ role: 'assistant', content: [call('done')] }, { role: 'user', content: [result('done')] }];
    expect(repairToolHistory(messages)).toEqual(messages);
  });

  it('pairs every call and retains a delayed real result without losing user text', () => {
    const repaired = repairToolHistory([
      { role: 'assistant', content: [call('one'), call('two')] },
      { role: 'user', content: 'Keep Lama.' },
      { role: 'user', content: [result('one'), { type: 'text', text: 'Continue.' }] },
    ]);
    expect(repaired[1]).toMatchObject({ role: 'user', content: [result('one'), { tool_use_id: 'two', is_error: true }] });
    expect(repaired[2].content).toBe('Keep Lama.');
    expect(repaired[3].content).toEqual([{ type: 'text', text: 'Continue.' }]);
  });

  it('removes orphan result blocks left by a truncated history, preserving text', () => {
    expect(repairToolHistory([{ role: 'user', content: [result('trimmed'), { type: 'text', text: 'Hello' }] }]))
      .toEqual([{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]);
  });
});
