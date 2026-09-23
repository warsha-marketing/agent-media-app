// Copyright 2026 agent-media contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/admin/voices — the Voice catalog for operators (#7).
 *
 * Add a candidate Voice (tagged with exactly one Dialect), play its sample, and
 * approve it only after a native speaker of that Dialect accepted it; revoke it
 * the moment it turns out wrong. api-v2 records who and when, and answers 403
 * OPERATOR_ONLY to anyone outside ADMIN_EMAILS, so this page does no gating of
 * its own. "Find candidates" browses the provider's shared Arabic voices,
 * filtered by Dialect, gender, age, use case and search text, a page at a time
 * ("Load more" appends the next page while the provider has more).
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { catalogOf, withCatalogVoice } from '@/lib/voice-candidates';

type State = 'pending' | 'approved' | 'revoked';

interface OperatorVoice {
  id: string;
  provider_voice_id: string;
  display_name: string;
  dialect: string;
  gender: string;
  style: string;
  sample_url: string;
  state: State;
  approved_by: string | null;
  approved_at: string | null;
  revoked_by: string | null;
  revoked_at: string | null;
}

interface Candidate {
  provider_voice_id: string;
  display_name: string;
  gender: string | null;
  accent: string;
  suggested_dialect: string | null;
  style: string | null;
  sample_url: string | null;
  catalog: { id: string; state: State; dialect: string } | null;
}

const DIALECTS = ['levantine', 'gulf', 'egyptian', 'maghrebi', 'msa'];
const GENDERS = ['female', 'male'];
const AGES = [['young', 'Young'], ['middle_aged', 'Middle-aged'], ['old', 'Old']] as const;
const USE_CASES = [
  ['advertisement', 'Advertisement'],
  ['social_media', 'Social media'],
  ['narrative_story', 'Narrative / story'],
  ['conversational', 'Conversational'],
  ['characters_animation', 'Characters / animation'],
  ['informative_educational', 'Informative / educational'],
  ['entertainment_tv', 'Entertainment / TV'],
] as const;
const SORTS = [['trending', 'Trending'], ['created_date', 'Newest'], ['usage_character_count_1y', 'Most used (1y)'], ['cloned_by_count', 'Most added']] as const;

