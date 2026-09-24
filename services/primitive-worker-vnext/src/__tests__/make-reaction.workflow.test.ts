// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// make_reaction (#19), the Reaction Preset on the shared render pipeline, driven
// end to end through the registered workflow in Temporal's test environment
// with every provider faked at the activity boundary. A Voice-over Short, never
// a Talking-head Short: the saved character reacts silently in short shots
// intercut with the product, the last shot is the product, and the approved
// draft's audio is the only voice (ADR 0001).

import { describe, it, expect, expectTypeOf, beforeAll, afterAll } from 'vitest';
import { ApplicationFailure } from '@temporalio/activity';
import { WorkflowFailedError } from '@temporalio/client';
import { REACTION, REACTION_MAX_SHOT_MS, modelClipUsd, quotePresetCredits, shotVideo, type Modesty, type VideoModelId } from '@agentmedia/schema';
import { runFalQueue } from '../client/fal.js';
import { CONTENT_POLICY_REFUSED, NON_RETRYABLE_TYPES } from '../failure-policy.js';
import { VIDEO_MODELS, type FalVideoModel } from '../video-models/index.js';
import { quotePrimitiveCredits } from '../client/credits.js';
import { startWorkflowHarness, fakeActivities, type CannedActivities, type WorkflowHarness } from './support/workflow-harness.js';
import type { MakeReactionWorkflowInput } from '../workflows/make-reaction.js';
import type { FetchDraftAudioInput, PresetClipInput, PresetMuxInput } from '../activities/preset-render.js';
import { MODESTY_PROMPTS } from '../presets/modesty.js';
import { REACTION_RENDER, SILENT_REACTION } from '../presets/reaction.js';
import { NO_PEOPLE, REFERENCE_TOKENS } from '@agentmedia/shot-prompts';
import { presetRender } from '../presets/index.js';
import * as workflows from '../workflows/index.js';

const SKILL_RUN_ID = '19191919-2222-4333-8444-555555555555';
const AUDIO_KEY = 'vnext/drafts/user-1/draft-19.mp3';
const PRODUCT = 'https://r2.example.test/uploads/product.png';
const CHARACTER = 'https://r2.example.test/uploads/character.png';
const CUT_DRIFT_MS = 17;

function renderInput(durationMs: number, over: Partial<MakeReactionWorkflowInput> = {}): MakeReactionWorkflowInput {
  return {
    skill_run_id: SKILL_RUN_ID,
    user_id: 'user-1',
    draft_id: 'draft-19',
    audio_key: AUDIO_KEY,
    duration_ms: durationMs,
    product_image_url: PRODUCT,
    character_image_url: CHARACTER,
    aspect_ratio: '9:16',
    modesty: { arms: 'covered', hijab: true },
    ...over,
  };
}

function happyFakes(overrides: CannedActivities = {}) {
  return fakeActivities({
    composedSkillState: undefined,
    refundCredits: undefined,
    markPrimitiveRunFailed: undefined,
    releaseDraftRender: undefined,
    fetchDraftAudio: (i: FetchDraftAudioInput) => ({ primitive_run_id: i.primitive_run_id, audio_key: i.audio_key, duration_ms: i.duration_ms }),
    presetClip: (i: PresetClipInput) => ({
      primitive_run_id: i.primitive_run_id,
      video_url: `https://r2.example.test/clips/${i.shot_index}.mp4`,
      duration_seconds: i.duration,
      credits_actual_usd: i.duration === 10 ? 1.2 : 0.6,
    }),
    presetMux: (i: PresetMuxInput) => ({
      primitive_run_id: i.primitive_run_id,
      video_url: 'https://r2.example.test/shorts/reaction.mp4',
      duration_ms: i.audio_duration_ms + CUT_DRIFT_MS,
      artifact_id: 'artifact-short',
    }),
    ...overrides,
  });
}

const clipsOf = (f: ReturnType<typeof happyFakes>) => f.callsTo('presetClip') as PresetClipInput[];

