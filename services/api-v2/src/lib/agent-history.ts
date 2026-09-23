type Message = { role?: string; content?: unknown };
type Block = Record<string, unknown>;

const blocks = (message: Message): Block[] => Array.isArray(message.content)
  ? message.content.filter((block): block is Block => !!block && typeof block === 'object')
  : [];

/** Repair interrupted/reloaded transcripts at the provider boundary only.
 * Results must immediately follow their calls. Never execute a missing call
 * or invent its success; retain actual saved results whenever available.
 */
export function repairToolHistory(messages: Message[]): Message[] {
  const results = new Map<string, Block>();
  for (const message of messages) {
    if (message.role !== 'user') continue;
    for (const block of blocks(message)) {
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        results.set(block.tool_use_id, block);
      }
    }
  }

  const repaired: Message[] = [];
  for (const message of messages) {
    if (message.role === 'user' && Array.isArray(message.content)) {
      const content = blocks(message).filter(block => block.type !== 'tool_result');
      if (content.length) repaired.push({ ...message, content });
    } else {
      repaired.push(message);
    }
    if (message.role !== 'assistant') continue;
    const calls = blocks(message).filter(block => block.type === 'tool_use' && typeof block.id === 'string');
    if (!calls.length) continue;
    repaired.push({
      role: 'user',
      content: calls.map(call => results.get(call.id as string) ?? {
        type: 'tool_result',
        tool_use_id: call.id,
        is_error: true,
        content: 'The tool result is unavailable: execution was interrupted or its result was not saved. Do not assume success. Do not retry paid generation without explicit user confirmation.',
      }),
    });
  }
  return repaired;
}
