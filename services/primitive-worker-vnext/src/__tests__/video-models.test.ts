// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The worker's video model registry (#25): model id → client + request builder.
// Every request keeps the model's own audio off (ADR 0001), is 9:16, and sends
// the product photo first and the person second.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { VIDEO_MODEL_IDS } from '@agentmedia/schema';
import { MODELARK_REFERENCES, VIDEO_MODELS, falPrompt, videoModel, type VideoShotRequest } from '../video-models/index.js';
import { REFERENCE_TOKENS, hasReferenceTokens } from '@agentmedia/shot-prompts';

/** A shot as generate()/buildRequest get it: the prompt already in fal's words (presetClip ran promptFor). */
const SHOT: VideoShotRequest = {
  prompt: 'The person in the second reference image holds the exact product in the first reference image and smiles.',
  startImageUrl: 'https://r2.example.test/product.png',
  characterImageUrl: 'https://r2.example.test/person.png',
  seconds: 5,
  generateAudio: false,
};

describe('the video model registry', () => {
  it('has a client for every model the price table knows, and nothing else', () => {
    expect(Object.keys(VIDEO_MODELS).sort()).toEqual([...VIDEO_MODEL_IDS].sort());
    for (const id of VIDEO_MODEL_IDS) expect(videoModel(id).id).toBe(id);
  });

  it('only fal models build a fal request; Seedance has no endpoint', () => {
    expect('buildRequest' in VIDEO_MODELS['seedance-2.0']).toBe(false);
    expect('endpoint' in VIDEO_MODELS['seedance-2.0']).toBe(false);
  });

  it('refuses a model id it does not know', () => {
    expect(() => videoModel('sora-9' as never)).toThrow(/unknown video model/);
  });
});

describe('fal request builders', () => {
  it('Kling O3 Pro: reference-to-video, product then person, 9:16, the planned length, audio off', () => {
    const req = VIDEO_MODELS['kling-o3-pro'].buildRequest(SHOT);
    expect(req.endpoint).toBe('fal-ai/kling-video/o3/pro/reference-to-video');
    expect(VIDEO_MODELS['kling-o3-pro'].endpoint).toBe(req.endpoint);
    expect(VIDEO_MODELS['kling-o3-pro'].modelName()).toBe(req.endpoint);
    expect(req.input).toEqual({
      prompt: 'The person in the second reference image holds the exact product in the first reference image and smiles.',
      image_urls: [SHOT.startImageUrl, SHOT.characterImageUrl],
      aspect_ratio: '9:16',
      duration: '5',
      generate_audio: false,
    });
    expect(VIDEO_MODELS['kling-o3-pro'].buildRequest({ ...SHOT, seconds: 10 }).input.duration).toBe('10');
  });

  it('Veo 3.1: reference-to-video, 720p, 8 s (the cut trims it to the shot), audio off', () => {
    const req = VIDEO_MODELS['veo-3.1'].buildRequest(SHOT);
    expect(req.endpoint).toBe('fal-ai/veo3.1/reference-to-video');
    expect(VIDEO_MODELS['veo-3.1'].endpoint).toBe(req.endpoint);
    expect(req.input).toEqual({
      prompt: 'The person in the second reference image holds the exact product in the first reference image and smiles.',
      image_urls: [SHOT.startImageUrl, SHOT.characterImageUrl],
      aspect_ratio: '9:16',
      resolution: '720p',
      duration: '8s',
      generate_audio: false,
    });
  });

  it('Veo 3.1 cannot render a 10 s shot', () => {
    expect(() => VIDEO_MODELS['veo-3.1'].buildRequest({ ...SHOT, seconds: 10 })).toThrow();
  });

  it('a shot without a person sends the product photo alone', () => {
    const req = VIDEO_MODELS['kling-o3-pro'].buildRequest({ ...SHOT, characterImageUrl: undefined });
    expect(req.input.image_urls).toEqual([SHOT.startImageUrl]);
  });

  it('every fal request has the model’s own audio off, whatever it is asked', () => {
    for (const id of ['kling-o3-pro', 'veo-3.1'] as const) {
      expect(VIDEO_MODELS[id].buildRequest(SHOT).input.generate_audio).toBe(false);
    }
  });
});

describe('falPrompt', () => {
  it('names the references in words (no @image syntax on fal), even an EvoLink prompt from before #26 (a retried clip of an old render)', () => {
    expect(falPrompt('exact product in @image1; the person in @image2; @image1 again')).toBe(
      'exact product in the first reference image; the person in the second reference image; the first reference image again',
    );
  });
});

