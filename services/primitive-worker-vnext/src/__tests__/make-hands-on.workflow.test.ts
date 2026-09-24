// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// make_hands_on (#18), driven end to end through the real workflow in Temporal's
// test environment with every provider faked at the activity boundary. ADR 0001:
// the approved draft's audio comes first and is the only voice; each hands shot
// starts from a product-in-hands frame made before any animation; every clip is
// silent; the visuals are cut to the audio. The Modesty Default is in every
// hands prompt, frame and clip alike.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ApplicationFailure } from '@temporalio/activity';
import { WorkflowFailedError } from '@temporalio/client';
import { quotePresetCredits, HANDS_ON, STARTING_FRAME_CREDITS } from '@agentmedia/schema';
import { startWorkflowHarness, fakeActivities, type CannedActivities, type WorkflowHarness } from './support/workflow-harness.js';
import type { MakeHandsOnWorkflowInput } from '../workflows/make-hands-on.js';
import type { FetchDraftAudioInput, PresetClipInput, PresetMuxInput } from '../activities/preset-render.js';
import type { PresetStartingFrameInput } from '../activities/preset-frame.js';
import { HANDS_ON_RENDER } from '../presets/index.js';
import { FORMAT, FORMAT_FRAME, HAND_WORDS, MODESTY_PROMPTS, SETTING_WORDS } from '@agentmedia/shot-prompts';
import { quotePrimitiveCredits } from '../client/credits.js';

const SKILL_RUN_ID = '18181818-2222-4333-8444-555555555555';
const AUDIO_KEY = 'vnext/drafts/user-1/draft-18.mp3';
const PHOTO = 'https://r2.example.test/uploads/product.png';
const frameUrl = (i: number) => `https://r2.example.test/frames/${i}.png`;

function renderInput(durationMs: number, over: Partial<MakeHandsOnWorkflowInput> = {}): MakeHandsOnWorkflowInput {
  return {
    skill_run_id: SKILL_RUN_ID,
    user_id: 'user-1',
    draft_id: 'draft-18',
    audio_key: AUDIO_KEY,
    duration_ms: durationMs,
    product_image_url: PHOTO,
    aspect_ratio: '9:16',
    hand_gender: 'female',
    setting: 'dressing_table',
    modesty: { arms: 'covered', hijab: false },
    ...over,
  };
}

/** The mux measures its cut a few ms off the audio, as a real cut does. */
const CUT_DRIFT_MS = 17;

