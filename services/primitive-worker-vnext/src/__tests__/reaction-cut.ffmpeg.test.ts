// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The intercut cut (Reaction, #19) with REAL ffmpeg (skipped where ffmpeg is
// not installed): each 5 s clip is cut to its planned share, in shot order, so
// no shot stays on screen longer than planned and the Short is exactly as long
// as the audio.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planPresetShots, REACTION } from '@agentmedia/schema';
import { productHeroCutFilter } from '../activities/product-hero.js';

const run = promisify(execFile);
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'reaction-cut-test-'));
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** The dominant colour of the frame at `t` seconds: 'red' or 'blue'. */
async function colourAt(path: string, t: number): Promise<'red' | 'blue'> {
  const { stdout } = await run(
    'ffmpeg',
    ['-v', 'error', '-ss', t.toFixed(3), '-i', path, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { encoding: 'buffer' } as never,
  ) as unknown as { stdout: Buffer };
  return stdout[0] > stdout[2] ? 'red' : 'blue';
}

describe.skipIf(!hasFfmpeg)('productHeroCutFilter with planned shot lengths (real ffmpeg)', () => {
  it('cuts each 5 s clip to its share, in order, to exactly the audio length', async () => {
    const ms = 12_000;
    const shots = planPresetShots(REACTION, ms); // 4 shots of 3 s
    const clips: string[] = [];
    for (let i = 0; i < shots.length; i += 1) {
      const p = join(dir, `clip-${i}.mp4`);
      const c = i % 2 === 0 ? 'red' : 'blue';
      await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=${c}:s=108x192:r=30:d=5`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', p]);
      clips.push(p);
    }
    const out = join(dir, 'short.mp4');
    const seconds = ms / 1000;
    await run('ffmpeg', [
      '-y',
      ...clips.flatMap((p) => ['-i', p]),
      '-filter_complex', productHeroCutFilter(clips.length, seconds, shots.map((s) => s.onScreenMs!)),
      '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', out,
    ]);
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', out]);
    expect(Math.abs(parseFloat(stdout) - seconds)).toBeLessThan(0.05);
    // 0–3 s red (reaction), 3–6 blue (product), 6–9 red, 9–12 blue.
    expect(await colourAt(out, 1.5)).toBe('red');
    expect(await colourAt(out, 4.5)).toBe('blue');
    expect(await colourAt(out, 7.5)).toBe('red');
    expect(await colourAt(out, 10.5)).toBe('blue');
  }, 60_000);

  it('without planned lengths, plays the clips whole (Product Hero unchanged)', () => {
    const filter = productHeroCutFilter(2, 12);
    expect(filter).not.toMatch(/\[\d:v\][^;]*trim=/);
    expect(filter).toContain('trim=duration=12.000');
  });
});