let harness: WorkflowHarness;

beforeAll(async () => {
  harness = await startWorkflowHarness();
}, 120_000);

afterAll(async () => {
  await harness?.teardown();
});

describe('makeReactionWorkflow — silent faces intercut with the product', () => {
  it('fetches the draft audio before any visual, then the clips, then the cut', async () => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(12_000)], fakes);
    expect(fakes.names().filter((n) => n !== 'composedSkillState')).toEqual([
      'fetchDraftAudio', 'presetClip', 'presetClip', 'presetClip', 'presetClip', 'presetMux',
    ]);
  });

  it.each([5_000, 8_400, 10_000, 10_001, 15_000])('intercuts reaction and product shots and ends on the product (%i ms)', async (ms) => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(ms)], fakes);
    const kinds = clipsOf(fakes).map((c) => c.shot_kind);
    kinds.forEach((k, i) => expect(k).toBe(i % 2 === 0 ? 'reaction' : 'product'));
    expect(kinds.at(-1)).toBe('product');
    for (const c of clipsOf(fakes)) expect(c.preset).toBe('reaction');
  });

  it('puts the no-speaking instruction and the Modesty Default in every reaction prompt, and neither in a product prompt', async () => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(15_000)], fakes);
    const clips = clipsOf(fakes);
    expect(clips.filter((c) => c.shot_kind === 'reaction')).toHaveLength(2);
    for (const c of clips) {
      if (c.shot_kind === 'reaction') {
        expect(c.prompt).toContain(SILENT_REACTION);
        expect(c.prompt).toContain(MODESTY_PROMPTS.person.covered);
        expect(c.prompt).toContain(MODESTY_PROMPTS.hijab);
      } else {
        expect(c.prompt).toContain(REACTION_RENDER.scenes.product);
        expect(c.prompt).toContain(NO_PEOPLE);
        expect(c.prompt).not.toContain(SILENT_REACTION);
        expect(c.prompt).not.toContain('Modest styling');
      }
    }
  });

  it.each<[string, Modesty]>([
    ['sleeved arms, no hijab', { arms: 'sleeved', hijab: false }],
    ['covered arms, no hijab (a man, or a woman who chose none)', { arms: 'covered', hijab: false }],
  ])('carries the resolved Modesty as given: %s', async (_label, modesty) => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(9_000, { modesty })], fakes);
    const [reaction] = clipsOf(fakes).filter((c) => c.shot_kind === 'reaction');
    expect(reaction.prompt).toContain(MODESTY_PROMPTS.person[modesty.arms]);
    expect(reaction.prompt).not.toContain(MODESTY_PROMPTS.hijab);
    expect(reaction.prompt).toContain(SILENT_REACTION);
  });

  it('asks for every clip with the video model’s own audio disabled', async () => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(14_000)], fakes);
    expect(clipsOf(fakes).length).toBeGreaterThan(0);
    for (const c of clipsOf(fakes)) expect(c.generate_audio).toBe(false);
  });

  it('uses the character reference on reaction shots only; every shot has the product photo', async () => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(13_000)], fakes);
    for (const c of clipsOf(fakes)) {
      expect(c.start_image_url).toBe(PRODUCT);
      if (c.shot_kind === 'reaction') expect(c.character_image_url).toBe(CHARACTER);
      else expect(c.character_image_url).toBeUndefined();
    }
  });

  it.each([5_000, 7_300, 10_000, 12_480, 15_000])(
    'cuts the Short to %i ms of audio, no shot on screen over the maximum, and reports the measured length',
    async (ms) => {
      const fakes = happyFakes();
      const result = await harness.execute('makeReactionWorkflow', [renderInput(ms)], fakes);
      const clips = clipsOf(fakes);
      const [mux] = fakes.callsTo('presetMux') as PresetMuxInput[];
      expect(mux.audio_duration_ms).toBe(ms);
      expect(mux.clip_urls).toHaveLength(clips.length);
      expect(mux.shot_ms).toHaveLength(clips.length);
      expect(mux.shot_ms!.reduce((s, x) => s + x, 0)).toBe(ms);
      mux.shot_ms!.forEach((onScreen, i) => {
        expect(onScreen).toBeLessThanOrEqual(REACTION_MAX_SHOT_MS);
        expect(onScreen).toBeLessThanOrEqual(clips[i].duration * 1000);
      });
      expect(result.duration_ms).toBe(ms + CUT_DRIFT_MS);
    },
  );

  it('reuses the draft audio: no voicing step, and the cut muxes the draft’s own audio key', async () => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(9_000)], fakes);
    const allowed = new Set(['composedSkillState', 'fetchDraftAudio', 'presetClip', 'presetMux']);
    for (const name of fakes.names()) expect(allowed.has(name)).toBe(true);
    expect((fakes.callsTo('fetchDraftAudio') as FetchDraftAudioInput[])[0].audio_key).toBe(AUDIO_KEY);
    expect((fakes.callsTo('presetMux') as PresetMuxInput[])[0].audio_key).toBe(AUDIO_KEY);
  });
});

