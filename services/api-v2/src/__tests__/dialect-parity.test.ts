// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The Dialect lists come from ONE place (@agentmedia/schema src/dialects.ts).
// What cannot import it is held equal to it here: the SQL CHECKs on voices and
// qualified_presets (every Dialect) and short_drafts (Script Dialects), as the
// latest migration touching each leaves them, and the web admin Voices page.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DIALECTS, SCRIPT_DIALECTS } from '@agentmedia/schema';
import { VoiceDialectSchema } from '../voices/catalog.js';
import { DialectSchema } from '../drafts/product-hero-draft.js';
import { QualificationPathSchema } from '../presets/qualification.js';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const MIGRATIONS = `${ROOT}supabase/migrations/`;

/** The dialect CHECK list of `table`, from the last migration that declares one. */
function sqlDialects(table: string): string[] {
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  let found: string[] | null = null;
  for (const f of files) {
    const sql = readFileSync(`${MIGRATIONS}${f}`, 'utf8');
    const re = new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'g');
    for (const m of sql.matchAll(re)) {
      const check = /dialect\s+text\s+NOT NULL\s+CHECK\s*\(\s*dialect\s+IN\s*\(([^)]*)\)/i.exec(m[1]);
      if (check) found = check[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    }
  }
  if (!found) throw new Error(`no dialect CHECK found for ${table}`);
  return found;
}

describe('Dialect lists', () => {
  it('every API schema reads the one list', () => {
    expect(VoiceDialectSchema.options).toEqual([...DIALECTS]);
    expect(DialectSchema.options).toEqual([...SCRIPT_DIALECTS]);
    expect(QualificationPathSchema.shape.dialect.options).toEqual([...SCRIPT_DIALECTS]);
    for (const d of SCRIPT_DIALECTS) expect(DIALECTS).toContain(d);
  });

  it('the SQL CHECKs match it', () => {
    expect(sqlDialects('voices')).toEqual([...DIALECTS]);
    expect(sqlDialects('qualified_presets')).toEqual([...DIALECTS]);
    expect(sqlDialects('short_drafts')).toEqual([...SCRIPT_DIALECTS]);
  });

  it('the web admin Voices page lists the same Dialects', () => {
    const page = readFileSync(`${ROOT}apps/web/app/(app-dark)/dashboard/admin/voices/page.tsx`, 'utf8');
    const m = /const DIALECTS = \[([^\]]*)\]/.exec(page);
    expect(m, 'DIALECTS in the admin Voices page').not.toBeNull();
    expect(m![1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))).toEqual([...DIALECTS]);
  });
});
