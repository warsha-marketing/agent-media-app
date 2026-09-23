// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The real providers behind ShortCaptionDeps: skill_runs / primitive_runs /
 * short_drafts through the service-role Supabase client (which bypasses RLS,
 * so every read here is scoped to the caller explicitly), and Temporal for the
 * export workflow. Wired in server.ts; the route tests use fakes instead.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CharacterAlignment } from '@agentmedia/schema';
import { getTemporalClient } from '../orchestrator/temporal/client.js';
import { getTemporalConfig } from '../orchestrator/temporal/config.js';
import { withTimeout } from '../orchestrator/temporal/timeout.js';
import {
  CAPTION_EXPORT_SLUG,
  CAPTION_EXPORT_WORKFLOW,
  ExportUnconfiguredError,
  type ShortCaptionDeps,
  type ShortRun,
  type ShortStep,
  type StoredExport,
} from './short-captions.js';

/** An export is a few seconds of ffmpeg; this is only a ceiling. */
const EXPORT_TIMEOUT_MS = 15 * 60_000;

export function productionShortCaptionDeps(supabase: SupabaseClient): ShortCaptionDeps {
  return {
    async getRun(id, userId) {
      const { data, error } = await supabase
        .from('skill_runs')
        .select('id, user_id, skill_slug, status, input, final_output')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw new Error(`skill_runs read: ${error.message}`);
      return (data as ShortRun | null) ?? null;
    },
    async getSteps(runId) {
      const { data, error } = await supabase
        .from('primitive_runs')
        .select('primitive_id, status, primitive_artifacts(kind, url)')
        .eq('skill_run_id', runId)
        .order('created_at', { ascending: true });
      if (error) throw new Error(`primitive_runs read: ${error.message}`);
      return ((data ?? []) as Array<{ primitive_id: string; status: string; primitive_artifacts?: ShortStep['artifacts'] | null }>).map((s) => ({
        primitive_id: s.primitive_id,
        status: s.status,
        artifacts: s.primitive_artifacts ?? [],
      }));
    },
    async getDraftAlignment(draftId, userId) {
      const { data, error } = await supabase.from('short_drafts').select('alignment').eq('id', draftId).eq('user_id', userId).maybeSingle();
      if (error) throw new Error(`short_drafts read: ${error.message}`);
      return ((data as { alignment?: CharacterAlignment | null } | null)?.alignment ?? null) || null;
    },
    exports: {
      async findByKey(userId, key) {
        const { data, error } = await supabase
          .from('skill_runs')
          .select('id, status, input, request_fingerprint')
          .eq('user_id', userId)
          .eq('skill_slug', CAPTION_EXPORT_SLUG)
          .eq('idempotency_key', key)
          .maybeSingle();
        if (error) throw new Error(`skill_runs idempotency lookup: ${error.message}`);
        return (data as StoredExport | null) ?? null;
      },
      async insert(row) {
        const { data, error } = await supabase
          .from('skill_runs')
          .insert({
            user_id: row.user_id,
            skill_slug: CAPTION_EXPORT_SLUG,
            skill_version: '1.0.0',
            status: 'submitted',
            input: row.input,
            current_step: 'pending',
            idempotency_key: row.idempotency_key,
            request_fingerprint: row.request_fingerprint,
          })
          .select('id')
          .single();
        if (error?.code === '23505') return 'conflict';
        if (error || !data) throw new Error(`skill_runs insert: ${error?.message ?? 'no row'}`);
        return { id: data.id as string };
      },
      async fail(id, code, message) {
        const { error } = await supabase
          .from('skill_runs')
          .update({ status: 'failed', error_code: code, error_message: message.slice(0, 500), finished_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw new Error(`skill_runs fail: ${error.message}`);
      },
    },
    async startExport(workflowId, input) {
      let cfg: ReturnType<typeof getTemporalConfig>;
      try {
        cfg = getTemporalConfig();
      } catch (err) {
        throw new ExportUnconfiguredError((err as Error).message);
      }
      const client = await getTemporalClient();
      await withTimeout(
        client.workflow.start(CAPTION_EXPORT_WORKFLOW, {
          workflowId,
          taskQueue: process.env.TEMPORAL_PRIMITIVE_TASK_QUEUE?.trim() || 'primitive-vnext-v1',
          workflowExecutionTimeout: EXPORT_TIMEOUT_MS,
          workflowRunTimeout: EXPORT_TIMEOUT_MS,
          args: [input],
        }),
        cfg.startTimeoutMs,
        `temporal.workflow.start.${CAPTION_EXPORT_SLUG}`,
      );
    },
  };
}