describe('makeReactionWorkflow — refusals before anything is requested', () => {
  it.each<[string, Partial<MakeReactionWorkflowInput>]>([
    ['no character reference', { character_image_url: undefined }],
    ['a blank character reference', { character_image_url: '  ' }],
    ['no resolved Modesty (the hijab depends on it)', { modesty: null }],
    ['arms less modest than the Preset allows', { modesty: { arms: 'bare', hijab: false } as unknown as Modesty }],
  ])('refuses %s', async (_label, over) => {
    const fakes = happyFakes();
    await expect(harness.execute('makeReactionWorkflow', [renderInput(9_000, over)], fakes)).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(fakes.names()).not.toContain('fetchDraftAudio');
    expect(fakes.names()).not.toContain('presetClip');
    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    expect(states.at(-1)).toMatchObject({ status: 'failed', error_code: 'INVALID_INPUT' });
    expect(fakes.callsTo('releaseDraftRender')).toEqual([{ skill_run_id: SKILL_RUN_ID, draft_id: 'draft-19' }]);
  });
});

describe('makeReactionWorkflow — a failure refunds every charged child and releases the draft', () => {
  const failAt: Array<[string, CannedActivities]> = [
    ['the audio fetch', { fetchDraftAudio: () => { throw ApplicationFailure.nonRetryable('no such object', 'DRAFT_AUDIO_MISSING'); } }],
    ['the third clip', {
      presetClip: (i: PresetClipInput) => {
        if (i.shot_index === 2) throw ApplicationFailure.nonRetryable('provider 400', 'EVOLINK_400');
        return { primitive_run_id: i.primitive_run_id, video_url: 'https://r2.example.test/c.mp4', duration_seconds: i.duration, credits_actual_usd: 0.6 };
      },
    }],
    ['a moderation verdict on a reaction shot', {
      presetClip: () => {
        throw ApplicationFailure.create({ message: 'blocked by content moderation', type: 'EVOLINK_CONTENT_POLICY_VIOLATION', nonRetryable: false });
      },
    }],
    ['the mux', { presetMux: () => { throw ApplicationFailure.nonRetryable('ffmpeg exploded', 'MUX_FAILED'); } }],
  ];

  it.each(failAt)('at %s', async (_where, overrides) => {
    const fakes = happyFakes(overrides);
    await expect(harness.execute('makeReactionWorkflow', [renderInput(12_000)], fakes)).rejects.toBeInstanceOf(WorkflowFailedError);

    const refunded = new Set((fakes.callsTo('refundCredits') as Array<{ primitive_run_id: string }>).map((r) => r.primitive_run_id));
    for (const clip of clipsOf(fakes)) expect(refunded.has(clip.primitive_run_id)).toBe(true);
    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    expect(states.at(-1)).toMatchObject({ status: 'failed' });
    expect(states.some((s) => s.status === 'succeeded')).toBe(false);

    expect(fakes.callsTo('releaseDraftRender')).toEqual([{ skill_run_id: SKILL_RUN_ID, draft_id: 'draft-19' }]);
    const names = fakes.names();
    expect(names.indexOf('releaseDraftRender')).toBeGreaterThan(names.lastIndexOf('refundCredits'));
  });

  it('keeps the draft claimed when the render succeeds', async () => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(9_000)], fakes);
    expect(fakes.names()).not.toContain('releaseDraftRender');
    expect(fakes.names()).not.toContain('refundCredits');
  });
});

