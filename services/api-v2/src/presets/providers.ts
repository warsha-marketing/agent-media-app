// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The real providers behind PresetDeps: the `qualified_presets` table through
 * the service-role Supabase client (see
 * supabase/migrations/20260923180000_qualified_presets.sql) and the operator
 * check (ADMIN_EMAILS, confirmed address; voices/providers.ts). Wired in
 * server.ts, the draft providers and the make_product_hero quote/run; the route
 * tests use fakes instead.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { adminEmailOperatorCheck } from '../voices/providers.js';
import type { PresetAccess, PresetDeps, QualifiedPresetRow } from './qualification.js';

const TABLE = 'qualified_presets';

export function supabaseQualifiedPresetRepo(supabase: SupabaseClient): PresetDeps['repo'] {
  const fail = (what: string, message: string): never => {
    throw new Error(`qualified_presets ${what}: ${message}`);
  };
  return {
    async list() {
      const { data, error } = await supabase.from(TABLE).select('*').order('preset').order('dialect');
      if (error) fail('list', error.message);
      return (data ?? []) as QualifiedPresetRow[];
    },
    async get(preset, dialect) {
      const { data, error } = await supabase.from(TABLE).select('*').eq('preset', preset).eq('dialect', dialect).maybeSingle();
      if (error) fail('read', error.message);
      return (data as QualifiedPresetRow | null) ?? null;
    },
    async qualify(preset, dialect, patch) {
      // A pair never reviewed has no row: insert it qualified. One that exists
      // moves only from withdrawn, conditionally, so two operators cannot both
      // "qualify" and overwrite each other's record.
      const { data, error } = await supabase.from(TABLE).insert({ preset, dialect, ...patch }).select('*').maybeSingle();
      if (!error) return data as QualifiedPresetRow;
      if (error.code !== '23505') fail('insert', error.message);
      const { data: moved, error: upErr } = await supabase
        .from(TABLE)
        .update(patch)
        .eq('preset', preset)
        .eq('dialect', dialect)
        .eq('state', 'withdrawn')
        .select('*')
        .maybeSingle();
      if (upErr) fail('update', upErr.message);
      return (moved as QualifiedPresetRow | null) ?? null;
    },
    async withdraw(preset, dialect, patch) {
      const { data, error } = await supabase
        .from(TABLE)
        .update(patch)
        .eq('preset', preset)
        .eq('dialect', dialect)
        .eq('state', 'qualified')
        .select('*')
        .maybeSingle();
      if (error) fail('update', error.message);
      return (data as QualifiedPresetRow | null) ?? null;
    },
  };
}

/** The draft and render gate's view: qualified Dialects per Preset, read per request. */
export function supabasePresetAccess(supabase: SupabaseClient): PresetAccess {
  return {
    async qualifiedDialects(preset) {
      const { data, error } = await supabase.from(TABLE).select('dialect').eq('preset', preset).eq('state', 'qualified');
      if (error) throw new Error(`qualified_presets read: ${error.message}`);
      return ((data ?? []) as Array<{ dialect: string }>).map((r) => r.dialect);
    },
    isOperator: adminEmailOperatorCheck(supabase),
  };
}

export function productionPresetDeps(supabase: SupabaseClient): PresetDeps {
  return {
    ...supabasePresetAccess(supabase),
    repo: supabaseQualifiedPresetRepo(supabase),
    now: () => new Date(),
  };
}
