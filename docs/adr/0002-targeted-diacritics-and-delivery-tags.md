# Scripts use Targeted Diacritics and Delivery Tags, not full تشكيل

The spec first required a fully diacritized Script, to stop the voice guessing vowels. In the first live Product Hero test (2026-09-23, RUMI Royal Rituals, Levantine, ElevenLabs `eleven_v3`), full تشكيل made the delivery slow and formal — closer to فصحى than spoken Levantine — while a fully unmarked Script mis-read exactly the words that carry the sale: جلد as *jald* (whipping) instead of *jild* (leather), مسك as *masak* (took) instead of *misk*. Both were nouns in a bare list of fragrance notes, where no sentence disambiguates them. So a Script is written in plain dialect spelling with Targeted Diacritics — marks only on product nouns, notes, ingredients and words with a common second reading — plus a few Delivery Tags (`[softly]`, `[excited]`, …) that `eleven_v3` treats as direction rather than speech. The user can add a mark to any word they hear mis-read and re-voice.

## Consequences

- The "fully diacritized" check on generated Scripts is replaced by a check that the Script is Arabic text plus allowed Delivery Tags, and that every product noun from the Product Details is marked.
- Captions and any Script display to viewers must strip Delivery Tags; the TTS alignment includes the tag characters.
- Delivery Tags depend on a TTS model that honours them (`eleven_v3`); a Voice on another model would speak them aloud.
