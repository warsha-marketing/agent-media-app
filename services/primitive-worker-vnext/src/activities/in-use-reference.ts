// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * presetInUseReference (#31) — the In-use Reference of a Preset render: a
 * gpt-image edit of the user's (moderated, R2-hosted) product photo into the
 * state the product is used in (a perfume uncapped), product only, no person,
 * everything else identical. Made once, after the draft audio and before any
 * starting frame or clip; it is then the product reference of every hands and
 * person shot (their frames are edited from it, or their clips animate it),
 * while product-only shots keep the packshot.
 *
 * Only when the render needs one (inUseReferenceNeeded, @agentmedia/schema —
 * the same decision the quote priced). The prompt is built server-side from
 * the Product Profile (inUseReferencePrompt, @agentmedia/shot-prompts).
 *
 * Charged IN_USE_REFERENCE_CREDITS (the price the quote added), stored as a
 * primitive_artifacts row (kind 'in_use_reference') on its own primitive_runs
 * row under the skill run, and reported on the Short (final_output). Retry-safe
 * (runChargedStep): one that already succeeded is returned, never made twice.
 */

import { ApplicationFailure, Context } from '@temporalio/activity';
import { IN_USE_REFERENCE_USD } from '@agentmedia/schema';
import type { WorkerConfig } from '../config.js';
import { getDb } from '../client/db.js';
import { generateImageWithFallback, classifyOpenAIError } from '../client/openai.js';
import { r2UploadVnext } from '../client/r2.js';
import { runChargedStep } from './charged-step.js';
import { sanitizeImagePrompt } from '../lib/sanitize-prompt.js';
import { withHeartbeat } from '../lib/heartbeat.js';
import { fetchImageRef } from './podcast-scene.js';

export interface PresetInUseReferenceInput {
  primitive_run_id: string;
  user_id: string;
  skill_run_id: string;
  /** R2-hosted, moderated product photo: the edit's one reference image. */
  product_image_url: string;
  /** The Preset (for the record). */
  preset: string;
  /** The edit prompt (inUseReferencePrompt, from the draft's Product Profile). */
  prompt: string;
}

export interface PresetInUseReferenceResult {
  primitive_run_id: string;
  /** The In-use Reference, on R2. */
  image_url: string;
  credits_actual_usd: number;
}

export function makePresetInUseReferenceActivity(cfg: WorkerConfig) {
  return async function presetInUseReference(input: PresetInUseReferenceInput): Promise<PresetInUseReferenceResult> {
    const db = getDb(cfg.supabase.url, cfg.supabase.serviceRoleKey);
    if (typeof input.prompt !== 'string' || input.prompt.trim() === '') {
      throw ApplicationFailure.nonRetryable(`no In-use Reference prompt for ${input.preset}`, 'INVALID_INPUT');
    }
    const estimatedUsd = IN_USE_REFERENCE_USD;
    return runChargedStep({
      cfg,
      db,
      primitiveRunId: input.primitive_run_id,
      userId: input.user_id,
      skillRunId: input.skill_run_id,
      primitiveId: 'in_use_reference',
      r2Refs: [['product_image_url', input.product_image_url]],
      estimatedUsd,
      rowInput: { product_image_url: input.product_image_url, preset: input.preset, prompt: input.prompt },
      charge: { primitive: 'in_use_reference', description: `vNext ${input.preset} In-use Reference` },
      replay: (prior) => ({ primitive_run_id: input.primitive_run_id, image_url: prior.url, credits_actual_usd: prior.actualUsd }),
      work: async () => {
        const photo = await fetchImageRef(input.product_image_url, 'product_image_url');
        Context.current().heartbeat({ stage: 'reference_fetched' });

        let bytes: Buffer;
        if (cfg.openai.simulate) {
          bytes = STUB_PNG;
        } else {
          try {
            const out = await withHeartbeat('provider_working', () =>
              generateImageWithFallback(cfg.openai, {
                model: cfg.openai.imageModel,
                prompt: sanitizeImagePrompt(input.prompt),
                referencePngs: [photo],
                size: '1024x1536',
              }),
            );
            bytes = out.bytes;
          } catch (err) {
            const classified = classifyOpenAIError(err);
            if (classified.retryable) throw err instanceof Error ? err : new Error(String(err));
            throw ApplicationFailure.nonRetryable(classified.message, classified.code);
          }
        }
        Context.current().heartbeat({ stage: 'provider_done', bytes: bytes.byteLength });

        const { publicUrl } = await r2UploadVnext(cfg.r2, input.primitive_run_id, 'in-use-reference.png', bytes, 'image/png');

        const { data: artifact, error: artErr } = await db
          .from('primitive_artifacts')
          .insert({
            primitive_run_id: input.primitive_run_id,
            kind: 'in_use_reference',
            url: publicUrl,
            bytes: bytes.byteLength,
            mime: 'image/png',
            metadata: {
              provider: 'gpt-image-2',
              model: cfg.openai.imageModel,
              simulated: cfg.openai.simulate,
              preset: input.preset,
              source_product_image_url: input.product_image_url,
            },
          })
          .select('id')
          .single();
        if (artErr || !artifact) throw new Error(`primitive_artifacts insert failed: ${artErr?.message ?? 'no row'}`);

        const { error: finErr } = await db
          .from('primitive_runs')
          .update({ status: 'succeeded', actual_credits_usd: estimatedUsd, finished_at: new Date().toISOString() })
          .eq('id', input.primitive_run_id);
        if (finErr) throw new Error(`primitive_runs finalize failed: ${finErr.message}`);

        return { primitive_run_id: input.primitive_run_id, image_url: publicUrl, credits_actual_usd: estimatedUsd };
      },
    });
  };
}

const STUB_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
