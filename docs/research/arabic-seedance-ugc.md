# Natural Arabic UGC and lip-sync through EvoLink

Research date: 2026-09-12. Scope: vertical 9:16, 5/10/15-second small-business UGC for MENA audiences. Sources are first-party model or provider documentation; claims from provider marketing pages are labelled accordingly.

The repository's product requirements and observed test verdicts are recorded separately in [`docs/mena-ugc-acceptance.md`](../mena-ugc-acceptance.md); this report focuses on provider/model evidence and the viable integration path.

## Decision

Use the approved human-recorded Levantine performance as the diagnostic audio reference and treat lip-sync as a separate acceptance requirement. No tested route yet satisfies all of the user’s production requirements. Today, the documented EvoLink path is **OmniHuman 1.5 from the portrait plus the final recording**. Seedance 2.0 Mini remains the best low-cost visual prototype, but its `audio_urls` input is a multimodal *reference*, not a documented guarantee that the supplied waveform drives every mouth pose. The observed Mini result—good visuals but mouth motion unrelated to the Arabic recording—fails product acceptance. It does not yet distinguish an audio-conditioning limitation from an incorrect request assumption or a postprocessing timing problem.

There is no verified, documented EvoLink workflow in the sources reviewed that takes an already-generated Mini video and deterministically re-times its mouth to arbitrary Arabic audio. OmniHuman's public contract takes an image and audio, not a source video. Consequently, “Mini visuals, then OmniHuman lip-sync” is not currently an implementable two-stage API path without regenerating the motion from the still.

## What is verified

### Seedance 2.0 Mini

