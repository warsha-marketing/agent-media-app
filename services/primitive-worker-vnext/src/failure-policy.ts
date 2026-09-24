// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Failure policy — ONE map from a failure's code (its ApplicationFailure type)
 * to what may be done about it:
 *
 *   retryable    Temporal may run the same activity again. False for anything
 *                a rerun cannot fix, and for every provider job failure: a
 *                rerun submits (and pays for) the job again.
 *   fallbackable A Preset shot whose model failed this way may try its kind's
 *                fallback model (#25). False where another model fails the same
 *                way: the account, the day cap, the input, the deployment.
 *
 * The Preset render (workflows/render-preset.ts) takes its non-retryable list
 * and its fallback rule from here, and the provider clients (client/evolink.ts,
 * client/fal.ts, video-models) build their failures from it, so a code's
 * policy is written once. Pure data: the workflow sandbox imports this.
 */

export interface FailurePolicy {
  retryable: boolean;
  fallbackable: boolean;
}

/**
 * The code every provider's content refusal maps to (EvoLink's moderation
 * verdict, fal's "likenesses of real people", ModelArk's
 * InputImageSensitiveContentDetected.PrivacyInformation and its failed-task
 * moderation verdicts, ...). Final — resubmitting pays
 * for the same refusal — but another model may accept the shot. The stored
 * value dates from EvoLink, the first provider, and stays: persisted runs carry
 * it as their error_code and the web reads it.
 */
export const CONTENT_POLICY_REFUSED = 'EVOLINK_CONTENT_POLICY_VIOLATION';

/** A provider job failed after it was submitted (fal FAILED/ERROR, a failed download, ...). */
export const PROVIDER_FAILED = 'PROVIDER_FAILED';

/** Final, and no other model helps. */
const FINAL: FailurePolicy = { retryable: false, fallbackable: false };
/** Final for this model; the shot's fallback model is its retry. */
const TRY_FALLBACK: FailurePolicy = { retryable: false, fallbackable: true };
/** A transient failure (a network blip, a 5xx): Temporal retries it, and a fallback may still run after. */
const TRANSIENT: FailurePolicy = { retryable: true, fallbackable: true };

/** 4xx a provider answers a request it will answer the same way again. */
const PROVIDER_4XX = [400, 401, 403, 404, 409, 413, 415, 422, 451] as const;
const byStatus = (prefix: string): Record<string, FailurePolicy> =>
  Object.fromEntries(PROVIDER_4XX.map((s) => [`${prefix}_${s}`, TRY_FALLBACK]));

export const FAILURE_POLICY: Readonly<Record<string, FailurePolicy>> = {
  INVALID_INPUT: FINAL,
  BUDGET_CAP_DAY: FINAL,
  INSUFFICIENT_CREDITS: FINAL,
  REFERENCE_URL_NOT_ALLOWED: FINAL,
  // A missing provider key (FAL_KEY, EVOLINK_API_KEY): fail fast; a fallback
  // on the same deployment would fail the same way.
  PROVIDER_UNCONFIGURED: FINAL,
  DRAFT_AUDIO_MISSING: FINAL,
  DRAFT_STORAGE_UNCONFIGURED: FINAL,
  MUSIC_BED_TRACK_MISSING: FINAL,
  MUSIC_BED_STORAGE_UNCONFIGURED: FINAL,
  [CONTENT_POLICY_REFUSED]: TRY_FALLBACK,
  [PROVIDER_FAILED]: TRY_FALLBACK,
  // The provider's clip is hosted where we do not download from, or too large.
  PROVIDER_DOWNLOAD_REFUSED: TRY_FALLBACK,
  ...byStatus('EVOLINK'),
  // fal (#25): every failure of a submitted job is final (see PROVIDER_PREFIXES).
  ...byStatus('FAL'),
  FAL_FAILED: TRY_FALLBACK,
  FAL_TIMEOUT: TRY_FALLBACK,
  FAL_UNAVAILABLE: TRY_FALLBACK,
  FAL_BAD_RESPONSE: TRY_FALLBACK,
  // BytePlus ModelArk (#29, client/byteplus.ts runModelArkVideo): like fal, a
  // submitted task is never resubmitted; the shot's fallback is its retry.
  ...byStatus('MODELARK'),
  MODELARK_FAILED: TRY_FALLBACK,
  MODELARK_TIMEOUT: TRY_FALLBACK,
  MODELARK_UNAVAILABLE: TRY_FALLBACK,
  MODELARK_BAD_RESPONSE: TRY_FALLBACK,
};

/**
 * A provider code not listed above (another 4xx) is still final for its model:
 * a fal or ModelArk job is never resubmitted, and an EvoLink 4xx is a refused request.
 */
const PROVIDER_PREFIXES = ['FAL_', 'EVOLINK_', 'MODELARK_'] as const;

/** The policy for a failure code; an unknown code is transient. */
export function failurePolicy(code: string | null | undefined): FailurePolicy {
  if (!code) return TRANSIENT;
  if (Object.hasOwn(FAILURE_POLICY, code)) return FAILURE_POLICY[code];
  if (PROVIDER_PREFIXES.some((p) => code.startsWith(p))) return TRY_FALLBACK;
  return TRANSIENT;
}

/** Temporal's nonRetryableErrorTypes for the Preset render: every listed code a rerun cannot fix. */
export const NON_RETRYABLE_TYPES: readonly string[] = Object.entries(FAILURE_POLICY)
  .filter(([, p]) => !p.retryable)
  .map(([code]) => code);
