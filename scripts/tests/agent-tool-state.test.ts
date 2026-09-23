import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { persistedRunReference, reconcileToolRuns, resultStatus } from '../../apps/web/lib/agent-tool-state.ts';

describe('persisted tool state', () => {
  it('writes portrait and sheet IDs to the primitive foreign key', () => {
    assert.deepEqual(persistedRunReference('portrait-run', 'primitive'), { skill_run_id: null, primitive_run_id: 'portrait-run', run_kind: 'primitive' });
    assert.deepEqual(persistedRunReference('video-run', 'skill'), { skill_run_id: 'video-run', primitive_run_id: null, run_kind: 'skill' });
  });
  it('replaces a stale spinner with the saved result for the same run', () => {
    const live = { tool: { status: 'running' as const, runId: 'run-a' } };
    const saved = { tool: { status: 'succeeded' as const, runId: 'run-a', mediaUrl: 'portrait.png' } };
    assert.deepEqual(reconcileToolRuns(live, saved).tool, saved.tool);
  });
  it('does not finish an explicitly retried run with an older result', () => {
    const live = { tool: { status: 'running' as const, runId: 'run-b' } };
    const saved = { tool: { status: 'succeeded' as const, runId: 'run-a' } };
    assert.deepEqual(reconcileToolRuns(live, saved).tool, live.tool);
  });
  it('retains a locally checkpointed run when no server result exists yet', () => {
    const live = { tool: { status: 'running' as const, runId: 'run-a' } };
    assert.deepEqual(reconcileToolRuns(live, {}), live);
  });
  for (const status of ['declined', 'canceled', 'cancelled']) it(`renders ${status} as canceled`, () => {
    assert.equal(resultStatus(status), 'canceled');
  });
  it('renders timeout as failure', () => { assert.equal(resultStatus('timeout'), 'failed'); });
});