describe('make_reaction registration', () => {
  it('is a registered workflow type that takes no prompts and no Preset definition', () => {
    expect(Object.keys(workflows)).toContain('makeReactionWorkflow');
    expectTypeOf<MakeReactionWorkflowInput>().not.toHaveProperty('preset');
    expectTypeOf<MakeReactionWorkflowInput>().not.toHaveProperty('shotPrompts');
    expectTypeOf<MakeReactionWorkflowInput>().not.toHaveProperty('prompt');
  });

  it('resolves the Reaction render definition server-side by id', () => {
    expect(presetRender('reaction')).toBe(REACTION_RENDER);
  });

  it('asks for a closed mouth on every reaction shot and shows nobody on a product shot', async () => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(9_000)], fakes);
    const [reaction, product] = clipsOf(fakes);
    expect(reaction.prompt).toContain(SILENT_REACTION);
    expect(reaction.prompt).toContain(REFERENCE_TOKENS.person);
    expect(product.prompt).not.toContain(REFERENCE_TOKENS.person);
    expect(product.prompt).toMatch(/No people/);
  });
});

// ── #25: person shots on Kling O3 Pro (Veo 3.1 fallback), product shots on Seedance ──

const refusedBy = (model: string) =>
  ApplicationFailure.nonRetryable(`fal ${model} refused: likenesses of real people`, CONTENT_POLICY_REFUSED);