describe('each adapter puts in its own reference syntax (#26)', () => {
  const TOKENS = `The person is exactly the person in ${REFERENCE_TOKENS.person}. The product is exactly the product in ${REFERENCE_TOKENS.start}.`;

  it('EvoLink (Seedance): @image1 is the start image, @image2 the person', () => {
    expect(VIDEO_MODELS['seedance-2.0'].promptFor(TOKENS)).toBe(
      'The person is exactly the person in @image2. The product is exactly the product in @image1.',
    );
  });

  it('fal: the first / second reference image, in the prompt it sends', () => {
    for (const id of ['kling-o3-pro', 'veo-3.1'] as const) {
      const words = 'The person is exactly the person in the second reference image. The product is exactly the product in the first reference image.';
      expect(VIDEO_MODELS[id].promptFor(TOKENS)).toBe(words);
      // The request sends the prompt as presetClip gave it, converted once (no second withReferences).
      expect(VIDEO_MODELS[id].buildRequest({ ...SHOT, prompt: VIDEO_MODELS[id].promptFor(TOKENS) }).input.prompt).toBe(words);
    }
  });

  it('is idempotent: a prompt already in a model’s syntax is sent as is', () => {
    for (const id of VIDEO_MODEL_IDS) {
      const once = videoModel(id).promptFor(TOKENS);
      expect(videoModel(id).promptFor(once)).toBe(once);
      expect(hasReferenceTokens(once)).toBe(false);
    }
  });
});

describe('ModelArk Seedance 2.0 Mini (#29, ADR 0003)', () => {
  const ark = VIDEO_MODELS['modelark-seedance-2.0-mini'];
  const TOKENS = `The product is exactly the product in ${REFERENCE_TOKENS.start}. The person is a woman.`;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('names the references as ModelArk documents them: "image 1", "image 2" in content order', () => {
    expect(MODELARK_REFERENCES).toEqual({ start: 'image 1', person: 'image 2' });
    expect(ark.promptFor(TOKENS)).toBe('The product is exactly the product in image 1. The person is a woman.');
    expect(ark.promptFor(`the person in ${REFERENCE_TOKENS.person}`)).toBe('the person in image 2');
  });

  it('is the activated model id, and never resubmitted by a Temporal retry (the fallback is its retry)', () => {
    expect(ark.modelName()).toBe('dreamina-seedance-2-0-mini-260615');
    expect(ark.provider).toBe('byteplus-modelark');
    expect(ark.resubmitOnRetry).toBe(false);
  });

  it('reference-to-video: the product as image 1, 9:16, 5 s, audio off, no watermark', () => {
    const body = ark.buildRequest({ prompt: ark.promptFor(TOKENS), startImageUrl: SHOT.startImageUrl, seconds: 5, generateAudio: false });
    expect(body).toEqual({
      model: 'dreamina-seedance-2-0-mini-260615',
      content: [
        { type: 'text', text: 'The product is exactly the product in image 1. The person is a woman.' },
        { type: 'image_url', image_url: { url: SHOT.startImageUrl }, role: 'reference_image' },
      ],
      generate_audio: false,
      ratio: '9:16',
      duration: 5,
      watermark: false,
    });
  });

  it('a trusted person image (a ModelArk output, #33) goes as image 2', () => {
    const body = ark.buildRequest({ ...SHOT, characterImageUrl: 'https://ark-out.tos-ap-southeast-1.bytepluses.com/persona.png' });
    expect(body.content.slice(1).map((c) => [c.image_url?.url, c.role])).toEqual([
      [SHOT.startImageUrl, 'reference_image'],
      ['https://ark-out.tos-ap-southeast-1.bytepluses.com/persona.png', 'reference_image'],
    ]);
  });

  it('image-to-video: a shot animated from its own starting frame sends it as the first_frame', () => {
    const body = ark.buildRequest({ prompt: 'p', startImageUrl: 'https://r2.example.test/frame.png', startImageIsFrame: true, seconds: 10, generateAudio: false });
    expect(body.content).toEqual([
      { type: 'text', text: 'p' },
      { type: 'image_url', image_url: { url: 'https://r2.example.test/frame.png' }, role: 'first_frame' },
    ]);
    expect(body.duration).toBe(10);
  });

  it('fails fast without ARK_API_KEY (PROVIDER_UNCONFIGURED), before any request', async () => {
    vi.stubEnv('ARK_API_KEY', '');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(ark.generate({ ...SHOT, characterImageUrl: undefined })).rejects.toMatchObject({ type: 'PROVIDER_UNCONFIGURED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('generates through ModelArk with ARK_API_KEY and returns the task’s video', async () => {
    vi.stubEnv('ARK_API_KEY', 'ark-test');
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'cgt-9' }));
      return new Response(JSON.stringify({ status: 'succeeded', content: { video_url: 'https://x.tos-ap-southeast-1.bytepluses.com/v.mp4' } }));
    });
    const out = await ark.generate({ ...SHOT, characterImageUrl: undefined });
    expect(out).toEqual({ videoUrl: 'https://x.tos-ap-southeast-1.bytepluses.com/v.mp4', taskId: 'cgt-9' });
    expect(calls[0].url).toMatch(/\/contents\/generations\/tasks$/);
    expect((calls[0].init!.headers as Record<string, string>).Authorization).toBe('Bearer ark-test');
    expect(JSON.parse(String(calls[0].init!.body))).toMatchObject({ generate_audio: false, model: 'dreamina-seedance-2-0-mini-260615' });
  });
});
