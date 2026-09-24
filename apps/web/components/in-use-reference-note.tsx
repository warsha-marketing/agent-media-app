// Copyright 2026 agent-media contributors. Apache-2.0 license.

'use client';

/**
 * In-use Reference (#31), next to the product photo, from the DRAFT (made free
 * when drafting): the image the hands and person shots will be made from and
 * what it shows, with "Use original photo instead" always offered — before
 * the user confirms. A draft whose edit failed says so (the render uses the
 * photo).
 */

import { inUseReferenceLine, type DraftInUseReference } from '@/lib/product-hero-flow';

export function InUseReferenceNote({
  reference,
  useOriginal,
  disabled,
  onUseOriginal,
}: {
  /** The draft's in_use_reference (null: none needed). */
  reference: DraftInUseReference | null;
  useOriginal: boolean;
  disabled: boolean;
  onUseOriginal: (on: boolean) => void;
}) {
  if (!reference) return null;
  return (
    <div className="flex items-start gap-4 rounded-xl p-3" style={{ border: '1px solid rgba(167,139,250,0.25)', backgroundColor: 'rgba(167,139,250,0.05)' }}>
      {reference.status === 'made' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={reference.imageUrl}
          alt="Your product as it is used (In-use Reference)"
          className="h-28 w-28 shrink-0 rounded-xl object-cover"
          style={{ border: '1px solid rgba(255,255,255,0.08)', opacity: useOriginal ? 0.4 : 1 }}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#C9B8FF' }}>In-use Reference</span>
        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.7)' }}>
          {inUseReferenceLine(reference, useOriginal)}
        </span>
        {reference.status === 'made' ? (
          <label className="inline-flex items-center gap-2 text-xs" style={{ color: 'rgba(255,255,255,0.8)' }}>
            <input type="checkbox" checked={useOriginal} disabled={disabled} onChange={(e) => onUseOriginal(e.target.checked)} />
            Use original photo instead
          </label>
        ) : null}
      </div>
    </div>
  );
}