describe('makeReactionWorkflow — the video model per shot kind (#25)', () => {
  it('renders person shots on Kling O3 Pro and product shots on Seedance', async () => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(12_000)], fakes);
    const clips = clipsOf(fakes);
    expect(clips).toHaveLength(4);
    for (const c of clips) expect(c.model).toBe(c.shot_kind === 'reaction' ? 'kling-o3-pro' : 'seedance-2.0');
  });

  it('falls back to Veo 3.1 when Kling refuses: the refused attempt is refunded and recorded, the Short still renders', async () => {
    const fakes = happyFakes({
      presetClip: (i: PresetClipInput) => {
        if (i.model === 'kling-o3-pro') throw refusedBy('kling');
        return { primitive_run_id: i.primitive_run_id, video_url: `https://r2.example.test/clips/${i.shot_index}-${i.model}.mp4`, duration_seconds: i.duration, credits_actual_usd: 0.6 };
      },
    });
    const result = await harness.execute('makeReactionWorkflow', [renderInput(12_000)], fakes);
    expect(result.video_url).toBe('https://r2.example.test/shorts/reaction.mp4');

    const clips = clipsOf(fakes);
    const tried = clips.map((c) => `${c.shot_index}:${c.model}`);
    expect(tried).toEqual(['0:kling-o3-pro', '0:veo-3.1', '1:seedance-2.0', '2:kling-o3-pro', '2:veo-3.1', '3:seedance-2.0']);
    // Each attempt is its own charged child: the fallback never reuses the refused one's id.
    expect(new Set(clips.map((c) => c.primitive_run_id)).size).toBe(clips.length);

    const refused = clips.filter((c) => c.model === 'kling-o3-pro').map((c) => c.primitive_run_id);
    const refunded = (fakes.callsTo('refundCredits') as Array<{ primitive_run_id: string }>).map((r) => r.primitive_run_id);
    expect(refunded.sort()).toEqual([...refused].sort());
    const marked = fakes.callsTo('markPrimitiveRunFailed') as Array<{ primitive_run_id: string; error_code: string }>;
    expect(marked.map((m) => m.primitive_run_id).sort()).toEqual([...refused].sort());
    for (const m of marked) expect(m.error_code).toBe(CONTENT_POLICY_REFUSED);

    // The cut uses the fallback's clip, trimmed to the planned share (Veo renders 8 s).
    const [mux] = fakes.callsTo('presetMux') as PresetMuxInput[];
    expect(mux.clip_urls[0]).toContain('0-veo-3.1');
    expect(mux.shot_ms!.every((ms) => ms <= REACTION_MAX_SHOT_MS)).toBe(true);
    expect(fakes.names()).not.toContain('releaseDraftRender');
  });

  it('falls back on an ordinary provider failure too, not only a refusal', async () => {
    const fakes = happyFakes({
      presetClip: (i: PresetClipInput) => {
        if (i.model === 'kling-o3-pro') throw ApplicationFailure.nonRetryable('fal timed out', 'FAL_TIMEOUT');
        return { primitive_run_id: i.primitive_run_id, video_url: 'https://r2.example.test/c.mp4', duration_seconds: i.duration, credits_actual_usd: 0.6 };
      },
    });
    await harness.execute('makeReactionWorkflow', [renderInput(8_000)], fakes);
    expect(clipsOf(fakes).map((c) => c.model)).toEqual(['kling-o3-pro', 'veo-3.1', 'seedance-2.0']);
  });

  it('never falls back on a failure the fallback cannot fix (no credits)', async () => {
    const fakes = happyFakes({
      presetClip: () => {
        throw ApplicationFailure.nonRetryable('insufficient credits', 'INSUFFICIENT_CREDITS');
      },
    });
    await expect(harness.execute('makeReactionWorkflow', [renderInput(8_000)], fakes)).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(clipsOf(fakes).map((c) => c.model)).toEqual(['kling-o3-pro']);
  });

  it('both refusing is the non-retryable content-policy failure: every attempt refunded, the draft released', async () => {
    const fakes = happyFakes({
      presetClip: (i: PresetClipInput) => {
        if (i.shot_kind === 'reaction') throw refusedBy(i.model!);
        return { primitive_run_id: i.primitive_run_id, video_url: 'https://r2.example.test/c.mp4', duration_seconds: i.duration, credits_actual_usd: 0.6 };
      },
    });
    const err = await harness.execute('makeReactionWorkflow', [renderInput(12_000)], fakes).catch((e) => e);
    expect(err).toBeInstanceOf(WorkflowFailedError);

    const clips = clipsOf(fakes);
    expect(clips.map((c) => c.model)).toEqual(['kling-o3-pro', 'veo-3.1']);
    const refunded = new Set((fakes.callsTo('refundCredits') as Array<{ primitive_run_id: string }>).map((r) => r.primitive_run_id));
    for (const c of clips) expect(refunded.has(c.primitive_run_id)).toBe(true);

    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    expect(states.at(-1)).toMatchObject({ status: 'failed', error_code: CONTENT_POLICY_REFUSED });
    expect(NON_RETRYABLE_TYPES).toContain(CONTENT_POLICY_REFUSED);
    expect(fakes.callsTo('releaseDraftRender')).toEqual([{ skill_run_id: SKILL_RUN_ID, draft_id: 'draft-19' }]);
    const names = fakes.names();
    expect(names.indexOf('releaseDraftRender')).toBeGreaterThan(names.lastIndexOf('refundCredits'));
  });

  it('asks every model — Kling, Veo and Seedance — for a clip with its own audio disabled', async () => {
    const fakes = happyFakes({
      presetClip: (i: PresetClipInput) => {
        if (i.model === 'kling-o3-pro' && i.shot_index === 0) throw refusedBy('kling');
        return { primitive_run_id: i.primitive_run_id, video_url: 'https://r2.example.test/c.mp4', duration_seconds: i.duration, credits_actual_usd: 0.6 };
      },
    });
    await harness.execute('makeReactionWorkflow', [renderInput(12_000)], fakes);
    const clips = clipsOf(fakes);
    expect(new Set(clips.map((c) => c.model))).toEqual(new Set(['kling-o3-pro', 'veo-3.1', 'seedance-2.0']));
    for (const c of clips) expect(c.generate_audio).toBe(false);
  });

  it.each([5_000, 7_400, 10_000, 10_001, 12_345, 15_000])(
    'charges exactly the quote at %i ms, whether or not the fallback ran',
    async (ms) => {
      for (const refuse of [false, true]) {
        const fakes = happyFakes({
          presetClip: (i: PresetClipInput) => {
            if (refuse && i.model === 'kling-o3-pro') throw refusedBy('kling');
            return { primitive_run_id: i.primitive_run_id, video_url: 'https://r2.example.test/c.mp4', duration_seconds: i.duration, credits_actual_usd: 0.6 };
          },
        });
        await harness.execute('makeReactionWorkflow', [renderInput(ms)], fakes);
        const refunded = new Set((fakes.callsTo('refundCredits') as Array<{ primitive_run_id: string }>).map((r) => r.primitive_run_id));
        // What stays charged: every attempt that was not refunded, at its shot's price.
        const charged = clipsOf(fakes)
          .filter((c) => !refunded.has(c.primitive_run_id))
          .reduce((s, c) => s + quotePrimitiveCredits('product_hero_clip', c.duration, undefined, shotVideo(REACTION, c.shot_kind)), 0);
        expect(charged).toBe(quotePresetCredits(REACTION, ms));
      }
    },
  );
});

