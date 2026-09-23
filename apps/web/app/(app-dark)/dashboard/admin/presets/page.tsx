// Copyright 2026 agent-media contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/admin/presets — Qualified Presets for operators (#8).
 *
 * Each Preset × Dialect a Script can be written in, with its state (qualified,
 * withdrawn, or not reviewed) and review trail. Qualify a pair only after native
 * speakers of its Dialect accepted its sample Shorts; withdraw it the moment it
 * turns out wrong (it stops being offered, drafted and rendered at once).
 * Operators make the sample Shorts on the normal flow: the Dialect picker lets
 * them pick an unqualified Dialect as a "reviewer sample".
 *
 * api-v2 records who and when, and answers 403 OPERATOR_ONLY to anyone outside
 * ADMIN_EMAILS, so this page does no gating of its own.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';

type State = 'qualified' | 'withdrawn' | 'not_reviewed';

interface Qualification {
  preset: string;
  preset_name?: string;
  dialect: string;
  state: State;
  qualified_by: string | null;
  qualified_at: string | null;
  withdrawn_by: string | null;
  withdrawn_at: string | null;
  notes: string | null;
}

const CARD = { backgroundColor: '#14151F', border: '1px solid rgba(255,255,255,0.06)' } as const;
const FIELD = { backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' } as const;
const MUTED = { color: 'rgba(255,255,255,0.45)' } as const;
const STATE_COLOR: Record<State, string> = { qualified: '#34D399', withdrawn: '#F87171', not_reviewed: '#FBBF24' };
const STATE_LABEL: Record<State, string> = { qualified: 'qualified', withdrawn: 'withdrawn', not_reviewed: 'not reviewed' };

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T & { error?: { code?: string; message?: string } } }> {
  const r = await fetch(path, { credentials: 'include', cache: 'no-store', ...init });
  const data = (await r.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
  return { ok: r.ok, status: r.status, data };
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');
const key = (q: Pick<Qualification, 'preset' | 'dialect'>) => `${q.preset}:${q.dialect}`;

export default function QualifiedPresetsPage() {
  const [rows, setRows] = useState<Qualification[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ qualifications?: Qualification[] }>('/api/v1/operator/presets');
    if (r.status === 403) return setForbidden(true);
    if (!r.ok) return setError(r.data.error?.message ?? `HTTP ${r.status}`);
    setRows(r.data.qualifications ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(q: Qualification, action: 'qualify' | 'withdraw') {
    const k = key(q);
    setBusy(k);
    setError(null);
    const note = notes[k]?.trim();
    const r = await api(`/api/v1/operator/presets/${encodeURIComponent(q.preset)}/dialects/${encodeURIComponent(q.dialect)}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note ? { notes: note } : {}),
    });
    setBusy(null);
    if (!r.ok) return setError(r.data.error?.message ?? `HTTP ${r.status}`);
    setNotes((n) => ({ ...n, [k]: '' }));
    await load();
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-md px-8 py-20 text-center">
        <ShieldAlert className="mx-auto h-8 w-8" style={{ color: '#F87171' }} />
        <h1 className="mt-3 text-lg font-semibold" style={{ color: '#E9E9F0' }}>Operators only</h1>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={MUTED}>Internal</p>
      <h1 className="mt-1 font-normal" style={{ color: '#E9E9F0', fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em' }}>
        Qualified Presets
      </h1>
      <p className="mt-1 max-w-2xl text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
        Users are offered a Preset in a Dialect only once it is qualified. Qualify a pair only after native speakers of that
        Dialect accepted its sample Shorts; a finished render is not evidence on its own. Make samples on the{' '}
        <a href="/dashboard/product-hero" className="underline" style={{ color: '#C9B8FF' }}>normal flow</a>: as an operator
        you can pick an unqualified Dialect there as a reviewer sample. Withdrawing stops offering, drafting and rendering
        the pair at once.
      </p>

      {error ? (
        <div role="alert" className="mt-4 rounded-xl px-4 py-2 text-sm" style={{ border: '1px solid rgba(255,79,79,0.3)', color: '#FCA5A5' }}>
          {error}
        </div>
      ) : null}

      {rows === null ? (
        <Loader2 className="mt-6 h-5 w-5 animate-spin" style={MUTED} />
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {rows.map((q) => {
            const k = key(q);
            return (
              <li key={k} className="flex flex-col gap-2 rounded-xl px-4 py-3 text-sm" style={CARD}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="w-40 truncate" style={{ color: '#E9E9F0' }}>{q.preset_name ?? q.preset}</span>
                  <span className="w-24 text-xs" style={MUTED}>{q.dialect}</span>
                  <span className="w-24 text-xs font-semibold" style={{ color: STATE_COLOR[q.state] }}>{STATE_LABEL[q.state]}</span>
                  <span className="flex-1 text-xs" style={MUTED}>
                    {q.qualified_at ? `qualified ${when(q.qualified_at)} by ${q.qualified_by ?? 'seed'}` : ''}
                    {q.withdrawn_at ? ` · withdrawn ${when(q.withdrawn_at)} by ${q.withdrawn_by}` : ''}
                  </span>
                </div>
                {q.notes ? <p className="text-xs" style={MUTED}>Notes: {q.notes}</p> : null}
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label={`Notes for ${q.preset} ${q.dialect}`}
                    value={notes[k] ?? ''}
                    maxLength={1000}
                    onChange={(e) => setNotes((n) => ({ ...n, [k]: e.target.value }))}
                    placeholder={q.state === 'qualified' ? 'Why withdraw (optional)' : 'Who reviewed which samples (optional)'}
                    className="h-8 min-w-0 flex-1 rounded-lg px-2 text-xs outline-none"
                    style={FIELD}
                  />
                  {q.state !== 'qualified' ? (
                    <button type="button" disabled={busy === k} onClick={() => act(q, 'qualify')} className="rounded-lg px-3 py-1 text-xs disabled:opacity-60" style={{ border: '1px solid #34D399', color: '#34D399' }}>
                      {busy === k ? 'Saving…' : 'Qualify'}
                    </button>
                  ) : (
                    <button type="button" disabled={busy === k} onClick={() => act(q, 'withdraw')} className="rounded-lg px-3 py-1 text-xs disabled:opacity-60" style={{ border: '1px solid #F87171', color: '#F87171' }}>
                      {busy === k ? 'Saving…' : 'Withdraw'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
          {rows.length === 0 ? <li className="text-sm" style={MUTED}>No Presets.</li> : null}
        </ul>
      )}
    </div>
  );
}
