// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Video model per shot kind (#25) — a Preset's shot kind names the model its
 * clips render on (and a fallback), as data. The quote prices every planned
 * shot from the per-model price table: a shot is priced at the most any model
 * in its chain (model, then fallback) costs for its clip length, and the worker
 * charges exactly that whichever model ran — so the quote is the charge across
 * mixed models, fallback or not.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SHOT_VIDEO,
  VIDEO_MODEL_IDS,
  VIDEO_MODEL_PRICES,
  shotClipCredits,
  modelClipUsd,
  shotClipUsd,
  shotModelChain,
  modelRenderSeconds,
} from '../video-models.js';
import { VIDEO_CLIP_CREDITS, VIDEO_CLIP_USD } from '../video-pricing.js';
import { planPresetShots, presetProviderUsd, quotePresetCredits, shotVideo, type PresetDefinition } from '../preset-definition.js';
import { PRESETS } from '../preset-registry.js';
import { REACTION } from '../presets/reaction.js';
import { HANDS_ON } from '../presets/hands-on.js';
import { PRODUCT_HERO } from '../product-hero.js';
import { STANDARD_MODESTY } from '../modesty.js';

const DURATIONS = [5_000, 5_001, 7_400, 9_999, 10_000, 10_001, 12_345, 13_750, 14_999, 15_000];

describe('the per-model price table', () => {
  it('knows Seedance (EvoLink), Kling O3 Pro and Veo 3.1', () => {
    expect([...VIDEO_MODEL_IDS].sort()).toEqual(['kling-o3-pro', 'seedance-2.0', 'veo-3.1']);
  });

  it('prices Seedance exactly as the shared clip table (every Preset without a model is unchanged)', () => {
    expect(DEFAULT_SHOT_VIDEO).toEqual({ model: 'seedance-2.0' });
    expect(VIDEO_MODEL_PRICES['seedance-2.0'].credits).toEqual({ 5: VIDEO_CLIP_CREDITS[5], 10: VIDEO_CLIP_CREDITS[10] });
    expect(VIDEO_MODEL_PRICES['seedance-2.0'].usd).toEqual({ 5: VIDEO_CLIP_USD[5], 10: VIDEO_CLIP_USD[10] });
  });

  it('keeps credits duration-based and model-independent (ARCHITECTURE.md): every model charges the tier', () => {
    for (const id of VIDEO_MODEL_IDS) {
      for (const [secs, credits] of Object.entries(VIDEO_MODEL_PRICES[id].credits)) {
        expect(credits).toBe(VIDEO_CLIP_CREDITS[Number(secs) as 5 | 10]);
      }
    }
  });

  it('costs fal’s published per-second price, audio off, for the seconds each model really renders', () => {
    // Kling O3 Pro reference-to-video: $0.112/s audio off.
    expect(VIDEO_MODEL_PRICES['kling-o3-pro'].usd[5]).toBeCloseTo(5 * 0.112, 9);
    expect(VIDEO_MODEL_PRICES['kling-o3-pro'].usd[10]).toBeCloseTo(10 * 0.112, 9);
    // Veo 3.1 reference-to-video renders 8 s only ($0.20/s at 720p, audio off); the cut trims it.
    expect(modelRenderSeconds('veo-3.1', 5)).toBe(8);
    expect(VIDEO_MODEL_PRICES['veo-3.1'].usd[5]).toBeCloseTo(8 * 0.2, 9);
    expect(VIDEO_MODEL_PRICES['veo-3.1'].usd[10]).toBeUndefined();
  });

  it('never charges less than it costs us', () => {
    // 68 credits per USD of revenue (video-pricing.ts).
    for (const id of VIDEO_MODEL_IDS) {
      const p = VIDEO_MODEL_PRICES[id];
      for (const secs of [5, 10] as const) {
        if (p.credits[secs] === undefined) continue;
        expect(p.credits[secs]! / 68).toBeGreaterThan(p.usd[secs]!);
      }
    }
  });
});

describe('a shot kind’s model chain', () => {
  it('is the model then its fallback; Seedance when the kind names none', () => {
    expect(shotModelChain(undefined)).toEqual(['seedance-2.0']);
    expect(shotModelChain({ model: 'kling-o3-pro', fallback: 'veo-3.1' })).toEqual(['kling-o3-pro', 'veo-3.1']);
  });

  it('charges a shot the most any model in its chain charges, so the fallback never changes the charge', () => {
    const chain = { model: 'kling-o3-pro', fallback: 'veo-3.1' } as const;
    expect(shotClipCredits(chain, 5)).toBe(Math.max(VIDEO_MODEL_PRICES['kling-o3-pro'].credits[5]!, VIDEO_MODEL_PRICES['veo-3.1'].credits[5]!));
  });

  it('costs a shot its worst case: a failed primary attempt AND the fallback that rendered it', () => {
    const chain = { model: 'kling-o3-pro', fallback: 'veo-3.1' } as const;
    expect(modelClipUsd('kling-o3-pro', 5)).toBeCloseTo(0.56, 9);
    expect(modelClipUsd('veo-3.1', 5)).toBeCloseTo(1.6, 9);
    expect(shotClipUsd(chain, 5)).toBeCloseTo(0.56 + 1.6, 9);
    expect(shotClipUsd(undefined, 5)).toBeCloseTo(VIDEO_CLIP_USD[5], 9);
    expect(() => modelClipUsd('veo-3.1', 10)).toThrow(RangeError);
  });

  it('refuses a clip length a model in the chain cannot render', () => {
    expect(() => shotClipCredits({ model: 'kling-o3-pro', fallback: 'veo-3.1' }, 10)).toThrow(RangeError);
  });
});