// ── #25: no Temporal retry of a fal job; one failure policy for fallbacks ──

/**
 * presetClip, with its fal models run through the REAL fal client against a
 * fake fal queue: the job ends as `outcome[model]`. Records each submit, so a
 * Temporal retry of the clip (which would submit and pay again) shows up.
 */
function falQueueClips(outcome: Partial<Record<string, 'completed' | 'failed'>>) {
  const submits: string[] = [];
  const presetClip = async (i: PresetClipInput) => {
    const made = { primitive_run_id: i.primitive_run_id, video_url: `https://r2.example.test/clips/${i.shot_index}-${i.model}.mp4`, duration_seconds: i.duration, credits_actual_usd: 0.6 };
    if (i.model === 'seedance-2.0') return made;
    const model = VIDEO_MODELS[i.model as 'kling-o3-pro' | 'veo-3.1'] as FalVideoModel;
    const { endpoint, input } = model.buildRequest({ prompt: i.prompt, startImageUrl: i.start_image_url, seconds: i.duration, generateAudio: false });
    const base = `https://queue.fal.run/${endpoint}/requests/${i.primitive_run_id}`;
    const fetch = (async (url: string, init: RequestInit = {}) => {
      if (init.method === 'POST') {
        submits.push(`${i.shot_index}:${i.model}`);
        return new Response(JSON.stringify({ request_id: i.primitive_run_id, status_url: `${base}/status`, response_url: base }));
      }
      if (url.endsWith('/status')) {
        return new Response(JSON.stringify(outcome[i.model!] === 'completed' ? { status: 'COMPLETED' } : { status: 'FAILED', error: 'worker crashed' }));
      }
      return new Response(JSON.stringify({ video: { url: 'https://v3.fal.media/files/out.mp4' } }));
    }) as unknown as typeof globalThis.fetch;
    await runFalQueue({ apiKey: 'k', endpoint, input, deps: { fetch, sleep: async () => {}, now: () => 0 } });
    return made;
  };
  return { submits, presetClip };
}

