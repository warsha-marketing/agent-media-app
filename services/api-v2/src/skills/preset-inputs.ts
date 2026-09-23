// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Preset-specific render inputs (#19): what a Preset needs beyond the approved
 * draft and the product photo (Reaction: a saved character and the Modesty
 * Default), resolved at the route by the Preset's skill.
 *
 * The quote and the run both call the SAME resolver, so a quote refuses exactly
 * what the run would refuse (someone else's character, a choice less modest
 * than the Preset allows). Only the run may do work with a side effect
 * (re-hosting the character's reference); the quote only reads.
 *
 * A resolver refuses with a RenderRefusal (status + code); a re-host blocked by
 * moderation throws the ModerationError the route already answers.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PresetDefinition } from '@agentmedia/schema';
import type { RenderableDraft } from './product-hero-render.js';

export interface PresetInputContext {
  userId: string;
  /** The validated skill input (defaults applied). */
  body: Record<string, unknown>;
  /** The draft being rendered, already resolved and gated (owner, band, Voice, Qualified Preset). */
  draft: RenderableDraft;
  preset: PresetDefinition;
  /** 'quote' reads only; 'run' may re-host references for the worker. */
  stage: 'quote' | 'run';
  /** Service-role client: ownership is enforced by the resolver's own filters. */
  db: SupabaseClient;
  /** Re-host (and moderate) an image onto our storage, for the worker's SSRF guard. */
  rehostImage: (userId: string, url: string) => Promise<{ url: string }>;
}

export interface PresetInputs {
  /** Stored on the skill run's input (never a private key). */
  run: Record<string, unknown>;
  /** Added to the workflow input. Only on the run stage. */
  workflow: Record<string, unknown>;
  /** Added to the quote response (e.g. the resolved Modesty Default). */
  quote: Record<string, unknown>;
}

export type PresetInputResolver = (ctx: PresetInputContext) => Promise<PresetInputs>;
