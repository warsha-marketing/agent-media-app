// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// make_product_hero (the Product Hero render phase), driven end to end through
// the real workflow in Temporal's test environment with every provider faked at
// the activity boundary. ADR 0001: the approved draft's audio comes first, the
// video model never speaks, and the visuals are cut to the audio — never the
// reverse. These tests assert what was requested, in what order, and what the
// user gets back.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ApplicationFailure } from '@temporalio/activity';
import { WorkflowFailedError } from '@temporalio/client';
import { startWorkflowHarness, fakeActivities, type CannedActivities, type WorkflowHarness } from './support/workflow-harness.js';
import type { MakeProductHeroWorkflowInput } from '../workflows/make-product-hero.js';
import type {
  FetchDraftAudioInput,
  ProductHeroClipInput,
  MuxProductHeroInput,
} from '../activities/product-hero.js';

const SKILL_RUN_ID = '11111111-2222-4333-8444-555555555555';
const AUDIO_KEY = 'vnext/drafts/user-1/draft-1.mp3';

function renderInput(durationMs: number): MakeProductHeroWorkflowInput {
  return {
    skill_run_id: SKILL_RUN_ID,
    user_id: 'user-1',
    draft_id: 'draft-1',
    audio_key: AUDIO_KEY,
    duration_ms: durationMs,
    product_image_url: 'https://r2.example.test/uploads/product.png',
    aspect_ratio: '9:16',
  };
}

/** Fakes that behave like the real steps: the audio is measured, each clip is as
 *  long as requested, and the mux trims the visuals to the audio it is given. */
function happyFakes(overrides: CannedActivities = {}) {
  return fakeActivities({
    composedSkillState: undefined,
    refundCredits: undefined,
    markPrimitiveRunFailed: undefined,
    fetchDraftAudio: (i: FetchDraftAudioInput) => ({
      primitive_run_id: i.primitive_run_id,
      audio_key: i.audio_key,
      duration_ms: i.duration_ms,
    }),
    productHeroClip: (i: ProductHeroClipInput) => ({
      primitive_run_id: i.primitive_run_id,
      video_url: `https://r2.example.test/clips/${i.shot_index}.mp4`,
      duration_seconds: i.duration,
      credits_actual_usd: i.duration === 10 ? 1.2 : 0.6,
    }),
    muxProductHero: (i: MuxProductHeroInput) => ({
      primitive_run_id: i.primitive_run_id,
      video_url: 'https://r2.example.test/shorts/final.mp4',
      duration_ms: i.audio_duration_ms,
      artifact_id: 'artifact-short',
    }),
    ...overrides,
  });
}

let harness: WorkflowHarness;

beforeAll(async () => {
  harness = await startWorkflowHarness();
}, 120_000);

afterAll(async () => {
  await harness?.teardown();
});

