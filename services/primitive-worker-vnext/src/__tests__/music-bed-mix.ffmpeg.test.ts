// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The Music Bed mix with REAL ffmpeg (skipped where ffmpeg is not installed):
// whatever the track's length, the Short comes out exactly as long as the voice
// — a long bed is cut, a short one is looped — with the cut's video untouched.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { musicBedMixArgs } from '../activities/music-bed.js';

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
  dir = mkdtempSync(join(tmpdir(), 'music-bed-test-'));
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function probe(path: string, stream: 'a:0' | 'v:0'): Promise<{ seconds: number; codec: string }> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', stream, '-show_entries', 'stream=duration,codec_name', '-of', 'default=noprint_wrappers=1', path]);
  const kv = Object.fromEntries(stdout.trim().split('\n').map((l) => l.split('=')));
  return { seconds: parseFloat(kv.duration), codec: kv.codec_name };
}

async function maxVolumeDb(path: string, from: number, to: number, bandHz?: number): Promise<number> {
  const af = bandHz ? `bandpass=f=${bandHz}:width_type=q:w=8,bandpass=f=${bandHz}:width_type=q:w=8,volumedetect` : 'volumedetect';
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-ss', String(from), '-to', String(to), '-i', path, '-af', af, '-vn', '-f', 'null', '-']);
  return parseFloat(/max_volume:\s*(-?[\d.]+) dB/.exec(stderr)![1]);
}

describe.skipIf(!hasFfmpeg)('musicBedMixArgs (real ffmpeg)', () => {
  it.each([
    ['a bed longer than the voice is cut', 6.4, 20],
    ['a bed shorter than the voice is looped', 9.2, 3],
  ])('%s: the Short is exactly as long as the voice', async (_label, voiceSecs, bedSecs) => {
    const shortPath = join(dir, `short-${voiceSecs}.mp4`);
    const voicePath = join(dir, `voice-${voiceSecs}.mp3`);
    const bedPath = join(dir, `bed-${bedSecs}.mp3`);
    const outPath = join(dir, `out-${voiceSecs}-${bedSecs}.mp4`);
    // The cut Short as the mux makes it: video + the voice track, voice-long.
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=blue:s=108x192:r=30:d=${voiceSecs}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', shortPath]);
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', `sine=frequency=300:duration=${voiceSecs}`, '-c:a', 'libmp3lame', voicePath]);
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', `sine=frequency=900:duration=${bedSecs}`, '-c:a', 'libmp3lame', bedPath]);

    await run('ffmpeg', musicBedMixArgs({ shortPath, voicePath, bedPath, outPath, seconds: voiceSecs }));

    const a = await probe(outPath, 'a:0');
    const v = await probe(outPath, 'v:0');
    expect(Math.abs(a.seconds - voiceSecs)).toBeLessThan(0.06);
    expect(Math.abs(v.seconds - voiceSecs)).toBeLessThan(0.05);
    expect(v.codec).toBe('h264'); // copied, not re-encoded to something else
    expect(a.codec).toBe('aac');
  }, 60_000);

  it('the bed sits well under the voice, and ducks further while the voice speaks', async () => {
    // Voice only in the first half, silence in the second: the bed alone must be
    // far quieter than voice + bed.
    const secs = 8;
    const shortPath = join(dir, 'short-duck.mp4');
    const voicePath = join(dir, 'voice-duck.wav');
    const bedPath = join(dir, 'bed-duck.mp3');
    const outPath = join(dir, 'out-duck.mp4');
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=blue:s=108x192:r=30:d=${secs}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', shortPath]);
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', `sine=frequency=300:duration=${secs}`, '-af', "volume='if(lt(t,4),0.8,0)':eval=frame", voicePath]);
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', `sine=frequency=900:duration=${secs}`, '-af', 'volume=0.8', '-c:a', 'libmp3lame', bedPath]);
    await run('ffmpeg', musicBedMixArgs({ shortPath, voicePath, bedPath, outPath, seconds: secs }));

    const withVoice = await maxVolumeDb(outPath, 1, 3.5);
    const bedAlone = await maxVolumeDb(outPath, 5, 6.5);
    expect(bedAlone).toBeLessThan(withVoice - 10);
    // The bed's own tone (900 Hz), isolated: lower under speech than in the gap.
    const bedUnderSpeech = await maxVolumeDb(outPath, 1, 3.5, 900);
    const bedInGap = await maxVolumeDb(outPath, 5, 6.5, 900);
    expect(bedUnderSpeech).toBeLessThan(bedInGap - 3);
  }, 60_000);
});