function happyFakes(overrides: CannedActivities = {}) {
  return fakeActivities({
    composedSkillState: undefined,
    refundCredits: undefined,
    markPrimitiveRunFailed: undefined,
    releaseDraftRender: undefined,
    fetchDraftAudio: (i: FetchDraftAudioInput) => ({ primitive_run_id: i.primitive_run_id, audio_key: i.audio_key, duration_ms: i.duration_ms }),
    presetStartingFrame: (i: PresetStartingFrameInput) => ({
      primitive_run_id: i.primitive_run_id,
      image_url: frameUrl(i.shot_index),
      credits_actual_usd: 0.25,
    }),
    presetClip: (i: PresetClipInput) => ({
      primitive_run_id: i.primitive_run_id,
      video_url: `https://r2.example.test/clips/${i.shot_index}.mp4`,
      duration_seconds: i.duration,
      credits_actual_usd: i.duration === 10 ? 1.2 : 0.6,
    }),
    presetMux: (i: PresetMuxInput) => ({
      primitive_run_id: i.primitive_run_id,
      video_url: 'https://r2.example.test/shorts/final.mp4',
      duration_ms: i.audio_duration_ms + CUT_DRIFT_MS,
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

describe('makeHandsOnWorkflow — the order of the render', () => {
  it('fetches the draft audio before any visual is requested', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [renderInput(12_000)], fakes);
    const names = fakes.names().filter((n) => n !== 'composedSkillState');
    expect(names[0]).toBe('fetchDraftAudio');
  });

  it('requests every product-in-hands frame before any animation', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [renderInput(12_000)], fakes);
    const names = fakes.names();
    const frames = fakes.callsTo('presetStartingFrame') as PresetStartingFrameInput[];
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ frame: 'product_in_hands', shot_kind: 'hands', product_image_url: PHOTO, preset: 'hands_on' });
    expect(names.lastIndexOf('presetStartingFrame')).toBeLessThan(names.indexOf('presetClip'));
    expect(names.indexOf('fetchDraftAudio')).toBeLessThan(names.indexOf('presetStartingFrame'));
  });

  it('animates each hands shot from its frame, and the product closer from the photo', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [renderInput(12_000)], fakes);
    const clips = fakes.callsTo('presetClip') as PresetClipInput[];
    expect(clips.map((c) => [c.shot_kind, c.duration, c.start_image_url])).toEqual([
      ['hands', 10, frameUrl(0)],
      ['product', 5, PHOTO],
    ]);
  });

  it('ends a ≤10 s Short on the product too: two 5 s clips, hands from its frame then the product, cut to half each', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [renderInput(8_000)], fakes);
    const clips = fakes.callsTo('presetClip') as PresetClipInput[];
    expect(clips.map((c) => [c.shot_kind, c.duration, c.start_image_url])).toEqual([
      ['hands', 5, frameUrl(0)],
      ['product', 5, PHOTO],
    ]);
    const [mux] = fakes.callsTo('presetMux') as PresetMuxInput[];
    expect(mux.shot_ms).toEqual([4_000, 4_000]);
  });

  it('asks for every clip with the video model’s own audio disabled', async () => {
    for (const ms of [5_000, 9_000, 15_000]) {
      const fakes = happyFakes();
      await harness.execute('makeHandsOnWorkflow', [renderInput(ms)], fakes);
      const clips = fakes.callsTo('presetClip') as PresetClipInput[];
      expect(clips.length).toBeGreaterThan(0);
      for (const c of clips) expect(c.generate_audio).toBe(false);
    }
  });

  it('cuts the visuals to the measured audio and reports the measured cut', async () => {
    const fakes = happyFakes({
      // The audio as measured from its bytes differs from the draft's stored length.
      fetchDraftAudio: (i: FetchDraftAudioInput) => ({ primitive_run_id: i.primitive_run_id, audio_key: i.audio_key, duration_ms: 11_960 }),
    });
    const result = await harness.execute('makeHandsOnWorkflow', [renderInput(12_000)], fakes);
    const [mux] = fakes.callsTo('presetMux') as PresetMuxInput[];
    expect(mux.audio_duration_ms).toBe(11_960);
    expect(result.duration_ms).toBe(11_960 + CUT_DRIFT_MS);
  });

  it('ships the draft’s own audio: nothing voices, and the mux uses the draft audio key', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [renderInput(12_000)], fakes);
    const [mux] = fakes.callsTo('presetMux') as PresetMuxInput[];
    expect(mux.audio_key).toBe(AUDIO_KEY);
    expect(mux.preset).toBe('hands_on');
    expect(fakes.names().filter((n) => /voice|tts|speech/i.test(n))).toEqual([]);
  });

  it('charges exactly what the quote sums: each clip plus the hands frame', async () => {
    for (const ms of [5_000, 9_000, 10_000, 10_001, 12_000, 15_000]) {
      const fakes = happyFakes();
      await harness.execute('makeHandsOnWorkflow', [renderInput(ms)], fakes);
      const clips = fakes.callsTo('presetClip') as PresetClipInput[];
      const frames = fakes.callsTo('presetStartingFrame') as PresetStartingFrameInput[];
      const charged =
        clips.reduce((s, c) => s + quotePrimitiveCredits('product_hero_clip', c.duration), 0) +
        frames.reduce((s, f) => s + quotePrimitiveCredits('preset_frame', undefined, f.frame), 0);
      expect(charged).toBe(quotePresetCredits(HANDS_ON, ms));
      expect(quotePrimitiveCredits('preset_frame', undefined, 'product_in_hands')).toBe(STARTING_FRAME_CREDITS.product_in_hands);
    }
  });
});

