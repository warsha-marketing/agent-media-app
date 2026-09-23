// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Arabic Captions burned with REAL ffmpeg + libass (#10). Skipped where ffmpeg
// has no libass (`ass` filter) or Noto Sans Arabic is not installed — the
// worker image has both (Dockerfile: ffmpeg, fonts-noto-core). Run it there:
//
//   docker build -f services/primitive-worker-vnext/Dockerfile -t pwv .
//   docker run --rm -e CAPTIONS_SAMPLE_DIR=/out -v "$PWD/out:/out" pwv \
//     npx vitest run src/__tests__/arabic-captions.ffmpeg.test.ts
//
// It checks what the burn must never change — frame count, length, the audio
// (copied bit for bit) — that the captions land in the lower third and nowhere
// else, and that libass drew them in Noto Sans Arabic. It writes a frame PNG
// (the sample to look at for shaping and direction) to its temp dir, and to
// CAPTIONS_SAMPLE_DIR when set.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captionCuesFromAlignment, type CaptionLine, type CaptionStyle, type CharacterAlignment } from '@agentmedia/schema';
import { ARABIC_CAPTION_STYLE, arabicCaptionsAss, assCaptionStyle, captionBurnArgs } from '../lib/arabic-captions-ass.js';

const run = promisify(execFile);

const canBurnArabic = (() => {
  try {
    const filters = execFileSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' });
    if (!/\sass\s/.test(filters)) return false;
    const family = execFileSync('fc-match', ['-f', '%{family}', `${ARABIC_CAPTION_STYLE.fontName}:bold`], { encoding: 'utf8' });
    return family.includes(ARABIC_CAPTION_STYLE.fontName);
  } catch {
    return false;
  }
})();

/** The live test Script, voiced at 70 ms a character (tags included, as ElevenLabs returns). */
const SCRIPT = '[confidently] رومي رويال ريتشوالز، فريش وراقية. [softly] برغموت، فلفل زهري، جِلد ومِسك.';
function alignmentOf(text: string, step = 0.07): CharacterAlignment {
  const chars = [...text];
  return {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => +(i * step).toFixed(3)),
    character_end_times_seconds: chars.map((_, i) => +((i + 1) * step).toFixed(3)),
  };
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'arabic-captions-test-'));
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function probeStream(path: string, stream: 'v:0' | 'a:0'): Promise<Record<string, string>> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-count_frames', '-select_streams', stream,
    '-show_entries', 'stream=codec_name,duration,nb_read_frames,r_frame_rate,width,height',
    '-of', 'default=noprint_wrappers=1', path,
  ]);
  return Object.fromEntries(stdout.trim().split('\n').map((l) => l.split('=') as [string, string]));
}

async function audioMd5(path: string): Promise<string> {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', path, '-map', '0:a', '-c', 'copy', '-f', 'md5', '-']);
  return stdout.trim();
}

