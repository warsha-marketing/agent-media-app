// Copyright 2026 agent-media contributors. Apache-2.0 license.

'use client';

/**
 * Reaction's own inputs in the Preset flow (#19): which saved character reacts,
 * their gender, and for a woman the hijab option (its default is the server's,
 * from the quote: on for Gulf drafts).
 * Presentational only: the pick's rules live in lib/reaction-flow.ts.
 */

import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import {
  hijabOffered,
  hijabShown,
  withGender,
  type CharacterGender,
  type ReactionPick,
  type SavedCharacter,
} from '@/lib/reaction-flow';

const card = { border: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#14151F' } as const;
const label = 'text-[11px] uppercase tracking-wider';
const muted = { color: 'rgba(255,255,255,0.45)' } as const;

const GENDERS: Array<{ id: CharacterGender; label: string }> = [
  { id: 'female', label: 'Woman' },
  { id: 'male', label: 'Man' },
];

interface Props {
  /** null while loading. */
  characters: SavedCharacter[] | null;
  error: string | null;
  pick: ReactionPick;
  /** The latest quote's `preset_inputs`: the hijab default the server resolved. */
  presetInputs: Record<string, unknown> | null | undefined;
  disabled: boolean;
  onChange: (pick: ReactionPick) => void;
}

export function ReactionCharacterPicker({ characters, error, pick, presetInputs, disabled, onChange }: Props) {
  const hijab = hijabShown(pick, presetInputs);
  return (
    <section className="mt-6 flex flex-col gap-3 rounded-2xl p-5" style={card}>
      <span className={label} style={muted}>Who reacts</span>
      <p className="-mt-1 text-xs" style={muted}>
        One of your saved characters reacts to your product without speaking (a smile, a nod, surprise), in short shots
        cut between product shots. The voice-over does all the talking.
      </p>
      {characters === null ? (
        <Loader2 className="h-4 w-4 animate-spin" style={muted} />
      ) : error ? (
        <p className="text-sm" style={{ color: '#FCA5A5' }}>Could not load your characters: {error}</p>
      ) : characters.length === 0 ? (
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
          You have no saved characters yet. <Link href="/content-machine" className="underline">Create one</Link>, then come back.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Saved character">
          {characters.map((c) => {
            const selected = c.id === pick.characterId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() => onChange({ ...pick, characterId: c.id })}
                  className="flex w-full flex-col items-center gap-2 rounded-xl p-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ ...card, border: selected ? '1px solid #A78BFA' : card.border }}
                >
                  {c.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.thumbnailUrl} alt="" className="aspect-square w-full rounded-lg object-cover" />
                  ) : (
                    <span className="aspect-square w-full rounded-lg" style={{ backgroundColor: '#0F1015' }} />
                  )}
                  <span className="w-full truncate text-xs" style={{ color: '#E9E9F0' }}>{c.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className={label} style={muted}>Their gender</span>
        <div className="flex gap-2" role="radiogroup" aria-label="Character gender">
          {GENDERS.map((g) => {
            const selected = pick.gender === g.id;
            return (
              <button
                key={g.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onChange(withGender(pick, g.id))}
                className="h-8 rounded-lg px-3 text-xs disabled:opacity-60"
                style={{ ...card, border: selected ? '1px solid #A78BFA' : card.border, color: '#E9E9F0' }}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      </div>

      {hijabOffered(pick.gender) ? (
        <label className="flex items-center gap-2 text-sm" style={{ color: '#E9E9F0' }}>
          <input
            type="checkbox"
            checked={hijab.value ?? false}
            disabled={disabled}
            onChange={(e) => onChange({ ...pick, hijab: e.target.checked })}
          />
          She wears a hijab
          {hijab.fromServer ? (
            <span className="text-xs" style={muted}>
              ({hijab.value ? 'on' : 'off'} by default for your draft’s Dialect)
            </span>
          ) : hijab.value === null ? (
            <span className="text-xs" style={muted}>(the default for your draft’s Dialect shows once it is priced)</span>
          ) : null}
        </label>
      ) : null}
      <p className="text-xs" style={muted}>Arms are always covered by long sleeves.</p>
    </section>
  );
}
