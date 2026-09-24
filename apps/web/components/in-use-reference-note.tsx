// Copyright 2026 agent-media contributors. Apache-2.0 license.

'use client';

/**
 * In-use Reference (#31), next to the product photo: what the hands and person
 * shots will show (the server's quote), the "use original instead" override,
 * and, once the render is done, the image it made.
 */

import { inUseReferenceLine, type InUseReferenceQuote } from '@/lib/product-hero-flow';

export function InUseReferenceNote({
  quote,
  useOriginal,
  imageUrl,
  disabled,
  onUseOriginal,
}: {
  /** The quote's in_use_reference (null while re-quoting, or when none could be made). */
  quote: InUseReferenceQuote | null;
  useOriginal: boolean;
  /** The In-use Reference the finished render made. */
  imageUrl: string | null;
  disabled: boolean;
  onUseOriginal: (on: boolean) => void;
}) {
  // Nothing to say or choose: the render could never make one (and the user has not opted out).
  if (!quote && !useOriginal && !imageUrl) return null;
  return (
    <div className="flex items-start gap-4 rounded-xl p-3" style={{ border: '1px solid rgba(167,139,250,0.25)', backgroundColor: 'rgba(167,139,250,0.05)' }}>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="Your product as it is used (In-use Reference)" className="h-28 w-28 shrink-0 rounded-xl object-cover" style={{ border: '1px solid rgba(255,255,255,0.08)' }} />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#C9B8FF' }}>In-use Reference</span>
        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.7)' }}>
          {imageUrl
            ? 'The hands and person shots used this image of your product; product shots used your photo.'
            : quote
              ? inUseReferenceLine(quote)
              : 'Hands and person shots will use your original photo.'}
        </span>
        {!imageUrl ? (
          <label className="inline-flex items-center gap-2 text-xs" style={{ color: 'rgba(255,255,255,0.8)' }}>
            <input type="checkbox" checked={useOriginal} disabled={disabled} onChange={(e) => onUseOriginal(e.target.checked)} />
            Use original photo instead
          </label>
        ) : null}
      </div>
    </div>
  );
}
