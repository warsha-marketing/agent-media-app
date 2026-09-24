// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * The guardrail check (#25, #26): text a user writes into a shot must never
 * contradict the Guardrails the render puts in every hands and person prompt:
 * nobody speaks (ADR 0001: the draft's voice is the only speech) and the
 * Modesty Default (arms covered or sleeved, a hijab kept on, nobody undressing).
 *
 * Two kinds of user text go into shot prompts, and both are held to it:
 *   - the Product Interaction (#25), when it is SAVED: the writer's own output
 *     (one rewrite told why, then an error, like the Script check) and the
 *     user's edit on re-voice (422 PRODUCT_INTERACTION_BREAKS_GUARDRAIL);
 *   - an edited Shot Prompt scene (#26): refused by api-v2 on the quote and the
 *     run (422 SHOT_EDIT_BREAKS_GUARDRAIL), and again by the worker before it
 *     renders.
 * The render still appends its own Guardrail lines after the text, but a video
 * model given "takes off her hijab" or "talks to the camera" may follow it, so
 * such text is refused rather than trusted to be outvoted.
 *
 * English and Arabic, matched case- and diacritics-insensitively (Arabic
 * harakat and shadda, alef forms, ة/ه and ى/ي folded). The lists name the
 * wording, not every synonym: native reviewers extend them when a phrasing
 * slips through, as they do the Script check's homographs.
 *
 * Pure: the worker's workflow sandbox imports it.
 */

export type InteractionGuardrail = 'speech' | 'hijab' | 'exposed' | 'undress';

export interface InteractionGuardrailIssue {
  guardrail: InteractionGuardrail;
  /** The words that matched, as folded for matching. */
  matched: string;
  message: string;
}

/** Case, Latin accents and Arabic diacritics folded; Arabic letter variants unified. */
export function foldForGuardrails(text: string): string {
  return text
    .normalize('NFKD') // أ إ آ ؤ ئ → the bare letter + a hamza/madda mark, removed next
    .replace(/\p{M}/gu, '')
    .replace(/ـ/g, '') // tatweel
    .replace(/ٱ/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ── English ─────────────────────────────────────────────────────────────────

const EN_COVERS = String.raw`(?:hijabs?|head[\s-]?scarf|head[\s-]?scarves|scarf|scarves|abayas?|niqabs?|veils?|shaylas?|khimars?|head[\s-]?coverings?)`;
const EN_BODY = String.raw`(?:arms?|forearms?|shoulders?|skin|legs?|chest|back|neck|midriff|stomach|belly|body|elbows?|cleavage)`;
const EN_CLOTHES = String.raw`(?:clothes|clothing|shirt|t-shirt|blouse|dress|jacket|sweater|jumper|hoodie|coat|robe)`;
/** Up to `n` words in between ("takes off HER BLACK hijab"). */
const gap = (n: number) => String.raw`(?:\s+\S+){0,${n}}?\s+`;

const EN: ReadonlyArray<[InteractionGuardrail, RegExp]> = [
  [
    'speech',
    new RegExp(
      String.raw`\b(?:speak(?:s|ing)?|spoke|talk(?:s|ing|ed)?|say(?:s|ing)?|said|tell(?:s|ing)?|told|whisper(?:s|ing|ed)?|narrat\w*|explain(?:s|ing|ed)?|sing(?:s|ing)?|sang|shout(?:s|ing|ed)?|lip[\s-]?sync\w*|mouth(?:s|ing|ed)?\s+(?:the\s+)?words?|address(?:es|ing|ed)?\s+the\s+(?:camera|viewer|audience))\b`,
    ),
  ],
  [
    'hijab',
    new RegExp(
      String.raw`\b(?:remov\w*|tak(?:e|es|ing)\s+off|took\s+off|pull(?:s|ing|ed)?\s+(?:off|down|back)|slip(?:s|ping|ped)?\s+off|unwrap\w*|unpin\w*|lower(?:s|ing|ed)?|drop(?:s|ping|ped)?|lift(?:s|ing|ed)?\s+off)${gap(2)}${EN_COVERS}\b` +
        String.raw`|\b(?:without|no|minus)\s+(?:a\s+|her\s+|the\s+|any\s+)?${EN_COVERS}\b` +
        String.raw`|\b${EN_COVERS}[\s-](?:free|off|removed)\b` +
        String.raw`|\b(?:uncover\w*|show(?:s|ing)?|reveal\w*|let(?:s|ting)?\s+down)\s+(?:her\s+|his\s+|the\s+)?hair\b` +
        String.raw`|\bhair\s+(?:uncovered|exposed|showing|visible|loose|down)\b|\bbare[\s-]?headed\b`,
    ),
  ],
  [
    'exposed',
    new RegExp(
      String.raw`\b(?:bare|exposed|naked|nude|uncovered)\s+(?:\S+\s+)?${EN_BODY}\b` +
        String.raw`|\b(?:sleeveless|strapless|shirtless|topless|off[\s-]the[\s-]shoulders?|tank[\s-]?tops?|bikinis?|crop[\s-]?tops?|short[\s-]sleeved?|short\s+sleeves)\b` +
        String.raw`|\b(?:roll(?:s|ing|ed)?|push(?:es|ing|ed)?|pull(?:s|ing|ed)?)\s+(?:up|back)\s+(?:\S+\s+)?sleeves?\b|\brolled[\s-]up\s+sleeves?\b` +
        String.raw`|\b(?:show(?:s|ing)?|reveal(?:s|ing)?|expos(?:e|es|ing))${gap(2)}${EN_BODY}\b`,
    ),
  ],
  [
    'undress',
    new RegExp(
      String.raw`\b(?:undress\w*|disrob\w*|unbutton\w*|strip(?:s|ping|ped)?\s+(?:off|down|naked)|get(?:s|ting)?\s+naked)\b` +
        String.raw`|\b(?:tak(?:e|es|ing)\s+off|took\s+off|remov(?:e|es|ing))${gap(2)}${EN_CLOTHES}\b`,
    ),
  ],
];

// ── Arabic (matched on folded text: no diacritics, ا for أ/إ/آ, ه for ة, ي for ى) ──

/** Not inside a word; an optional و/ف conjunction before it. */
const AR_START = String.raw`(?<!\p{L})[وف]?`;
const AR_COVERS = String.raw`(?:ال)?(?:حجاب|طرحه|شيله|عبايه|عباءه|نقاب|خمار|غطاء\s+الراس)`;
const AR_REMOVE = String.raw`(?:تخلع|يخلع|تنزع|ينزع|تشيل|يشيل|تزيل|يزيل|تفك|يفك)`;

const AR: ReadonlyArray<[InteractionGuardrail, RegExp]> = [
  [
    'speech',
    new RegExp(
      AR_START +
        String.raw`(?:يتكلم|تتكلم|يتحدث|تتحدث|يحكي|تحكي|يقول|تقول|يهمس|تهمس|يغني|تغني|ينطق|تنطق|يخاطب|تخاطب|يشرح|تشرح)` +
        String.raw`|مزامنه\s+الشفاه`,
      'u',
    ),
  ],
  [
    'hijab',
    new RegExp(
      AR_START + AR_REMOVE + String.raw`(?:\s+\S+){0,2}?\s+` + AR_COVERS + '|' + AR_START + String.raw`(?:بدون|بلا|من\s+غير)\s+` + AR_COVERS,
      'u',
    ),
  ],
  [
    'exposed',
    new RegExp(
      AR_START +
        // تكشف/يكشف also means "reveals" (تكشف عن المنتج), so it only counts with a body part.
        String.raw`(?:تكشف|يكشف)(?:\s+عن)?(?:\s+\S+)?\s+(?:ال)?(?:ذراع|اذرع|زند|كتف|اكتاف|جلد|بشره|شعر|ساق|سيقان|صدر|بطن|ظهر|رقبه)\S*` +
        '|' + AR_START + String.raw`(?:(?:ال)?مكشوف|(?:ال)?عاري|(?:ال)?عريان|تشمر|يشمر)` +
        '|' + AR_START + String.raw`(?:بدون|بلا)\s+اكمام` +
        '|' + AR_START + String.raw`(?:ترفع|يرفع)\s+(?:عن\s+)?(?:اكمام|كم)`,
      'u',
    ),
  ],
  [
    'undress',
    new RegExp(
      AR_START + String.raw`(?:تتعري|يتعري|تتجرد|يتجرد)` +
        '|' + AR_START + AR_REMOVE + String.raw`(?:\s+\S+)?\s+(?:ال)?(?:ملابس|ثياب|قميص|فستان|بلوز|جاكيت|ستره)`,
      'u',
    ),
  ],
];

const WHY: Record<InteractionGuardrail, string> = {
  speech: 'nobody on screen speaks or mouths words (the draft’s voice is the only speech)',
  hijab: 'the Modesty Default keeps the hijab, headscarf or abaya on',
  exposed: 'the Modesty Default keeps arms, shoulders and skin covered',
  undress: 'nobody undresses on screen',
};

/** The first Guardrail `text` contradicts, with the words that matched and why; null when it keeps them all. */
export function guardrailIssue(text: string | null | undefined): { guardrail: InteractionGuardrail; matched: string; why: string } | null {
  const folded = foldForGuardrails(text ?? '');
  if (!folded) return null;
  for (const guardrail of ['speech', 'hijab', 'exposed', 'undress'] as const) {
    for (const [g, re] of [...EN, ...AR]) {
      if (g !== guardrail) continue;
      const m = re.exec(folded);
      if (m) return { guardrail, matched: m[0].trim(), why: WHY[guardrail] };
    }
  }
  return null;
}

/**
 * The first Guardrail a Product Interaction contradicts, with the words that
 * matched; null when it keeps them all (or there is nothing to check).
 */
export function productInteractionGuardrailIssue(text: string | null | undefined): InteractionGuardrailIssue | null {
  const issue = guardrailIssue(text);
  if (!issue) return null;
  return {
    guardrail: issue.guardrail,
    matched: issue.matched,
    message: `The Product Interaction breaks a Guardrail: "${issue.matched}" — ${issue.why}. Describe only how the hands use the product.`,
  };
}