describe('makeHandsOnWorkflow — prompts', () => {
  it('puts the Modesty Default in every hands prompt, frame and clip, and in no product prompt', async () => {
    for (const arms of ['covered', 'sleeved'] as const) {
      const fakes = happyFakes();
      await harness.execute('makeHandsOnWorkflow', [renderInput(12_000, { modesty: { arms, hijab: false } })], fakes);
      const frames = fakes.callsTo('presetStartingFrame') as PresetStartingFrameInput[];
      const clips = fakes.callsTo('presetClip') as PresetClipInput[];
      // The frame's image-stage Guardrails end it: the Modesty Default, then no text (#28).
      for (const f of frames) expect(f.prompt.endsWith(`${MODESTY_PROMPTS.hands[arms]} ${FORMAT_FRAME}`)).toBe(true);
      for (const c of clips) {
        if (c.shot_kind === 'hands') expect(c.prompt).toContain(`${MODESTY_PROMPTS.hands[arms]} ${FORMAT}`);
        else expect(c.prompt).not.toContain('Modest styling');
      }
    }
  });

  it('uses the Preset’s default arms when no Modesty was resolved', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [renderInput(8_000, { modesty: undefined })], fakes);
    const [frame] = fakes.callsTo('presetStartingFrame') as PresetStartingFrameInput[];
    expect(frame.prompt.endsWith(`${MODESTY_PROMPTS.hands.covered} ${FORMAT_FRAME}`)).toBe(true);
  });

  it('shows the chosen hands in the chosen setting', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [renderInput(12_000, { hand_gender: 'male', setting: 'majlis' })], fakes);
    const [frame] = fakes.callsTo('presetStartingFrame') as PresetStartingFrameInput[];
    const clips = fakes.callsTo('presetClip') as PresetClipInput[];
    for (const p of [frame.prompt, clips[0].prompt]) {
      // The hands words may open a sentence of the clip prompt (the fields compose as sentences).
      expect(p.toLowerCase()).toContain(HAND_WORDS.male.toLowerCase());
      expect(p).toContain(SETTING_WORDS.majlis);
      // No unfilled {placeholder} (the {{…}} reference tokens are the model adapter's to fill).
      expect(p).not.toMatch(/(?<!\{)\{[a-z_]+\}(?!\})/);
    }
    expect(clips[1].prompt).toContain(SETTING_WORDS.majlis);
    expect(clips[1].prompt.toLowerCase()).not.toContain(HAND_WORDS.male.toLowerCase());
  });

  it('never lets a prompt imply speech: every clip says nobody speaks or shows nobody', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [renderInput(12_000)], fakes);
    for (const c of fakes.callsTo('presetClip') as PresetClipInput[]) {
      expect(c.prompt).toMatch(c.shot_kind === 'hands' ? /nobody speaks/ : /No people, no hands/);
    }
    expect(JSON.stringify(HANDS_ON_RENDER.shots)).not.toMatch(/@image/);
  });
});

describe('makeHandsOnWorkflow — refusals before anything is requested', () => {
  it.each([
    ['no hand gender', { hand_gender: undefined }],
    ['no setting', { setting: undefined }],
    ['a setting off the list', { setting: 'spaceship' as never }],
    ['a hand gender off the list', { hand_gender: 'neutral' as never }],
    ['a hijab (no person on screen)', { modesty: { arms: 'covered', hijab: true } as const }],
  ])('refuses %s', async (_what, over) => {
    const fakes = happyFakes();
    await expect(harness.execute('makeHandsOnWorkflow', [renderInput(12_000, over)], fakes)).rejects.toBeInstanceOf(
      WorkflowFailedError,
    );
    expect(fakes.names()).not.toContain('presetStartingFrame');
    expect(fakes.names()).not.toContain('presetClip');
    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    expect(states.at(-1)).toMatchObject({ status: 'failed', error_code: 'INVALID_INPUT' });
    expect(fakes.callsTo('releaseDraftRender')).toEqual([{ skill_run_id: SKILL_RUN_ID, draft_id: 'draft-18' }]);
  });
});

