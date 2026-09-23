// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// What the English and Arabic ASS generators share (lib/ass-format.ts): the
// time format, the two text policies, and a path escaped for ffmpeg's filter
// parser — checked against real ffmpeg where it is installed.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assEscapeText, assPlainText, assTime, ffmpegFilterValue } from '../lib/ass-format.js';
import { generateAss } from '../lib/ass.js';

describe('assTime', () => {
  it('matches the English generator’s former format on Whisper-style timings', () => {
    // The formatter lib/ass.ts used before it was shared, for comparison.
    const former = (seconds: number) => {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      const cs = Math.round((seconds % 1) * 100);
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
    };
    for (let i = 0; i <= 60_000; i++) expect(assTime(i / 100)).toBe(former(i / 100));
    for (const t of [0.47999998927116394, 1.2400000095367432, 12.34, 61.5, 3599.99]) expect(assTime(t)).toBe(former(t));
  });

  it('carries a rounded-up centisecond (the former formatter wrote 0:00:00.100)', () => {
    expect(assTime(0.996)).toBe('0:00:01.00');
    expect(assTime(59.996)).toBe('0:01:00.00');
  });

  it('rounds a half centisecond up, as written', () => {
    expect(assTime(2.755)).toBe('0:00:02.76');
  });
});

describe('ASS text policies', () => {
  it('English escapes backslashes and braces, as the Whisper path always has', () => {
    expect(assEscapeText('a{\\b1}b')).toBe('a\\{\\\\b1\\}b');
    const ass = generateAss([{ word: '{x}', start: 0, end: 1 }], 'minimal');
    expect(ass).toContain(',,\\{x\\}');
  });

  it('Arabic replaces them with look-alikes: nothing special to libass is left', () => {
    const out = assPlainText(' أ {\\b1} ب\\Nج\r\nد ');
    expect(out).not.toMatch(/[{}\\\r\n]/);
    expect(out).toBe('أ (\uFF3Cb1) ب\uFF3CNج د');
  });
});

describe('ffmpegFilterValue', () => {
  it('escapes for the option level, then for the graph level', () => {
    expect(ffmpegFilterValue('/w/captions.ass')).toBe('/w/captions.ass');
    expect(ffmpegFilterValue('a:b')).toBe('a\\\\:b');
    expect(ffmpegFilterValue('a,b;c[d]')).toBe('a\\,b\\;c\\[d\\]');
    expect(ffmpegFilterValue("it's")).toBe("it\\\\\\'s");
    expect(ffmpegFilterValue('a\\b')).toBe('a\\\\\\\\b');
  });

  const hasFfmpeg = (() => {
    try {
      return /\smovie\s/.test(execFileSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' }));
    } catch {
      return false;
    }
  })();

  it.skipIf(!hasFfmpeg)('opens a file whose path has : , [ ] ; and \' through a real ffmpeg filtergraph', () => {
    const root = mkdtempSync(join(tmpdir(), 'ffmpeg-filter-value-'));
    try {
      const dir = join(root, "we:ird,[dir];'q");
      mkdirSync(dir);
      const clip = join(dir, 'in.mp4');
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=s=16x16:d=0.2', '-frames:v', '3', '-y', clip]);
      // The `movie` source takes a filename option exactly as `ass` does.
      const vf = `movie=filename=${ffmpegFilterValue(clip)}[m];[in][m]overlay`;
      expect(() =>
        execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=s=16x16:d=0.2', '-vf', vf, '-f', 'null', '-']),
      ).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