EvoLink documents the route `seedance-2.0-mini-reference-to-video` on `POST https://api.evolink.ai/v1/videos/generations`. It accepts up to nine `image_urls`, three `video_urls`, and three WAV/MP3 `audio_urls`; at least one image or video is required when audio is supplied. Output duration is 4–15 seconds, quality is 480p or 720p, and 9:16 is supported. `generate_audio` defaults to `true` and is described only as synchronized output audio at no extra charge. The public parameter description does **not** state that setting it to `false` preserves audio conditioning while suppressing only the audio stream. [EvoLink Seedance 2.0 Mini API and pricing](https://evolink.ai/seedance-2-0-mini)

EvoLink documents indexed reference syntax as `@image1`, `@video2`, and `@audio3` in its Seedance 2.0 integration guide. This verifies that `@audio1` is valid reference syntax. It does not convert a general audio reference into a deterministic lip-sync API. [EvoLink Seedance 2.0 API guide](https://evolink.ai/blog/seedance-2-api-access-guide-international-developers)

ByteDance describes Seedance 2.0 as a unified model that can use audio references for “sound characteristics” and supports synchronized native audio, but its published discussion highlights Chinese dialect gains and admits occasional audio distortion. It makes no specific claim for Arabic or Levantine speech. [ByteDance Seedance 2.0 release](https://seed.bytedance.com/en/blog/seedance-2-0-official-launch)

Therefore the current application request is **technically valid**:

```json
{
  "model": "seedance-2.0-mini-reference-to-video",
  "prompt": "The adult in @image1 speaks the supplied dialogue in @audio1 ...",
  "image_urls": ["https://.../portrait.jpg"],
  "audio_urls": ["https://.../levantine.wav"],
  "duration": 5,
  "aspect_ratio": "9:16",
  "quality": "720p",
  "generate_audio": false
}
```

But the code comment claiming that `generate_audio: false` makes Mini use the supplied recording is stronger than the documentation. Muxing the original recording onto the returned silent video preserves sound quality; it cannot repair mouth motion that was not driven by that waveform.

### Seedance 2.5

ByteDance says Seedance 2.5 accepts audio references and improves audiovisual coherence, but does not claim Arabic or Levantine input support. API access was only described as “coming soon” in ByteDance's July launch post, so live EvoLink behavior is provider-supplied rather than yet corroborated by a BytePlus API contract. [ByteDance Seedance 2.5 release](https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5)

EvoLink now lists `seedance-2.5-reference-to-video`, 4–30-second output, audio-only references, and up to ten audio references. Its own prompt library warns that community clips are not verified EvoLink API benchmarks. The examples demonstrate reference assignment and generated multilingual dialogue patterns, not Arabic lip-sync accuracy against a supplied recording. [EvoLink changelog](https://evolink.ai/changelog) [EvoLink Seedance 2.5 prompt library](https://evolink.ai/seedance-2-5-prompts)

Seedance 2.5 is thus an experiment, not the production recommendation. Use the same 5-second fixture and require native-speaker acceptance before considering it.

### OmniHuman 1.5

EvoLink explicitly defines OmniHuman as audio-driven: `audio_url` drives lip-sync and body movement. It accepts directly accessible MP3/WAV up to 35 seconds and portrait images, with standard mode selected by `pe_fast_mode: false`. [EvoLink OmniHuman 1.5 API](https://evolink.ai/omnihuman-1-5)

Documented request:

```json
{
  "model": "omnihuman-1.5",
  "audio_url": "https://.../levantine.wav",
  "image_urls": ["https://.../portrait.jpg"],
  "subject_check": true,
  "auto_mask": true,
  "pe_fast_mode": false,
  "seed": -1,
  "prompt": "Natural close-up phone-camera delivery with subtle expressions. Preserve clothing, head covering, identity, and setting."
}
```

The public request schema does not expose `aspect_ratio` or `duration`; output duration follows the input audio. Supply a 9:16 portrait and an approved recording that fits the chosen 5/10/15-second duration; pad silence if needed rather than cutting spoken words. Verify the delivered aspect ratio and duration. The claim of “true lip-sync” is EvoLink marketing; the audio-driven input contract is verified, while Levantine quality remains an acceptance-test question.

## Audio strategy

The wife's 4.16-second Levantine recording is the user-approved quality reference for the current test. A scalable synthetic-voice product still needs a separately accepted Arabic voice solution. Record the final words, dialect, pauses, and emotion rather than generating MSA and asking a video model to imitate Levantine delivery.

If synthetic speech is later required, ElevenLabs officially supports Arabic and says accent comes from the chosen voice; it recommends a voice trained in the target language/accent or a clone recorded in that accent. Its general Arabic listing mentions Saudi/UAE rather than Levantine variants, so Arabic support alone does not establish Levantine naturalness. The API can set `language_code: "ar"` on supporting models, while Multilingual v2 does not accept that parameter. [ElevenLabs TTS capabilities](https://elevenlabs.io/docs/overview/capabilities/text-to-speech) [ElevenLabs language and accent guidance](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-do-i-select-the-language-and-accent) [ElevenLabs create-speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)

Azure lists a Syrian Arabic neural voice (`ar-SY-AmanyNeural`), which is a better documented regional starting point than generic Arabic, but “Syrian locale” is not proof that native speakers will accept its Levantine prosody. [Microsoft Speech language and voice support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=speech-translation)

Do not ship any TTS voice based on vendor language support alone. The native user's rejection of Seedance native Arabic and OpenAI `nova`/`shimmer`/`coral` overrides generic capability claims.

## Cost and budget gate

Live EvoLink Mini pricing is $0.040/output-second at 720p for image/audio reference jobs: approximately **$0.20 / $0.40 / $0.60** for 5/10/15 seconds. All fit the $1 primitive cap. EvoLink says failed generations are not billed. [EvoLink Mini pricing](https://evolink.ai/seedance-2-0-mini) [EvoLink pricing policy](https://evolink.ai/pricing)

OmniHuman is currently $0.177 per input-audio second, rounded up: **$0.885 / $1.77 / $2.655** for 5/10/15 seconds. Only the 5-second test is allowed under the current $1 primitive cap; 10 and 15 seconds require explicit approval or a raised cap. [EvoLink OmniHuman pricing and API](https://evolink.ai/omnihuman-1-5)

Seedance 2.5 pricing is mode- and resolution-dependent and its live catalog starts at $0.084 per input-plus-output second for 480p with video input. That headline is not enough to predict a 720p image-plus-audio job, so query the account's price estimate before submission and reject any job whose reservation exceeds $1. [EvoLink pricing](https://evolink.ai/pricing)

## Recommended experiments

Use one consented fictional-adult portrait with the same 4.16-second recording, padded with room tone to exactly 5.0 seconds. Keep the face large, front-facing, unobstructed, and well lit. Produce only 9:16.

1. **Existing fallback benchmark:** retain the completed OmniHuman 1.5 result; do not repeat the identical test. The user accepted the recorded voice but preferred Mini’s visual appearance. A different OmniHuman visual treatment is a later experiment, not a proven production solution.
2. **Diagnostic Mini A/B:** two 5-second Mini jobs, identical prompt/assets (fix a seed only if the selected route documents support), one with `generate_audio: true` and one `false`. Download both original provider files before muxing. This directly tests whether the flag changes conditioning. Estimated total $0.40. Do not interpret an accepted API response as a lip-sync pass.
3. **Optional 2.5 gate:** only if its dashboard estimate is below $1, one 5-second `seedance-2.5-reference-to-video` run with the recording assigned solely as dialogue/voice and no generated dialogue text. This tests the newer model without assuming it fixes Arabic.

Each individual primitive stays below $1. Do not run 10/15-second OmniHuman experiments until authorized.

## Acceptance test

Have at least two native Levantine speakers review blinded outputs against the original recording. A clip passes only if both accept all of the following:

- **Words:** every word is the recorded word; no deletion, insertion, substitution, or generated second voice.
- **Dialect:** Levantine consonants/vowels and colloquial forms remain intact; no drift toward MSA, Gulf, or Egyptian delivery.
- **Prosody:** stress, pauses, emphasis, breath, emotion, and conversational pace match the recording.
- **Lip timing:** mouth onset/offset aligns with speech; bilabial `/b m/` closures, labiodental `/f/` contact, open vowels, and silence are visibly plausible; no continuing speech with closed lips and no mouth flapping during silence.
- **Visual quality:** stable identity, natural teeth/tongue/face, subtle head movement, phone-camera texture, no captions/logos, and no clothing or head-covering drift.

Preserving the recording alone does not isolate the cause of failed mouth timing. First compare the raw provider output, reference-audio semantics, generated audio timing, and final mux. Fail the integration when the wrong audio, offset, resampling drift, trim, or mux duration is present; classify a model limitation only after those request and processing hypotheses are tested.

## Hijab and moderation

No reviewed first-party document states that hijab is prohibited, and the earlier successful hijab generation is evidence against a blanket ban. Treat the cause of generic `content_policy_violation` responses as unresolved; harmless-looking rejected inputs are potential false positives, not confirmed ones. Preserve legitimate character and clothing choices.

Use only adult, fictional or properly licensed/consented subjects; keep provenance and consent metadata; send the unmodified compliant portrait; retain task IDs and moderation responses; and route rejected assets to another documented model or human review. EvoLink itself advises checking likeness rights and input-asset compliance after content rejection. Do not disable `content_filter`, alter religious clothing, or reword prompts to evade moderation. [EvoLink Mini error guidance](https://evolink.ai/seedance-2-0-mini)

## Implementation priorities

1. Remove the assertion that Mini `generate_audio: false` guarantees supplied-audio lip-sync; record model, seed, original provider media, request body, audio duration, mux offset, and charged amount for every run.
2. Enforce 9:16 at the product contract, including selfie and B-roll paths, and restrict this product to 5/10/15 seconds.
3. Base duration and script fit on measured audio length, not whitespace word count; Arabic clitics make whitespace counts especially unsuitable.
4. Add a pre-submit cost gate using live/reserved provider cost. The current hard cap rules out OmniHuman at 10/15 seconds.
5. Keep OmniHuman as the documented audio-driven fallback, without declaring its visual quality accepted. Keep Mini for silent/ambient visual UGC or controlled speech experiments until it independently passes acceptance.

## Unresolved blockers

- EvoLink does not publicly specify whether `generate_audio: false` preserves Seedance audio-reference conditioning.
- Neither ByteDance nor EvoLink publishes Arabic/Levantine benchmark results for Seedance 2.0, 2.5, or OmniHuman 1.5.
- No documented EvoLink source-video lip-sync endpoint was found that can preserve an already-rendered Mini clip while replacing its mouth motion.
- 10/15-second OmniHuman clips exceed the current $1 primitive cap.
- The provider's generic moderation response gives no actionable reason for the inconsistent hijab outcomes.

## Product acceptance contract

See [MENA UGC acceptance criteria](../mena-ugc-acceptance.md) for the user requirements and implementation audit. This research identifies the next diagnostic step; it does not establish perfect Arabic, universal character acceptance, or a production-ready combined solution.