describe('makeReactionWorkflow — a failed fal job is never resubmitted (#25)', () => {
  it('a failed Kling job is submitted exactly once, then the shot falls back to Veo (submitted once)', async () => {
    const fal = falQueueClips({ 'kling-o3-pro': 'failed', 'veo-3.1': 'completed' });
    const fakes = happyFakes({ presetClip: fal.presetClip });
    await harness.execute('makeReactionWorkflow', [renderInput(12_000)], fakes);
    expect(fal.submits).toEqual(['0:kling-o3-pro', '0:veo-3.1', '2:kling-o3-pro', '2:veo-3.1']);
    const marked = fakes.callsTo('markPrimitiveRunFailed') as Array<{ error_code: string }>;
    expect(marked.map((m) => m.error_code)).toEqual(['FAL_FAILED', 'FAL_FAILED']);
  });

  it('both failing: one submit per model, then the render fails, refunded and released', async () => {
    const fal = falQueueClips({ 'kling-o3-pro': 'failed', 'veo-3.1': 'failed' });
    const fakes = happyFakes({ presetClip: fal.presetClip });
    await expect(harness.execute('makeReactionWorkflow', [renderInput(12_000)], fakes)).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(fal.submits).toEqual(['0:kling-o3-pro', '0:veo-3.1']);
    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    expect(states.at(-1)).toMatchObject({ status: 'failed', error_code: 'FAL_FAILED' });
    expect(fakes.callsTo('releaseDraftRender')).toHaveLength(1);
  });
});

describe('makeReactionWorkflow — the failure policy decides the fallback (#25)', () => {
  it('a missing FAL_KEY fails fast with PROVIDER_UNCONFIGURED: no fallback that would fail the same way', async () => {
    const fakes = happyFakes({
      presetClip: () => {
        throw ApplicationFailure.nonRetryable('FAL_KEY not configured on primitive-worker-vnext', 'PROVIDER_UNCONFIGURED');
      },
    });
    await expect(harness.execute('makeReactionWorkflow', [renderInput(8_000)], fakes)).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(clipsOf(fakes).map((c) => c.model)).toEqual(['kling-o3-pro']);
    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    expect(states.at(-1)).toMatchObject({ status: 'failed', error_code: 'PROVIDER_UNCONFIGURED', error_message: expect.stringContaining('FAL_KEY') });
  });

  it.each<[string, () => never]>([
    ['a timeout', () => { throw ApplicationFailure.nonRetryable('fal timed out', 'FAL_TIMEOUT'); }],
    ['a failed job', () => { throw ApplicationFailure.nonRetryable('worker crashed', 'FAL_FAILED'); }],
    ['no credits left', () => { throw ApplicationFailure.nonRetryable('insufficient credits', 'INSUFFICIENT_CREDITS'); }],
  ])('Kling refused and Veo then failed with %s: the run fails as the content-policy refusal', async (_label, veoFails) => {
    const fakes = happyFakes({
      presetClip: (i: PresetClipInput) => {
        if (i.model === 'kling-o3-pro') throw refusedBy('kling');
        if (i.model === 'veo-3.1') veoFails();
        return { primitive_run_id: i.primitive_run_id, video_url: 'https://r2.example.test/c.mp4', duration_seconds: i.duration, credits_actual_usd: 0.6 };
      },
    });
    await expect(harness.execute('makeReactionWorkflow', [renderInput(8_000)], fakes)).rejects.toBeInstanceOf(WorkflowFailedError);
    const clips = clipsOf(fakes);
    expect(clips.map((c) => c.model)).toEqual(['kling-o3-pro', 'veo-3.1']);
    const states = fakes.callsTo('composedSkillState') as Array<Record<string, unknown>>;
    expect(states.at(-1)).toMatchObject({ status: 'failed', error_code: CONTENT_POLICY_REFUSED });
    // Each attempt keeps its own failure on its row, and both are refunded.
    const marked = fakes.callsTo('markPrimitiveRunFailed') as Array<{ primitive_run_id: string; error_code: string }>;
    expect(marked.find((m) => m.primitive_run_id === clips[0].primitive_run_id)?.error_code).toBe(CONTENT_POLICY_REFUSED);
    expect(marked.find((m) => m.primitive_run_id === clips[1].primitive_run_id)?.error_code).not.toBe(CONTENT_POLICY_REFUSED);
    const refunded = new Set((fakes.callsTo('refundCredits') as Array<{ primitive_run_id: string }>).map((r) => r.primitive_run_id));
    for (const c of clips) expect(refunded.has(c.primitive_run_id)).toBe(true);
    expect(fakes.callsTo('releaseDraftRender')).toHaveLength(1);
  });
});

