# Arabic Shorts are audio-first; the video model never speaks

Every native-speech attempt was rejected by native Levantine reviewers (Seedance Mini and 2.5 native Arabic, OpenAI TTS voices), and "Arabic audio, then lip sync" failed on both EvoLink routes (Seedance Mini `audio_urls`, OmniHuman 1.5) even with a real human recording. So a Short's speech is produced first — a diacritized Script voiced by an Approved Voice or a Human Recording — its length is measured, and visuals are generated silent (`generate_audio: false`) and cut to fit, then mixed with the Music Bed and optional Captions. Launch ships only Voice-over Shorts, where no mouth has to match the speech; Talking-head Shorts wait on a separate native-speaker bake-off of providers outside EvoLink.

## Considered Options

- **Video model speaks natively** (the previous `make_ugc` / `make_simple_selfie` path): rejected as artificial by native reviewers.
- **Video first, fit the voice to the clip**: time-stretching or trimming Arabic speech destroys the naturalness that is the product's promise.
- **EvoLink lip sync over generated audio**: no effective lip sync on Mini; OmniHuman's lips failed review and its per-second price breaks 10–15 s budgets.

## Consequences

- The `make_*` skills where Seedance speaks are retired; Presets become the single way to make a Short, used by both the web UI and the agent.
- Shot planning must fill an arbitrary audio length, so visuals are assembled from several clips rather than one fixed-duration render.