describe('makeProductHeroWorkflow — audio first, silent visuals cut to the audio', () => {
  it('fetches the draft audio before any visual is requested', async () => {
    const fakes = happyFakes();
    await harness.execute('makeProductHeroWorkflow', [renderInput(12_000)], fakes);

    const steps = fakes.names().filter((n) => n !== 'composedSkillState');
    expect(steps).toEqual(['fetchDraftAudio', 'productHeroClip', 'productHeroClip', 'muxProductHero']);
  });

  it('asks for every clip with the video model’s own audio disabled, from the product photo', async () => {
    const fakes = happyFakes();
    await harness.execute('makeProductHeroWorkflow', [renderInput(14_000)], fakes);

    const clips = fakes.callsTo('productHeroClip') as ProductHeroClipInput[];
    expect(clips.length).toBeGreaterThan(0);
    for (const c of clips) {
      expect(c.generate_audio).toBe(false);
      expect(c.product_image_url).toBe('https://r2.example.test/uploads/product.png');
      expect(c.skill_run_id).toBe(SKILL_RUN_ID);
    }
  });

  it.each([5_000, 7_300, 10_000, 12_480, 15_000])(
    'returns a Short exactly as long as %i ms of audio, never trimming the audio',
    async (durationMs) => {
      const fakes = happyFakes();
      const result = await harness.execute('makeProductHeroWorkflow', [renderInput(durationMs)], fakes);

      const clips = fakes.callsTo('productHeroClip') as ProductHeroClipInput[];
      const visualsMs = clips.reduce((s, c) => s + c.duration * 1000, 0);
      expect(visualsMs).toBeGreaterThanOrEqual(durationMs); // visuals cover the speech
      const [mux] = fakes.callsTo('muxProductHero') as MuxProductHeroInput[];
      expect(mux.audio_duration_ms).toBe(durationMs); // cut to the audio's length
      expect(mux.clip_urls).toHaveLength(clips.length);
      expect(result.duration_ms).toBe(durationMs);
      expect(result.video_url).toBe('https://r2.example.test/shorts/final.mp4');
    },
  );

  it('ships the draft’s own audio: no voicing step exists, and the mux uses the draft audio key', async () => {
    const fakes = happyFakes();
    await harness.execute('makeProductHeroWorkflow', [renderInput(9_000)], fakes);

    const allowed = new Set(['composedSkillState', 'fetchDraftAudio', 'productHeroClip', 'muxProductHero']);
    for (const name of fakes.names()) expect(allowed.has(name)).toBe(true);
    const [audio] = fakes.callsTo('fetchDraftAudio') as FetchDraftAudioInput[];
    expect(audio.audio_key).toBe(AUDIO_KEY);
    const [mux] = fakes.callsTo('muxProductHero') as MuxProductHeroInput[];
    expect(mux.audio_key).toBe(AUDIO_KEY);
  });

  it('records the Short as the skill run’s final output', async () => {
    const fakes = happyFakes();
    await harness.execute('makeProductHeroWorkflow', [renderInput(8_000)], fakes);

    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    const done = states.at(-1)!;
    expect(done.status).toBe('succeeded');
    expect(done.final_output).toMatchObject({
      video_url: 'https://r2.example.test/shorts/final.mp4',
      duration_ms: 8_000,
      draft_id: 'draft-1',
    });
  });

  it('gives every step its own primitive run under the skill run', async () => {
    const fakes = happyFakes();
    await harness.execute('makeProductHeroWorkflow', [renderInput(12_000)], fakes);

    const ids = fakes.calls
      .filter((c) => c.name !== 'composedSkillState')
      .map((c) => (c.input as { primitive_run_id: string; skill_run_id: string }))
      .map((i) => {
        expect(i.skill_run_id).toBe(SKILL_RUN_ID);
        return i.primitive_run_id;
      });
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('makeProductHeroWorkflow — failure refunds every charged child', () => {
  const failAt: Array<[string, CannedActivities]> = [
    ['the audio fetch', { fetchDraftAudio: () => { throw ApplicationFailure.nonRetryable('no such object', 'DRAFT_AUDIO_MISSING'); } }],
    ['the second clip', {
      productHeroClip: (i: ProductHeroClipInput) => {
        if (i.shot_index === 1) throw ApplicationFailure.nonRetryable('provider 500', 'EVOLINK_400');
        return { primitive_run_id: i.primitive_run_id, video_url: 'https://r2.example.test/c.mp4', duration_seconds: i.duration, credits_actual_usd: 1.2 };
      },
    }],
    ['the mux', { muxProductHero: () => { throw ApplicationFailure.nonRetryable('ffmpeg exploded', 'MUX_FAILED'); } }],
  ];

  it.each(failAt)('a terminal failure at %s refunds every clip it charged and fails the run', async (_where, overrides) => {
    const fakes = happyFakes(overrides);
    const run = harness.execute('makeProductHeroWorkflow', [renderInput(12_000)], fakes);
    await expect(run).rejects.toBeInstanceOf(WorkflowFailedError);

    const refunded = new Set((fakes.callsTo('refundCredits') as Array<{ primitive_run_id: string }>).map((r) => r.primitive_run_id));
    for (const clip of fakes.callsTo('productHeroClip') as ProductHeroClipInput[]) {
      expect(refunded.has(clip.primitive_run_id)).toBe(true);
    }
    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    expect(states.at(-1)).toMatchObject({ status: 'failed' });
    // Nothing is rendered after a failure.
    const names = fakes.names();
    expect(names.lastIndexOf('refundCredits')).toBeGreaterThan(Math.max(
      names.lastIndexOf('productHeroClip'),
      names.lastIndexOf('fetchDraftAudio'),
      names.lastIndexOf('muxProductHero'),
    ));
  });

  it('fails when the cut does not match the audio length, and refunds', async () => {
    const fakes = happyFakes({
      muxProductHero: (i: MuxProductHeroInput) => ({
        primitive_run_id: i.primitive_run_id,
        video_url: 'https://r2.example.test/shorts/final.mp4',
        duration_ms: i.audio_duration_ms - 500,
        artifact_id: 'a',
      }),
    });
    const run = harness.execute('makeProductHeroWorkflow', [renderInput(10_000)], fakes);
    await expect(run).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(fakes.callsTo('refundCredits').length).toBeGreaterThan(0);
  });
});

describe('makeProductHeroWorkflow — a blocked product photo', () => {
  it('fails on a content-policy violation without retrying the clip, and refunds', async () => {
    const fakes = happyFakes({
      // Even a failure not flagged non-retryable must not be resubmitted: a
      // moderation decision is final, and each retry is another paid render.
      productHeroClip: () => {
        throw ApplicationFailure.create({
          message: 'The generated video was blocked by content moderation.',
          type: 'EVOLINK_CONTENT_POLICY_VIOLATION',
          nonRetryable: false,
        });
      },
    });

    const run = harness.execute('makeProductHeroWorkflow', [renderInput(12_000)], fakes);
    await expect(run).rejects.toBeInstanceOf(WorkflowFailedError);

    const clips = fakes.callsTo('productHeroClip') as ProductHeroClipInput[];
    expect(clips).toHaveLength(1);
    expect(fakes.callsTo('refundCredits')).toContainEqual({ primitive_run_id: clips[0].primitive_run_id });
    expect(fakes.callsTo('markPrimitiveRunFailed')).toContainEqual(
      expect.objectContaining({ primitive_run_id: clips[0].primitive_run_id, error_code: 'EVOLINK_CONTENT_POLICY_VIOLATION' }),
    );
    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    expect(states.at(-1)).toMatchObject({ status: 'failed', error_code: 'EVOLINK_CONTENT_POLICY_VIOLATION' });
    expect(fakes.names()).not.toContain('muxProductHero');
  });
});
