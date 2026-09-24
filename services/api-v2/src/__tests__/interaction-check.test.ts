// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The Product Interaction guardrail check (#25): a Product Interaction may add
// an action to a hands or person shot, never contradict the Guardrails — the
// no-speaking instruction and the Modesty Default. Checked in English and
// Arabic, case- and diacritics-insensitively.

import { describe, it, expect } from 'vitest';
import { productInteractionGuardrailIssue } from '../drafts/interaction-check.js';

describe('productInteractionGuardrailIssue — passes realistic use', () => {
  it.each([
    'removes the cap, sprays once on the inner wrist, brings the wrist to the nose, smiles',
    'Removes the cap, sprays once on the inner wrist, brings the wrist to the nose, smiles.',
    'lifts the cup with both hands, takes one slow sip, lowers it and smiles',
    'squeezes a small amount onto the back of the hand and gently rubs it in',
    'applies the skincare cream to the back of the hand',
    'opens the box, takes out the watch and fastens it over the sleeve',
    'removes the cap and adjusts her hijab slightly, then sprays once on the wrist',
    'smiles at the camera and nods',
    'holds the bottle up to the camera, label facing out',
    'unscrews the lid, sniffs the jar, looks pleased',
    'تفتح الغطاء وترش مرة على المعصم ثم تشمه وتبتسم',
    'يرفع الكوب ويأخذ رشفة هادئة ويبتسم',
    'تضع قليلا من الكريم على ظهر اليد وتفركه بلطف',
    'تعدل حجابها وتبتسم',
  ])('passes: %s', (text) => {
    expect(productInteractionGuardrailIssue(text)).toBeNull();
  });

  it('passes nothing to check', () => {
    expect(productInteractionGuardrailIssue(null)).toBeNull();
    expect(productInteractionGuardrailIssue('   ')).toBeNull();
  });
});

describe('productInteractionGuardrailIssue — refuses what breaks a Guardrail (English)', () => {
  it.each<[string, string]>([
    ['sprays the perfume and says "amazing" to the camera', 'speech'],
    ['talks about the scent while spraying it', 'speech'],
    ['SPEAKS to the viewer about the notes', 'speech'],
    ['explains the notes, speaking to the camera', 'speech'],
    ['lip-syncs the script while holding the bottle', 'speech'],
    ['lip sync to the voice-over', 'speech'],
    ['whispers the product name', 'speech'],
    ['mouths the words of the script', 'speech'],
    ['addresses the camera and recommends it', 'speech'],
    ['takes off her hijab and sprays her hair', 'hijab'],
    ['removes the headscarf, then sprays', 'hijab'],
    ['removes her abaya and sprays her neck', 'hijab'],
    ['sprays it, hair uncovered, without a hijab', 'hijab'],
    ['pulls off her head scarf', 'hijab'],
    ['rolls up her sleeves and sprays the bare forearm', 'exposed'],
    ['sprays on her bare shoulders', 'exposed'],
    ['sprays on exposed skin at the neck', 'exposed'],
    ['wears a sleeveless top and sprays her arm', 'exposed'],
    ['shows her arms and sprays', 'exposed'],
    ['undresses and sprays her body', 'undress'],
    ['takes off his shirt and sprays his chest', 'undress'],
    ['unbuttons her blouse and sprays', 'undress'],
  ])('refuses: %s (%s)', (text, guardrail) => {
    const issue = productInteractionGuardrailIssue(text);
    expect(issue).not.toBeNull();
    expect(issue!.guardrail).toBe(guardrail);
    expect(issue!.matched.length).toBeGreaterThan(0);
    expect(issue!.message).toContain(issue!.matched);
  });
});

describe('productInteractionGuardrailIssue — refuses what breaks a Guardrail (Arabic)', () => {
  it.each<[string, string]>([
    ['يتكلم عن العطر وهو يرشه', 'speech'],
    ['تتكلم للكاميرا عن الرائحة', 'speech'],
    ['تتكلّم عن الرائحة', 'speech'], // with a shadda: diacritics-insensitive
    ['يحكي عن القهوة', 'speech'],
    ['وتحكي عن المنتج', 'speech'],
    ['تتحدث عن المكونات', 'speech'],
    ['تقول للكاميرا انه رائع', 'speech'],
    ['تخلع الحجاب وترش العطر على شعرها', 'hijab'],
    ['تَخلَع الحِجاب', 'hijab'],
    ['تظهر بدون حجاب وترش العطر', 'hijab'],
    ['تنزع الطرحة', 'hijab'],
    ['تكشف ذراعها وترش العطر', 'exposed'],
    ['ترش على ذراعيها العاريتين', 'exposed'],
    ['ترفع اكمامها وترش', 'exposed'],
    ['تخلع ملابسها', 'undress'],
  ])('refuses: %s (%s)', (text, guardrail) => {
    const issue = productInteractionGuardrailIssue(text);
    expect(issue).not.toBeNull();
    expect(issue!.guardrail).toBe(guardrail);
  });
});
