// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The real providers behind VoiceDeps: the `voices` table through the
 * service-role Supabase client, the operator check, and the ElevenLabs
 * candidate finder. Wired in server.ts; the route tests use fakes instead.
 *
 * Operators are the ADMIN_EMAILS allowlist, the same comma-separated env the web
 * admin panel (apps/web/lib/admin-allowlist.ts) already uses. api-v2 only knows
 * a user id after auth, so the check looks up that user's email with the auth
 * admin API, and counts it only once the user has confirmed that address.
 * Empty ADMIN_EMAILS = nobody is an operator (fail closed).
 *
 * Env: ADMIN_EMAILS, ELEVENLABS_API_KEY (candidate search only), ELEVENLABS_API_BASE.
 */

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { elevenLabsCandidateFinder } from './candidates.js';
import { VoiceError, type NewVoiceRow, type VoiceDeps, type VoiceRow } from './catalog.js';

const TABLE = 'voices';

export function supabaseVoiceRepo(supabase: SupabaseClient): VoiceDeps['repo'] {
  const fail = (what: string, message: string): never => {
    throw new Error(`voices ${what}: ${message}`);
  };
  return {
    async listApproved(dialect) {
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('state', 'approved')
        .eq('dialect', dialect)
        .order('display_name');
      if (error) fail('list approved', error.message);
      return (data ?? []) as VoiceRow[];
    },
    async list({ state, dialect }) {
      let q = supabase.from(TABLE).select('*');
      if (state) q = q.eq('state', state);
      if (dialect) q = q.eq('dialect', dialect);
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) fail('list', error.message);
      return (data ?? []) as VoiceRow[];
    },
    async get(id) {
      const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
      if (error) fail('read', error.message);
      return (data as VoiceRow | null) ?? null;
    },
    async insert(row: NewVoiceRow) {
      const { data, error } = await supabase.from(TABLE).insert(row).select('*').single();
      if (error?.code === '23505') {
        throw new VoiceError(409, 'VOICE_EXISTS', 'This provider voice is already in the catalog.', {
          provider_voice_id: row.provider_voice_id,
        });
      }
      if (error || !data) fail('insert', error?.message ?? 'no row');
      return data as VoiceRow;
    },
    async transition(id, from, patch) {
      // Conditional on the current state, so two operators cannot both "approve"
      // and overwrite each other's record.
      const { data, error } = await supabase.from(TABLE).update(patch).eq('id', id).in('state', from).select('*').maybeSingle();
      if (error) fail('update', error.message);
      return (data as VoiceRow | null) ?? null;
    },
  };
}

/** Operators = ADMIN_EMAILS, resolved from the authenticated user id. */
export function adminEmailOperatorCheck(supabase: SupabaseClient, adminEmails = process.env.ADMIN_EMAILS): VoiceDeps['isOperator'] {
  const allow = new Set(
    (adminEmails ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
  return async (userId) => {
    if (allow.size === 0 || !userId) return false;
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error) throw new Error(`operator check: ${error.message}`);
    // Only a CONFIRMED address counts: anyone can sign up with an operator's
    // email, and must not become an operator before proving they own it.
    const user = data?.user;
    const email = user?.email?.toLowerCase();
    return !!email && !!user?.email_confirmed_at && allow.has(email);
  };
}

export function productionVoiceDeps(supabase: SupabaseClient): VoiceDeps {
  return {
    repo: supabaseVoiceRepo(supabase),
    isOperator: adminEmailOperatorCheck(supabase),
    findCandidates: elevenLabsCandidateFinder({
      apiKey: process.env.ELEVENLABS_API_KEY?.trim() || undefined,
      apiBase: process.env.ELEVENLABS_API_BASE?.trim() || undefined,
    }),
    now: () => new Date(),
    newId: () => randomUUID(),
  };
}