describe('makeReactionWorkflow — provider cost counts every attempt (#25)', () => {
  const costed = (refuseKling: boolean) =>
    happyFakes({
      presetClip: (i: PresetClipInput) => {
        if (refuseKling && i.model === 'kling-o3-pro') throw refusedBy('kling');
        return { primitive_run_id: i.primitive_run_id, video_url: 'https://r2.example.test/c.mp4', duration_seconds: i.duration, credits_actual_usd: modelClipUsd(i.model as VideoModelId, i.duration) };
      },
    });

  it('a shot that fell back costs the failed Kling attempt plus the Veo clip, within the Preset’s budget', async () => {
    const fakes = costed(true);
    const result = await harness.execute('makeReactionWorkflow', [renderInput(15_000)], fakes);
    const worst = 2 * (modelClipUsd('kling-o3-pro', 5) + modelClipUsd('veo-3.1', 5)) + 2 * modelClipUsd('seedance-2.0', 5);
    expect(result.credits_actual_usd).toBeCloseTo(worst, 9);
    expect(result.credits_actual_usd).toBeLessThanOrEqual(REACTION.budget.maxProviderUsd + 1e-9);
    const states = fakes.callsTo('composedSkillState') as Array<{ final_output?: { credits_actual_usd: number } }>;
    expect(states.at(-1)!.final_output!.credits_actual_usd).toBeCloseTo(worst, 9);
  });

  it('without a fallback, each shot costs its own model', async () => {
    const result = await harness.execute('makeReactionWorkflow', [renderInput(15_000)], costed(false));
    expect(result.credits_actual_usd).toBeCloseTo(2 * modelClipUsd('kling-o3-pro', 5) + 2 * modelClipUsd('seedance-2.0', 5), 9);
  });
});

// ── #25: Product Interaction in every person prompt, never a product prompt ──

describe('makeReactionWorkflow — Product Interaction (#25)', () => {
  const EXAMPLES = {
    perfume: 'removes the cap, sprays once on the inner wrist, brings the wrist to the nose, smiles',
    coffee: 'lifts the cup with both hands, takes one slow sip, lowers it and smiles',
    skincare: 'squeezes a small amount onto the back of the hand and gently rubs it in',
  };

  it.each(Object.entries(EXAMPLES))('carries the %s interaction in every reaction scene, with the no-speaking and modesty Guardrails after it', async (_p, interaction) => {
    const fakes = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(12_000, { product_interaction: interaction })], fakes);
    for (const c of clipsOf(fakes)) {
      if (c.shot_kind === 'product') {
        expect(c.prompt).not.toContain(interaction);
        continue;
      }
      const at = c.prompt.indexOf(interaction);
      expect(at).toBeGreaterThan(-1);
      // Never overriding: the no-speaking and modesty Guardrails are there,
      // verbatim, after it — the prompt's last word (#26).
      expect(c.prompt.indexOf(SILENT_REACTION)).toBeGreaterThan(at);
      expect(c.prompt.indexOf(MODESTY_PROMPTS.person.covered)).toBeGreaterThan(at);
      expect(c.prompt.indexOf(MODESTY_PROMPTS.hijab)).toBeGreaterThan(at);
    }
  });

  it('leaves the prompts as they were for a draft with no Product Interaction', async () => {
    const without = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(9_000)], without);
    const withNull = happyFakes();
    await harness.execute('makeReactionWorkflow', [renderInput(9_000, { product_interaction: null })], withNull);
    expect(clipsOf(withNull).map((c) => c.prompt)).toEqual(clipsOf(without).map((c) => c.prompt));
    expect(clipsOf(without)[0].prompt).not.toMatch(/How the product is used/);
  });
});
