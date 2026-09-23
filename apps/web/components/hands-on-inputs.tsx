// Copyright 2026 agent-media contributors. Apache-2.0 license.

'use client';

/**
 * The Hands-on inputs (#18) on /dashboard/product-hero: whose hands and the
 * setting. Shows the server's pick from the Product Details (from the quote)
 * until the user changes it. Presentational only: the state and the rules are
 * in lib/hands-on-flow.ts.
 */

import { Hand } from 'lucide-react';
import {
  HAND_GENDERS,
  HAND_GENDER_NAMES,
  HANDS_ON_SETTINGS,
  HANDS_ON_SETTING_NAMES,
  modestyLine,
  type HandGender,
  type HandsOnSetting,
  type HandsOnView,
} from '@/lib/hands-on-flow';

const card = { border: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#14151F' } as const;
const muted = { color: 'rgba(255,255,255,0.45)' } as const;
const label = 'text-[11px] uppercase tracking-wider';

export function HandsOnInputs({
  view,
  disabled,
  onHandGender,
  onSetting,
}: {
  view: HandsOnView;
  disabled: boolean;
  onHandGender: (g: HandGender) => void;
  onSetting: (s: HandsOnSetting) => void;
}) {
  const picked = (fromDetails: boolean) =>
    fromDetails ? <span className="ml-2 normal-case tracking-normal" style={{ color: '#C9B8FF' }}>picked from your Product Details</span> : null;
  const chip = (selected: boolean) => ({
    ...card,
    border: selected ? '1px solid #A78BFA' : card.border,
    color: selected ? '#E9E9F0' : 'rgba(255,255,255,0.7)',
  });

  return (
    <section className="mt-6 flex flex-col gap-4 rounded-2xl p-5" style={card} aria-label="Hands-on">
      <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#E9E9F0' }}>
        <Hand className="h-4 w-4" /> Hands-on
      </div>

      <div className="flex flex-col gap-2">
        <span className={label} style={muted}>
          Hands{picked(view.handGender.fromProductDetails)}
        </span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Hands">
          {HAND_GENDERS.map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={view.handGender.value === g}
              disabled={disabled}
              onClick={() => onHandGender(g)}
              className="h-9 rounded-xl px-3 text-sm disabled:opacity-60"
              style={chip(view.handGender.value === g)}
            >
              {HAND_GENDER_NAMES[g]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className={label} style={muted}>
          Setting{picked(view.setting.fromProductDetails)}
        </span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Setting">
          {HANDS_ON_SETTINGS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={view.setting.value === s}
              disabled={disabled}
              onClick={() => onSetting(s)}
              className="h-9 rounded-xl px-3 text-sm disabled:opacity-60"
              style={chip(view.setting.value === s)}
            >
              {HANDS_ON_SETTING_NAMES[s]}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs" style={muted}>{modestyLine(view.arms)}</p>
    </section>
  );
}