describe('Reaction’s person shots render on Kling O3 Pro, falling back to Veo 3.1', () => {
  it('budgets the provider cost for the worst case: both person shots failing on Kling and rendering on Veo', () => {
    // Two person shots (Kling $0.56 then Veo $1.60 each) and two product clips ($0.60 each).
    expect(REACTION.budget.maxProviderUsd).toBeCloseTo(2 * (0.56 + 1.6) + 2 * VIDEO_CLIP_USD[5], 9);
    expect(presetProviderUsd(REACTION, 15_000)).toBeCloseTo(REACTION.budget.maxProviderUsd, 9);
  });

  it('declares it as data on the shot kind; product shots keep the default', () => {
    expect(shotVideo(REACTION, 'reaction')).toEqual({ model: 'kling-o3-pro', fallback: 'veo-3.1' });
    expect(shotVideo(REACTION, 'product')).toEqual(DEFAULT_SHOT_VIDEO);
  });

  it('leaves every Product Hero and Hands-on shot on Seedance', () => {
    for (const kind of Object.keys(PRODUCT_HERO.shotKinds)) expect(shotVideo(PRODUCT_HERO, kind)).toEqual(DEFAULT_SHOT_VIDEO);
    for (const kind of Object.keys(HANDS_ON.shotKinds)) expect(shotVideo(HANDS_ON, kind)).toEqual(DEFAULT_SHOT_VIDEO);
  });
});

describe.each(Object.values(PRESETS) as PresetDefinition[])('$name: quote == charge across mixed models', (preset) => {
  it.each(DURATIONS)('%i ms: every planned shot has a price on every model of its chain, summed into the quote', (ms) => {
    const shots = planPresetShots(preset, ms);
    const charged = shots.reduce((s, shot) => {
      const chain = shotVideo(preset, shot.kind);
      // Whichever model runs (the model, or the fallback after a refusal), the shot charges this.
      for (const m of shotModelChain(chain)) expect(VIDEO_MODEL_PRICES[m].credits[shot.seconds]).toBeDefined();
      return s + shotClipCredits(chain, shot.seconds);
    }, 0);
    const frames = quotePresetCredits(preset, ms) - charged;
    expect(frames).toBeGreaterThanOrEqual(0);
    expect(quotePresetCredits(preset, ms)).toBeLessThanOrEqual(preset.budget.maxCredits);
    expect(presetProviderUsd(preset, ms)).toBeLessThanOrEqual(preset.budget.maxProviderUsd + 1e-9);
  });

  it('a model that renders longer than its planned clip only runs where the cut trims each shot', () => {
    for (const ms of DURATIONS) {
      for (const shot of planPresetShots(preset, ms)) {
        for (const m of shotModelChain(shotVideo(preset, shot.kind))) {
          if (modelRenderSeconds(m, shot.seconds) > shot.seconds) expect(shot.onScreenMs).toBeDefined();
        }
      }
    }
  });
});

describe('the quote reads the chain', () => {
  it('prices a test Preset whose person shots name a model from that model’s table', () => {
    const MIXED: PresetDefinition<'person' | 'product'> = {
      id: 'test_mixed',
      name: 'Test Mixed',
      aspectRatio: '9:16',
      minSpeechMs: 5_000,
      maxSpeechMs: 15_000,
      shotKinds: { person: { shows: 'person', video: { model: 'kling-o3-pro' } }, product: { shows: 'product' } },
      shotPlan: { order: ['person', 'product'], last: 'product', maxShotMs: 5_000 },
      requiredInputs: ['product_image'],
      musicBed: [],
      modesty: STANDARD_MODESTY,
      budget: { maxCredits: 560, maxProviderUsd: 2.4 },
    };
    expect(presetProviderUsd(MIXED, 12_000)).toBeCloseTo(2 * VIDEO_MODEL_PRICES['kling-o3-pro'].usd[5]! + 2 * VIDEO_CLIP_USD[5], 9);
    expect(quotePresetCredits(MIXED, 12_000)).toBe(4 * VIDEO_CLIP_CREDITS[5]);
  });
});
