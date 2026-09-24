// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The worker's video model registry (#25): model id → client + request builder.
// Every request keeps the model's own audio off (ADR 0001), is 9:16, and sends
// the product photo first and the person second.

import { describe, it, expect } from 'vitest';
import { VIDEO_MODEL_IDS } from '@agentmedia/schema';
import { VIDEO_MODELS, falPrompt, videoModel, type VideoShotRequest } from '../video-models/index.js';
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