const EMPTY_SEARCH = { dialect: '', gender: '', age: '', use_case: '', sort: '', search: '' };
const CARD = { backgroundColor: '#14151F', border: '1px solid rgba(255,255,255,0.06)' } as const;
const FIELD = { backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' } as const;
const MUTED = { color: 'rgba(255,255,255,0.45)' } as const;
const STATE_COLOR: Record<State, string> = { pending: '#FBBF24', approved: '#34D399', revoked: '#F87171' };

const EMPTY_FORM = { provider_voice_id: '', display_name: '', dialect: 'levantine', gender: 'female', style: '', sample_url: '' };

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T & { error?: { code?: string; message?: string } } }> {
  const r = await fetch(path, { credentials: 'include', cache: 'no-store', ...init });
  const data = (await r.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
  return { ok: r.ok, status: r.status, data };
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');

export default function VoiceCatalogPage() {
  const [voices, setVoices] = useState<OperatorVoice[] | null>(null);
  const [filter, setFilter] = useState<'' | State>('');
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [search, setSearch] = useState(EMPTY_SEARCH);
  // The filters and last page of the loaded list, so "Load more" continues the same search.
  const [more, setMore] = useState<{ query: typeof EMPTY_SEARCH; page: number } | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ voices?: OperatorVoice[] }>(`/api/v1/operator/voices${filter ? `?state=${filter}` : ''}`);
    if (r.status === 403) return setForbidden(true);
    if (!r.ok) return setError(r.data.error?.message ?? `HTTP ${r.status}`);
    setVoices(r.data.voices ?? []);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, action: 'approve' | 'revoke') {
    setBusy(id);
    setError(null);
    const r = await api(`/api/v1/operator/voices/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
    if (!r.ok) setError(r.data.error?.message ?? `HTTP ${r.status}`);
    setBusy(null);
    await load();
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy('add');
    setError(null);
    const r = await api<{ voice?: OperatorVoice }>('/api/v1/operator/voices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setBusy(null);
    if (!r.ok) return setError(r.data.error?.message ?? `HTTP ${r.status}`);
    // The candidate list was marked when it was searched: mark the one just added.
    const added = r.data.voice;
    if (added) setCandidates((prev) => (prev ? withCatalogVoice(prev, added) : prev));
    setForm(EMPTY_FORM);
    await load();
  }

  async function findCandidates(query: typeof EMPTY_SEARCH, page: number) {
    setBusy(page === 0 ? 'candidates' : 'more');
    setError(null);
    const qs = new URLSearchParams({ page: String(page) });
    for (const [k, v] of Object.entries(query)) if (v.trim()) qs.set(k, v.trim());
    const r = await api<{ candidates?: Candidate[]; has_more?: boolean; page?: number }>(`/api/v1/operator/voice-candidates?${qs}`);
    setBusy(null);
    if (!r.ok) return setError(r.data.error?.message ?? `HTTP ${r.status}`);
    const found = r.data.candidates ?? [];
    setCandidates((prev) => {
      if (page === 0 || !prev) return found;
      const seen = new Set(prev.map((c) => c.provider_voice_id));
      return [...prev, ...found.filter((c) => !seen.has(c.provider_voice_id))];
    });
    setMore(r.data.has_more ? { query, page: r.data.page ?? page } : null);
  }

  function pickCandidate(c: Candidate) {
    setForm({
      provider_voice_id: c.provider_voice_id,
      display_name: c.display_name,
      dialect: c.suggested_dialect ?? 'levantine',
      gender: c.gender ?? 'female',
      style: c.style ?? '',
      sample_url: c.sample_url ?? '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-md px-8 py-20 text-center">
        <ShieldAlert className="mx-auto h-8 w-8" style={{ color: '#F87171' }} />
        <h1 className="mt-3 text-lg font-semibold" style={{ color: '#E9E9F0' }}>Operators only</h1>
      </div>
    );
  }

  const input = (key: keyof typeof EMPTY_FORM, placeholder: string) => (
    <input
      required
      value={form[key]}
      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      placeholder={placeholder}
      className="h-9 rounded-lg px-2 text-sm outline-none"
      style={FIELD}
    />
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={MUTED}>Internal</p>
      <h1 className="mt-1 font-normal" style={{ color: '#E9E9F0', fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em' }}>
        Voice catalog
      </h1>
      <p className="mt-1 max-w-2xl text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
        Approve a Voice only after a native speaker of its Dialect accepted its sample. Users see Approved Voices only; a
        revoked Voice leaves the picker and drafting at once.
      </p>

      {error ? (
        <div role="alert" className="mt-4 rounded-xl px-4 py-2 text-sm" style={{ border: '1px solid rgba(255,79,79,0.3)', color: '#FCA5A5' }}>
          {error}
        </div>
      ) : null}

      <form onSubmit={add} className="mt-6 flex flex-col gap-3 rounded-2xl p-5" style={CARD}>
        <p className="text-[11px] uppercase tracking-wider" style={MUTED}>Add a candidate Voice (pending)</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {input('provider_voice_id', 'Provider voice id')}
          {input('display_name', 'Display name')}
          {input('style', 'Delivery style, e.g. warm')}
          <select value={form.dialect} onChange={(e) => setForm({ ...form, dialect: e.target.value })} className="h-9 rounded-lg px-2 text-sm" style={FIELD}>
            {DIALECTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} className="h-9 rounded-lg px-2 text-sm" style={FIELD}>
            {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          {input('sample_url', 'Sample URL (https)')}
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={!!busy} className="h-9 rounded-lg px-4 text-sm font-semibold disabled:opacity-60" style={{ backgroundColor: '#A78BFA', color: '#0F1015' }}>
            {busy === 'add' ? 'Adding…' : 'Add candidate'}
          </button>
        </div>
      </form>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void findCandidates(search, 0);
        }}
        className="mt-4 flex flex-col gap-3 rounded-2xl p-5"
        style={CARD}
      >
        <p className="text-[11px] uppercase tracking-wider" style={MUTED}>Find candidates in the provider&apos;s shared Arabic voices</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          <select aria-label="Dialect" value={search.dialect} onChange={(e) => setSearch({ ...search, dialect: e.target.value })} className="h-9 rounded-lg px-2 text-sm" style={FIELD}>
            <option value="">Any Dialect</option>
            {DIALECTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select aria-label="Gender" value={search.gender} onChange={(e) => setSearch({ ...search, gender: e.target.value })} className="h-9 rounded-lg px-2 text-sm" style={FIELD}>
            <option value="">Male or female</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
          <select aria-label="Age" value={search.age} onChange={(e) => setSearch({ ...search, age: e.target.value })} className="h-9 rounded-lg px-2 text-sm" style={FIELD}>
            <option value="">Any age</option>
            {AGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select aria-label="Use case" value={search.use_case} onChange={(e) => setSearch({ ...search, use_case: e.target.value })} className="h-9 rounded-lg px-2 text-sm" style={FIELD}>
            <option value="">Any use case</option>
            {USE_CASES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select aria-label="Sort" value={search.sort} onChange={(e) => setSearch({ ...search, sort: e.target.value })} className="h-9 rounded-lg px-2 text-sm" style={FIELD}>
            <option value="">Default order</option>
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input
            aria-label="Search"
            value={search.search}
            maxLength={60}
            onChange={(e) => setSearch({ ...search, search: e.target.value })}
            placeholder="Search name or description"
            className="h-9 rounded-lg px-2 text-sm outline-none"
            style={FIELD}
          />
        </div>
        <div>
          <button type="submit" disabled={!!busy} className="h-9 rounded-lg px-4 text-sm disabled:opacity-60" style={{ border: '1px solid rgba(167,139,250,0.5)', color: '#C9B8FF' }}>
            {busy === 'candidates' ? 'Searching…' : 'Find candidates'}
          </button>
        </div>
      </form>

      <div className="mt-6 flex items-center gap-3">
        <p className="text-[11px] uppercase tracking-wider" style={MUTED}>Catalog</p>
        <select value={filter} onChange={(e) => setFilter(e.target.value as '' | State)} className="h-8 rounded-lg px-2 text-xs" style={FIELD}>
          <option value="">All states</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="revoked">Revoked</option>
        </select>
      </div>
      {voices === null ? (
        <Loader2 className="mt-4 h-5 w-5 animate-spin" style={MUTED} />
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {voices.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-2 text-sm" style={CARD}>
              <span className="w-32 truncate" style={{ color: '#E9E9F0' }}>{v.display_name}</span>
              <span className="w-40 text-xs" style={MUTED}>{v.dialect} · {v.gender} · {v.style}</span>
              <span className="w-20 text-xs font-semibold" style={{ color: STATE_COLOR[v.state] }}>{v.state}</span>
              <audio controls preload="none" src={v.sample_url} className="h-8 w-56" />
              <span className="flex-1 text-xs" style={MUTED}>
                {v.approved_at ? `approved ${when(v.approved_at)} by ${v.approved_by}` : ''}
                {v.revoked_at ? ` · revoked ${when(v.revoked_at)} by ${v.revoked_by}` : ''}
              </span>
              {v.state !== 'approved' ? (
                <button type="button" disabled={busy === v.id} onClick={() => act(v.id, 'approve')} className="rounded-lg px-3 py-1 text-xs" style={{ border: '1px solid #34D399', color: '#34D399' }}>
                  Approve
                </button>
              ) : null}
              {v.state !== 'revoked' ? (
                <button type="button" disabled={busy === v.id} onClick={() => act(v.id, 'revoke')} className="rounded-lg px-3 py-1 text-xs" style={{ border: '1px solid #F87171', color: '#F87171' }}>
                  Revoke
                </button>
              ) : null}
            </li>
          ))}
          {voices.length === 0 ? <li className="text-sm" style={MUTED}>No Voices.</li> : null}
        </ul>
      )}

      {candidates ? (
        <section className="mt-8">
          <p className="text-[11px] uppercase tracking-wider" style={MUTED}>
            Provider candidates (not reviewed) · {candidates.length} loaded{more ? '' : ' · no more'}
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {/* Where each candidate stands now: the loaded catalog rows are newer than the search. */}
            {candidates.map((c) => ({ c, entry: catalogOf(c, voices) })).map(({ c, entry }) => (
              <li key={c.provider_voice_id} className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-2 text-sm" style={CARD}>
                <span className="w-32 truncate" style={{ color: '#E9E9F0' }}>{c.display_name}</span>
                <span className="w-48 text-xs" style={MUTED}>{c.accent || 'no accent'} → {c.suggested_dialect ?? '?'} · {c.gender ?? '?'}</span>
                {c.sample_url ? <audio controls preload="none" src={c.sample_url} className="h-8 w-56" /> : <span className="w-56 text-xs" style={MUTED}>no sample</span>}
                <span className="flex-1" />
                {entry ? (
                  <span className="text-xs" style={{ color: STATE_COLOR[entry.state] }}>in catalog ({entry.state})</span>
                ) : (
                  <button type="button" onClick={() => pickCandidate(c)} className="rounded-lg px-3 py-1 text-xs" style={{ border: '1px solid rgba(167,139,250,0.5)', color: '#C9B8FF' }}>
                    Use as candidate
                  </button>
                )}
              </li>
            ))}
            {candidates.length === 0 ? <li className="text-sm" style={MUTED}>No voices match these filters.</li> : null}
          </ul>
          {more ? (
            <button
              type="button"
              onClick={() => findCandidates(more.query, more.page + 1)}
              disabled={!!busy}
              className="mt-3 h-9 rounded-lg px-4 text-sm disabled:opacity-60"
              style={{ border: '1px solid rgba(167,139,250,0.5)', color: '#C9B8FF' }}
            >
              {busy === 'more' ? 'Loading…' : 'Load more'}
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
