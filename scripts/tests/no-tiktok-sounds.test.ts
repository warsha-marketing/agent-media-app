// Guard (#9): no code path fetches, scrapes or embeds TikTok sounds. TikTok
// licenses its sounds only for use inside its app; a Short that wants one is
// rendered voice only (Music Bed off) and the user adds the sound in TikTok.
//
// Cheap and blunt: no tracked source file may name a TikTok / ByteDance media
// host or a TikTok download/scrape tool, and no package may depend on one. The
// only allowed mention is the web CSP's img-src (profile pictures from the
// social accounts integration — images, never audio).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE = /\.(ts|tsx|js|mjs|cjs|jsx|json|py|sh|sql|ya?ml)$/;
const THIS_FILE = 'scripts/tests/no-tiktok-sounds.test.ts';

/** TikTok media hosts and sound download/scrape tools. */
const BANNED = /tiktok\.com\/(music|api)|tiktokcdn|tiktokv\.com|musical\.ly|muscdn|ibytedtos|byteoversea|ttwstatic|tikwm|ssstik|snaptik|musicaldown|tiktok-?(scraper|downloader|dl\b|api\b)|tiktok-music/i;

/** file → the only line shapes allowed to mention a banned host there. */
const ALLOWED: Record<string, RegExp> = {
  // CSP img-src: avatars of connected social accounts. Images only.
  'apps/web/middleware.ts': /"img-src [^"]*tiktokcdn/,
};

function tracked(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => SOURCE.test(f) && f !== THIS_FILE && !f.includes('node_modules/') && !f.endsWith('pnpm-lock.yaml'));
}

describe('no TikTok sounds in any code path', () => {
  it('no source file names a TikTok media host or sound scraper (outside the CSP img-src)', () => {
    const hits: string[] = [];
    for (const f of tracked()) {
      let text: string;
      try {
        text = readFileSync(ROOT + f, 'utf8');
      } catch {
        continue; // deleted in the working tree
      }
      text.split('\n').forEach((line, i) => {
        if (BANNED.test(line) && !(ALLOWED[f]?.test(line))) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
      });
    }
    assert.deepEqual(hits, []);
  });

  it('the CSP never lets TikTok media play as audio or video', () => {
    const mw = readFileSync(ROOT + 'apps/web/middleware.ts', 'utf8');
    for (const directive of mw.match(/"(media|connect|default)-src [^"]*"/g) ?? []) {
      assert.doesNotMatch(directive, /tiktok/i, directive);
    }
  });
});
