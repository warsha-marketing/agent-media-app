// Copyright 2026 agent-media contributors. Apache-2.0 license.

'use client';

/**
 * The Product Profile (#30) beside the Script: what the system understood
 * about the product from its photo — category, size, the state it is used in
 * and how it is used. The user corrects a wrong guess here before paying; an
 * edit re-voices into a new draft, and the Product Interaction is re-written
 * from the corrected Profile unless the user edited that too.
 * The logic lives in lib/product-profile-flow.ts.
 */

import {
  PROFILE_CATEGORIES,
  PROFILE_SIZE_CLASSES,
  USED_STATE_MAX,
  sizeLabel,
  type ProductProfile,
  type ProfileFields,
} from '@/lib/product-profile-flow';

const field = { backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' } as const;
const label = 'text-[11px] uppercase tracking-wider';
const muted = { color: 'rgba(255,255,255,0.45)' } as const;
const input = 'h-9 w-full rounded-lg px-3 text-sm outline-none';

export function ProductProfileFields(props: {
  profile: ProductProfile;
  fields: ProfileFields;
  disabled: boolean;
  onChange: (fields: ProfileFields) => void;
}) {
  const { profile, fields, disabled, onChange } = props;
  const set = (patch: Partial<ProfileFields>) => onChange({ ...fields, ...patch });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className={label} style={muted}>Product Profile</span>
        <span className="text-xs" style={muted}>{sizeLabel(profile)}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs" style={muted}>
          Category
          <select
            value={fields.category}
            disabled={disabled}
            onChange={(e) => set({ category: e.target.value })}
            className={input}
            style={field}
          >
            {PROFILE_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs" style={muted}>
          Size
          <select
            value={fields.size_class}
            disabled={disabled}
            onChange={(e) => set({ size_class: e.target.value })}
            className={input}
            style={field}
          >
            {PROFILE_SIZE_CLASSES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs" style={muted}>
          State when used
          <input
            value={fields.used_state}
            readOnly={disabled}
            maxLength={USED_STATE_MAX}
            onChange={(e) => set({ used_state: e.target.value })}
            placeholder="e.g. uncapped, spray neck visible"
            className={input}
            style={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs" style={muted}>
          How it is used
          <input
            value={fields.how_used}
            readOnly={disabled}
            onChange={(e) => set({ how_used: e.target.value })}
            placeholder="e.g. spray, smell"
            className={input}
            style={field}
          />
        </label>
      </div>
      <p className="text-xs" style={muted}>
        What we understood from your photo{profile.differs_from_photo ? ' (it is used in a different state than the photo shows)' : ''}.
        {profile.confidence < 0.5 ? ' We are not sure about this product: check these fields.' : ''} Correct anything wrong and
        re-voice: the Product Interaction is re-written from it.
      </p>
    </div>
  );
}
