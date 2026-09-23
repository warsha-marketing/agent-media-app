// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// Caption export (#22), through the real workflow with faked activities. The
// user edited the suggested lines in the Caption editor; api-v2 starts this
// workflow with the clean Short, those lines and a whitelisted style. It burns
// exactly those lines (the shared Captions step, burnCaptions) onto the clean
// Short, never speech-to-text, never a provider, and records the new file as
// the run's output. A failure is recorded on the step and the run.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ApplicationFailure } from '@temporalio/activity';
import { WorkflowFailedError } from '@temporalio/client';
import type { CaptionLine, CaptionStyle } from '@agentmedia/schema';
import { startWorkflowHarness, fakeActivities, type CannedActivities, type WorkflowHarness } from './support/workflow-harness.js';
import type { CaptionExportInput } from '../workflows/caption-export.js';
import type { BurnCaptionsInput } from '../activities/captions.js';

const SKILL_RUN_ID = '41111111-2222-4333-8444-555555555555';
const SHORT_ID = '51111111-2222-4333-8444-555555555555';
const CLEAN_URL = 'https://r2.example.test/shorts/clean.mp4';
const CAPTIONED_URL = 'https://r2.example.test/shorts/captioned.mp4';
const DURATION_MS = 9_020;

const LINES: CaptionLine[] = [
  { text: 'رومي رويال،', start: 0.4, end: 1.5 },
  { text: 'فريش   وراقية.', start: 1.5, end: 3 }, // extra spaces: folded before the burn
  { text: 'جلد ومسك {\\fs200}', start: 3.2, end: 5 }, // an override attempt: the burn's sanitiser neutralises it
];
const STYLE: CaptionStyle = { position: 'top', size: 'l', colour: 'yellow' };

function input(over: Partial<CaptionExportInput> = {}): CaptionExportInput {
  return {
    skill_run_id: SKILL_RUN_ID,
    user_id: 'user-1',
    short_id: SHORT_ID,
    short_url: CLEAN_URL,
    duration_ms: DURATION_MS,
    audio_duration_ms: 9_000,
    preset: 'product_hero',
    aspect_ratio: '9:16',
    lines: LINES,
    style: STYLE,
    ...over,
  };
}

function fakes(overrides: CannedActivities = {}) {
  return fakeActivities({
    composedSkillState: undefined,
    markPrimitiveRunFailed: undefined,
    burnCaptions: (i: BurnCaptionsInput) => ({ primitive_run_id: i.primitive_run_id, video_url: CAPTIONED_URL, duration_ms: DURATION_MS + 10, artifact_id: 'a-cap' }),
    ...overrides,
  });
}

const states = (f: ReturnType<typeof fakes>) => f.callsTo('composedSkillState') as Array<Record<string, unknown>>;

let harness: WorkflowHarness;
beforeAll(async () => {
  harness = await startWorkflowHarness();
}, 120_000);
afterAll(async () => {
  await harness?.teardown();
});

describe('captionExportWorkflow', () => {
  it('burns exactly the given lines and style onto the clean Short, as one free step', async () => {
    const f = fakes();
    const result = await harness.execute('captionExportWorkflow', [input()], f);

    // Only the Captions step: no provider, no speech-to-text, no charge or refund.
    expect(f.names().filter((n) => n !== 'composedSkillState')).toEqual(['burnCaptions']);
    const [burn] = f.callsTo('burnCaptions') as BurnCaptionsInput[];
    expect(burn).toMatchObject({
      skill_run_id: SKILL_RUN_ID,
      user_id: 'user-1',
      short_url: CLEAN_URL,
      style: STYLE,
      source_short_id: SHORT_ID,
      audio_duration_ms: 9_000,
      preset: 'product_hero',
      aspect_ratio: '9:16',
    });
    expect(burn.cues).toEqual([
      { text: 'رومي رويال،', start: 0.4, end: 1.5 },
      { text: 'فريش وراقية.', start: 1.5, end: 3 },
      { text: 'جلد ومسك {\\fs200}', start: 3.2, end: 5 },
    ]);
    expect(burn.primitive_run_id).not.toBe(SKILL_RUN_ID);

    expect(result).toMatchObject({ skill_run_id: SKILL_RUN_ID, video_url: CAPTIONED_URL, duration_ms: DURATION_MS + 10 });
    const s = states(f);
    expect(s[0]).toMatchObject({ skill_run_id: SKILL_RUN_ID, status: 'running', current_step: 'captions' });
    expect(s.at(-1)).toMatchObject({
      status: 'succeeded',
      current_step: 'done',
      final_output: { video_url: CAPTIONED_URL, duration_ms: DURATION_MS + 10, short_id: SHORT_ID, caption_lines: 3, style: STYLE },
    });
  });

  it('a failed burn is recorded on the step and the run, and the workflow fails', async () => {
    const f = fakes({ burnCaptions: () => { throw ApplicationFailure.nonRetryable('libass exploded', 'CAPTIONS_BURN_FAILED'); } });
    await expect(harness.execute('captionExportWorkflow', [input()], f)).rejects.toBeInstanceOf(WorkflowFailedError);
    const [burn] = f.callsTo('burnCaptions') as BurnCaptionsInput[];
    expect(f.callsTo('markPrimitiveRunFailed')).toEqual([
      expect.objectContaining({ primitive_run_id: burn.primitive_run_id, error_code: 'CAPTIONS_BURN_FAILED' }),
    ]);
    expect(states(f).at(-1)).toMatchObject({ status: 'failed', error_code: 'CAPTIONS_BURN_FAILED' });
  });

  it('refuses a captioned file whose length differs from the clean Short (the burn never cuts or pads)', async () => {
    const f = fakes({ burnCaptions: (i: BurnCaptionsInput) => ({ primitive_run_id: i.primitive_run_id, video_url: CAPTIONED_URL, duration_ms: DURATION_MS - 900, artifact_id: 'a' }) });
    await expect(harness.execute('captionExportWorkflow', [input()], f)).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(states(f).at(-1)).toMatchObject({ status: 'failed', error_code: 'CUT_DURATION_MISMATCH' });
  });

  it.each([
    ['overlapping lines', { lines: [{ text: 'أ', start: 0, end: 2 }, { text: 'ب', start: 1, end: 3 }] }],
    ['a line past the Short', { lines: [{ text: 'أ', start: 8, end: 12 }] }],
    ['a style off the whitelist', { style: { position: 'top', size: 'l', colour: '#FF0000' } as unknown as CaptionStyle }],
  ])('re-checks the request and refuses %s before burning anything', async (_label, over) => {
    const f = fakes();
    await expect(harness.execute('captionExportWorkflow', [input(over as Partial<CaptionExportInput>)], f)).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(f.names()).not.toContain('burnCaptions');
    expect(states(f).at(-1)).toMatchObject({ status: 'failed', error_code: 'INVALID_INPUT' });
    expect(f.callsTo('markPrimitiveRunFailed')).toEqual([]);
  });
});
