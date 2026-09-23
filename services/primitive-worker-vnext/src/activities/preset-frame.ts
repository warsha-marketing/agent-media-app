// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * presetStartingFrame (#18) — the starting frame of one Preset shot, made
 * before any clip and then animated silently by productHeroClip.
 *
 *   product_in_hands — a gpt-image edit of the user's (moderated, R2-hosted)
 *                      product photo: first-person hands holding the exact
 *                      product in the Preset's setting. The prompt comes from
 *                      the Preset's render definition (server-side), with the
 *                      Modesty Default already in it.
 *
 * Charged at the shared starting-frame price (@agentmedia/schema
 * STARTING_FRAME_CREDITS), the same table api-v2 quotes from, so the quote is
 * the charge. Retry-safe: a frame that already succeeded is returned, never
 * made (or paid for) twice. A non-retryable failure refunds here; the workflow
 * also refunds every charged child on any terminal failure (idempotent).
 */

import { ApplicationFailure, Context } from '@temporalio/activity';
import { STARTING_FRAMES, STARTING_FRAME_USD, type StartingFrame } from '@agentmedia/schema';
import type { WorkerConfig } from '../config.js';
import { getDb } from '../client/db.js';
import { generateImageWithFallback, classifyOpenAIError } from '../client/openai.js';
import { r2UploadVnext } from '../client/r2.js';
import { deductPrimitiveCredits, refundPrimitiveCredits } from '../client/credits.js';
import { sanitizeImagePrompt } from '../lib/sanitize-prompt.js';
import { withHeartbeat } from '../lib/heartbeat.js';
import { fetchImageRef } from './podcast-scene.js';

export interface PresetStartingFrameInput {
  primitive_run_id: string;
  user_id: string;
  skill_run_id: string;
  /** R2-hosted, moderated product photo: the edit's reference image. */
  product_image_url: string;
  /** How the frame is made (the Preset's shotKinds[kind].frame). */
  frame: StartingFrame;
  /** The Preset, the shot's kind and its place in the plan (for the record). */
  preset: string;
  shot_kind: string;
  shot_index: number;
  /** The Preset's frame prompt for this shot (server-side; see ../presets). */
  prompt: string;
}

export interface PresetStartingFrameResult {
  primitive_run_id: string;
  /** The frame, on R2: the reference image its clip animates. */
  image_url: string;
  credits_actual_usd: number;
}

export function makePresetStartingFrameActivity(cfg: WorkerConfig) {
  return async function presetStartingFrame(input: PresetStartingFrameInput): Promise<PresetStartingFrameResult> {
    const db = getDb(cfg.supabase.url, cfg.supabase.serviceRoleKey);

    if (!(STARTING_FRAMES as readonly string[]).includes(input.frame)) {
      throw ApplicationFailure.nonRetryable(`unknown starting frame ${String(input.frame)}`, 'INVALID_INPUT');
    }
    if (typeof input.prompt !== 'string' || input.prompt.trim() === '') {
      throw ApplicationFailure.nonRetryable(`no frame prompt for ${input.preset} shot ${input.shot_kind}`, 'INVALID_INPUT');
    }

    // Retry-safety: a frame that already succeeded is returned, not re-made.
    const { data: existing, error: existingErr } = await db
      .from('primitive_runs')
      .select('status, actual_credits_usd, primitive_artifacts(id, url)')
      .eq('id', input.primitive_run_id)
      .maybeSingle();
    if (existingErr) throw new Error(`primitive_runs lookup failed: ${existingErr.message}`);
    if (existing && existing.status === 'succeeded') {
      const art = (existing.primitive_artifacts as Array<{ id: string; url: string }> | null)?.[0];
      if (!art) throw new Error(`inconsistent state: primitive_run ${input.primitive_run_id} succeeded without an artifact`);
      return {
        primitive_run_id: input.primitive_run_id,
        image_url: art.url,
        credits_actual_usd: Number(existing.actual_credits_usd ?? 0),
      };
    }

    // SSRF guard — the product photo must be on our R2.
    const allowedPrefix = cfg.r2.publicUrl.replace(/\/+$/, '') + '/';
    if (!input.product_image_url.startsWith(allowedPrefix)) {
      throw ApplicationFailure.nonRetryable(
        `product_image_url must be hosted on the configured R2 public URL (${allowedPrefix})`,
        'REFERENCE_URL_NOT_ALLOWED',
      );
    }

    // Spend: the Preset's budget governs the render (tests hold the plan to it);
    // the day cap still applies.
    const estimatedUsd = STARTING_FRAME_USD[input.frame];
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const { data: dayRows, error: dayErr } = await db
      .from('primitive_runs')
      .select('actual_credits_usd')
      .eq('user_id', input.user_id)
      .gte('created_at', since.toISOString())
      .not('actual_credits_usd', 'is', null);
    if (dayErr) throw new Error(`day-cap query failed: ${dayErr.message}`);
    const dayUsed = (dayRows ?? []).reduce((s, r) => s + Number(r.actual_credits_usd ?? 0), 0);
    if (dayUsed + estimatedUsd > cfg.caps.dayUsd) {
      throw ApplicationFailure.nonRetryable(
        `day budget exceeded: used $${dayUsed.toFixed(2)} + estimate $${estimatedUsd} > cap $${cfg.caps.dayUsd}`,
        'BUDGET_CAP_DAY',
      );
    }

    const { error: upsertErr } = await db.from('primitive_runs').upsert(
      {
        id: input.primitive_run_id,
        user_id: input.user_id,
        skill_run_id: input.skill_run_id,
        primitive_id: 'preset_frame',
        status: 'submitted',
        input: {
          product_image_url: input.product_image_url,
          frame: input.frame,
          preset: input.preset,
          shot_kind: input.shot_kind,
          shot_index: input.shot_index,
          prompt: input.prompt,
        },
        estimated_credits_usd: estimatedUsd,
        started_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
    if (upsertErr) throw new Error(`primitive_runs upsert failed: ${upsertErr.message}`);

    await deductPrimitiveCredits({
      db,
      userId: input.user_id,
      primitiveRunId: input.primitive_run_id,
      primitive: 'preset_frame',
      frame: input.frame,
      description: `vNext ${input.preset} ${input.frame} frame ${input.shot_index + 1}`,
    });

    try {
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
              // Portrait, the closest gpt-image size to the 9:16 clip it starts.
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

      const { publicUrl } = await r2UploadVnext(cfg.r2, input.primitive_run_id, 'starting-frame.png', bytes, 'image/png');

      const { data: artifact, error: artErr } = await db
        .from('primitive_artifacts')
        .insert({
          primitive_run_id: input.primitive_run_id,
          kind: 'starting_frame',
          url: publicUrl,
          bytes: bytes.byteLength,
          mime: 'image/png',
          metadata: {
            provider: 'gpt-image-2',
            model: cfg.openai.imageModel,
            simulated: cfg.openai.simulate,
            frame: input.frame,
            preset: input.preset,
            shot_kind: input.shot_kind,
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
    } catch (err) {
      if (err instanceof ApplicationFailure && err.nonRetryable) {
        await refundPrimitiveCredits(db, input.primitive_run_id);
      }
      throw err;
    }
  };
}

const STUB_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