describe('makeHandsOnWorkflow — failure refunds every charged child and releases the draft', () => {
  const failAt: Array<[string, CannedActivities]> = [
    ['the frame', { presetStartingFrame: () => { throw ApplicationFailure.nonRetryable('image refused', 'OPENAI_400'); } }],
    ['the second clip', {
      presetClip: (i: PresetClipInput) => {
        if (i.shot_index === 1) throw ApplicationFailure.nonRetryable('provider refused', 'EVOLINK_400');
        return { primitive_run_id: i.primitive_run_id, video_url: 'https://r2.example.test/c.mp4', duration_seconds: i.duration, credits_actual_usd: 1.2 };
      },
    }],
    ['the mux', { presetMux: () => { throw ApplicationFailure.nonRetryable('ffmpeg exploded', 'MUX_FAILED'); } }],
  ];

  it.each(failAt)('a terminal failure at %s refunds every frame and clip, then gives the draft back', async (_where, overrides) => {
    const fakes = happyFakes(overrides);
    await expect(harness.execute('makeHandsOnWorkflow', [renderInput(12_000)], fakes)).rejects.toBeInstanceOf(
      WorkflowFailedError,
    );

    const refunded = new Set((fakes.callsTo('refundCredits') as Array<{ primitive_run_id: string }>).map((r) => r.primitive_run_id));
    const charged = [
      ...(fakes.callsTo('presetStartingFrame') as PresetStartingFrameInput[]),
      ...(fakes.callsTo('presetClip') as PresetClipInput[]),
    ];
    expect(charged.length).toBeGreaterThan(0);
    for (const c of charged) expect(refunded.has(c.primitive_run_id)).toBe(true);

    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    expect(states.at(-1)).toMatchObject({ status: 'failed' });
    expect(fakes.callsTo('releaseDraftRender')).toEqual([{ skill_run_id: SKILL_RUN_ID, draft_id: 'draft-18' }]);
    const names = fakes.names();
    expect(names.indexOf('releaseDraftRender')).toBeGreaterThan(names.lastIndexOf('refundCredits'));
  });

  it('a failed frame stops the render before any clip is requested', async () => {
    const fakes = happyFakes(failAt[0][1]);
    await expect(harness.execute('makeHandsOnWorkflow', [renderInput(12_000)], fakes)).rejects.toBeInstanceOf(
      WorkflowFailedError,
    );
    expect(fakes.names()).not.toContain('presetClip');
    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    expect(states.at(-1)).toMatchObject({ status: 'failed', error_code: 'OPENAI_400' });
  });
});

// ── #25: Product Interaction in the hands frame and clip, never the product shot ──

describe('makeHandsOnWorkflow — Product Interaction (#25)', () => {
  it.each([
    ['perfume', 'dressing_table', 'removes the cap, sprays once on the inner wrist, brings the wrist to the nose'],
    ['coffee', 'kitchen', 'lifts the cup and takes one slow sip'],
    ['skincare', 'dressing_table', 'squeezes a small amount onto the back of the hand and rubs it in'],
  ] as const)('%s: every hands frame and clip carries it as the action, with the Guardrails after; the product shot does not', async (_p, setting, interaction) => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [renderInput(12_000, { setting, product_interaction: interaction })], fakes);
    const frames = fakes.callsTo('presetStartingFrame') as PresetStartingFrameInput[];
    const clips = fakes.callsTo('presetClip') as PresetClipInput[];
    expect(frames.length).toBeGreaterThan(0);
    for (const prompt of frames.map((f) => f.prompt)) {
      const at = prompt.indexOf(interaction);
      expect(at).toBeGreaterThan(-1);
      // #28: the frame is a Shot Prompt too, its image-stage Guardrails after the action.
      expect(prompt.indexOf(MODESTY_PROMPTS.hands.covered)).toBeGreaterThan(at);
    }
    for (const prompt of clips.filter((c) => c.shot_kind === 'hands').map((c) => c.prompt)) {
      const at = prompt.indexOf(interaction);
      expect(at).toBeGreaterThan(-1);
      expect(prompt.indexOf(MODESTY_PROMPTS.hands.covered)).toBeGreaterThan(at);
    }
    for (const c of clips.filter((c) => c.shot_kind === 'product')) {
      expect(c.prompt).not.toContain(interaction);
      expect(c.prompt).not.toMatch(/How the product is used/);
    }
  });

  it('keeps every Hands-on shot on Seedance', async () => {
    const fakes = happyFakes();
    await harness.execute('makeHandsOnWorkflow', [renderInput(12_000)], fakes);
    for (const c of fakes.callsTo('presetClip') as PresetClipInput[]) expect(c.model).toBe('seedance-2.0');
  });
});
