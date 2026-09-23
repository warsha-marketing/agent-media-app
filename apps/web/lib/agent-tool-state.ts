/** A primitive reference must never be written into the skill_runs foreign key. */
export function persistedRunReference(runId?: string | null, kind?: 'skill' | 'primitive' | null) {
  return { skill_run_id: kind === 'primitive' ? null : runId ?? null,
    primitive_run_id: kind === 'primitive' ? runId ?? null : null, run_kind: kind ?? null };
}
export type ToolStatus = 'running' | 'succeeded' | 'failed' | 'canceled';
export function resultStatus(status?: string): ToolStatus {
  if (['declined', 'canceled', 'cancelled'].includes(status ?? '')) return 'canceled';
  if (['failed', 'timeout'].includes(status ?? '')) return 'failed';
  return 'succeeded';
}
/** Persisted terminal results supersede stale UI polling state for the same run. */
export function reconcileToolRuns<T extends { status: ToolStatus; runId?: string }>(live: Record<string, T>, saved: Record<string, T>): Record<string, T> {
  const combined = { ...live };
  for (const [id, result] of Object.entries(saved)) {
    const current = live[id];
    // A user-requested retry has its own run; an old result must not finish it.
    if (current?.runId && current.runId !== result.runId) continue;
    combined[id] = { ...current, ...result };
  }
  return combined;
}
