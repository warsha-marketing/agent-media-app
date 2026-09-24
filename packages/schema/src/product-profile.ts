// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Product Profile (#30) — what the system understands about one product from
 * its photo and Product Details (CONTEXT.md): category, real size, parts and
 * the state it is in when used, how it is used, grip, and the physical risks
 * for video. Claude (vision) writes it at drafting time; it is stored on the
 * draft, the user may edit it (a new draft), and the Product Interaction is
 * written from it. Later the Playbook choice, the In-use Reference and the
 * Scale Anchors read it too.
 *
 * The ONE definition: api-v2 validates the vision reply and a user's edit with
 * ProductProfileSchema, the writer asks for PRODUCT_PROFILE_OUTPUT_SCHEMA, and
 * the web field lists mirror the enums (apps/web/lib/product-profile-flow.ts,
 * held equal by scripts/tests/delivery-tags-parity.test.ts).
 */

import { z } from 'zod';

/** The fixed category list; anything else is "other" (it gets the conservative Playbook). */
export const PRODUCT_CATEGORIES = [
  'fragrance_oud',
  'skincare_beauty',
  'food_cafe',
  'electronics',
  'fashion_modest',
  'home',
  'other',
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/** How big the product is next to a hand: the Scale Anchor starts here. */
export const SIZE_CLASSES = ['tiny', 'palm', 'hand', 'two_hands', 'large'] as const;
export type SizeClass = (typeof SIZE_CLASSES)[number];

/**
 * What tends to break physics on video for this product. A fixed list, so the
 * Playbooks and the Critic can act on each flag.
 */
export const PHYSICS_RISKS = [
  /** A cap or lid that comes off (a second cap appears, or it stays on while used). */
  'separate_cap',
  /** Liquid poured from one container into another. */
  'liquid_pour',
  /** A spray or mist leaves the product. */
  'liquid_spray',
  /** Printed text or a fine logo that video models smear. */
  'small_text',
  /** Glass, chrome or mirror finishes that reflect the room. */
  'reflective_surface',
  /** A clear body whose contents or level must stay consistent. */
  'transparent_body',
  /** Soft goods that fold or drape (fabric, pouches). */
  'deformable',
  /** Several small pieces that can multiply or vanish. */
  'small_parts',
  /** Steam, heat or a hot drink. */
  'hot_contents',
  /** A screen whose content would be invented. */
  'screen_content',
  /** A cable, strap or cord. */
  'cable_or_strap',
  /** A wrapper, seal or packaging removed before use. */
  'packaging_removal',
] as const;
export type PhysicsRisk = (typeof PHYSICS_RISKS)[number];

/** Collapse whitespace and trim. */
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const text = (max: number) => z.string().transform(tidy).pipe(z.string().min(1).max(max));
/** A dimension in cm or ml: positive and within reason, or null when unknown. */
const dimension = (max: number) => z.number().positive().max(max).nullable().optional().transform((v) => v ?? null);

/** Lower-case, de-duplicated, order kept. */
const uniqueLower = (xs: string[]) => [...new Set(xs.map((x) => x.toLowerCase()))];

export const ProductProfileSchema = z
  .object({
    category: z.enum(PRODUCT_CATEGORIES),
    /** Real size where the photo or details give it; null when unknown. */
    dimensions: z
      .object({
        height_cm: dimension(500),
        width_cm: dimension(500),
        volume_ml: dimension(100_000),
      })
      .strict(),
    size_class: z.enum(SIZE_CLASSES),
    /** The product's parts, e.g. { name: 'cap', removable: true }. */
    parts: z.array(z.object({ name: text(40), removable: z.boolean() }).strict()).max(8),
    /** The state the product is in while used, e.g. "uncapped, spray neck visible". */
    used_state: text(160),
    /** True when the photo shows it in another state (then an In-use Reference is made). */
    differs_from_photo: z.boolean(),
    /** How it is used, as verbs: spray, sip, apply, … */
    interaction_verbs: z.array(text(30)).min(1).max(6).transform(uniqueLower),
    /** How one hand holds it while it is used. */
    grip: text(120),
    physics_risks: z.array(z.enum(PHYSICS_RISKS)).max(PHYSICS_RISKS.length).transform((xs) => [...new Set(xs)]),
    /** How sure the vision call is, 0–1. */
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type ProductProfile = z.output<typeof ProductProfileSchema>;
export type ProductProfileInput = z.input<typeof ProductProfileSchema>;

/** A valid Profile, normalised (text tidied, duplicates dropped, unknown dimensions null); throws a ZodError otherwise. */
export function parseProductProfile(value: unknown): ProductProfile {
  return ProductProfileSchema.parse(value);
}

/** Why `value` is not a Product Profile, one line per issue ("confidence: …"); [] when it is one. */
export function productProfileIssues(value: unknown): string[] {
  const r = ProductProfileSchema.safeParse(value);
  if (r.success) return [];
  return r.error.issues.map((i) => `${i.path.length ? i.path.join('.') : 'profile'}: ${i.message}`);
}

const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] } as const;

/**
 * What the vision call is asked to reply with (Anthropic structured output). No
 * numeric or length constraints: structured outputs refuse them, so
 * ProductProfileSchema holds the reply to them afterwards.
 */
export const PRODUCT_PROFILE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: [...PRODUCT_CATEGORIES] },
    dimensions: {
      type: 'object',
      properties: { height_cm: nullableNumber, width_cm: nullableNumber, volume_ml: nullableNumber },
      required: ['height_cm', 'width_cm', 'volume_ml'],
      additionalProperties: false,
    },
    size_class: { type: 'string', enum: [...SIZE_CLASSES] },
    parts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, removable: { type: 'boolean' } },
        required: ['name', 'removable'],
        additionalProperties: false,
      },
    },
    used_state: { type: 'string' },
    differs_from_photo: { type: 'boolean' },
    interaction_verbs: { type: 'array', items: { type: 'string' } },
    grip: { type: 'string' },
    physics_risks: { type: 'array', items: { type: 'string', enum: [...PHYSICS_RISKS] } },
    confidence: { type: 'number' },
  },
  required: [
    'category',
    'dimensions',
    'size_class',
    'parts',
    'used_state',
    'differs_from_photo',
    'interaction_verbs',
    'grip',
    'physics_risks',
    'confidence',
  ],
  additionalProperties: false,
} as const;