/** Luma of one frame's rows [y0, y1) at time `t`, as raw 8-bit gray. */
async function grayRows(path: string, t: number, y0: number, y1: number): Promise<Buffer> {
  const { stdout } = await run(
    'ffmpeg',
    ['-v', 'error', '-ss', String(t), '-i', path, '-frames:v', '1', '-vf', `crop=1080:${y1 - y0}:0:${y0}`, '-pix_fmt', 'gray', '-f', 'rawvideo', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout as unknown as Buffer;
}

const brightPixels = (b: Buffer, over = 200) => b.reduce((n, v) => n + (v > over ? 1 : 0), 0);

describe.skipIf(!canBurnArabic)('Arabic Captions burn (real ffmpeg + libass)', () => {
  it('draws the cues in the lower third, in Noto Sans Arabic, without changing frames, length or audio', async () => {
    const alignment = alignmentOf(SCRIPT);
    const seconds = 7.2;
    const cues = captionCuesFromAlignment(alignment, { durationSeconds: seconds });
    expect(cues.length).toBeGreaterThan(2);

    // The finished Short as the mux makes it: 1080×1920, 30 fps, H.264 + AAC voice.
    const inPath = join(dir, 'short.mp4');
    await run('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', `color=c=0x1d3557:s=1080x1920:r=30:d=${seconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=300:duration=${seconds}`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', inPath,
    ]);
    const assPath = join(dir, 'captions.ass');
    writeFileSync(assPath, arabicCaptionsAss(cues), 'utf8');
    const outPath = join(dir, 'short-captioned.mp4');
    const burn = await run('ffmpeg', ['-loglevel', 'debug', ...captionBurnArgs({ inPath, assPath, outPath })], { maxBuffer: 64 * 1024 * 1024 });

    // libass picked the bundled Arabic font (not a fallback).
    expect(burn.stderr).toMatch(/NotoSansArabic/);

    // Frames, length and audio untouched.
    const [vIn, vOut] = [await probeStream(inPath, 'v:0'), await probeStream(outPath, 'v:0')];
    expect(vOut.nb_read_frames).toBe(vIn.nb_read_frames);
    expect(vOut.r_frame_rate).toBe(vIn.r_frame_rate);
    expect([vOut.width, vOut.height]).toEqual(['1080', '1920']);
    expect(Math.abs(parseFloat(vOut.duration) - parseFloat(vIn.duration))).toBeLessThan(0.034);
    expect(await audioMd5(outPath)).toBe(await audioMd5(inPath));

    // Mid-way through the first cue: bright caption pixels in the lower third,
    // none elsewhere.
    const t = (cues[0].start + cues[0].end) / 2;
    const bandBottom = 1920 - ARABIC_CAPTION_STYLE.marginV;
    const band = await grayRows(outPath, t, bandBottom - 260, bandBottom + 10);
    const above = await grayRows(outPath, t, 0, bandBottom - 260);
    const below = await grayRows(outPath, t, bandBottom + 10, 1920);
    expect(brightPixels(band)).toBeGreaterThan(2000);
    expect(brightPixels(above)).toBe(0);
    expect(brightPixels(below)).toBe(0);
    // Before the first word is spoken, nothing is drawn.
    expect(brightPixels(await grayRows(outPath, cues[0].start / 2, 0, 1920))).toBe(0);

    // The sample frame to look at (shaping, right-to-left order, placement).
    const png = join(dir, 'caption-frame.png');
    await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(t), '-i', outPath, '-frames:v', '1', png]);
    expect(existsSync(png)).toBe(true);
    const sampleDir = process.env.CAPTIONS_SAMPLE_DIR;
    if (sampleDir) {
      copyFileSync(png, join(sampleDir, 'caption-frame.png'));
      copyFileSync(assPath, join(sampleDir, 'captions.ass'));
      for (const [i, c] of cues.entries()) {
        const f = join(sampleDir, `cue-${i}.png`);
        await run('ffmpeg', ['-y', '-v', 'error', '-ss', String((c.start + c.end) / 2), '-i', outPath, '-frames:v', '1', f]);
      }
    }
  }, 120_000);
});

describe.skipIf(!canBurnArabic)('Caption export burn (#22): edited lines in a chosen style (real ffmpeg + libass)', () => {
  it('draws exactly the given lines at the top in the chosen colour, and leaves frames, length and audio untouched', async () => {
    const seconds = 4;
    const inPath = join(dir, 'clean.mp4');
    await run('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', `color=c=0x1d3557:s=1080x1920:r=30:d=${seconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', inPath,
    ]);
    // What the Caption editor sends: edited words, edited timing, a whitelisted style.
    const lines: CaptionLine[] = [
      { text: 'جلد ومسك', start: 0.5, end: 1.6 },
      { text: 'Rumi رويال {\\fs300}', start: 2, end: 3.4 },
    ];
    const style: CaptionStyle = { position: 'top', size: 'l', colour: 'yellow' };
    const assPath = join(dir, 'export.ass');
    writeFileSync(assPath, arabicCaptionsAss(lines, style), 'utf8');
    const outPath = join(dir, 'captioned-export.mp4');
    await run('ffmpeg', captionBurnArgs({ inPath, assPath, outPath }), { maxBuffer: 64 * 1024 * 1024 });

    const [vIn, vOut] = [await probeStream(inPath, 'v:0'), await probeStream(outPath, 'v:0')];
    expect(vOut.nb_read_frames).toBe(vIn.nb_read_frames);
    expect(Math.abs(parseFloat(vOut.duration) - parseFloat(vIn.duration))).toBeLessThan(0.034);
    expect(await audioMd5(outPath)).toBe(await audioMd5(inPath));

    // Top placement: text hangs from marginV, nothing in the lower half.
    const top = assCaptionStyle(style).marginV;
    const t = 1;
    expect(brightPixels(await grayRows(outPath, t, top - 10, top + 220), 150)).toBeGreaterThan(1500);
    expect(brightPixels(await grayRows(outPath, t, 960, 1920), 150)).toBe(0);
    // Between the lines, nothing is drawn.
    expect(brightPixels(await grayRows(outPath, 1.8, 0, 1920), 150)).toBe(0);
  }, 120_000);
});
