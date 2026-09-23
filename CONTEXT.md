# Agent-Media (MENA)

A short-video generator for the MENA market whose defining promise is Arabic speech a native speaker accepts as natural, in the viewer's own dialect.

## Language

### Shorts

**Short**:
A vertical video, a few seconds long, produced from one brief.
_Avoid_: clip, reel, UGC video

**Voice-over Short**:
A Short whose speech is heard over visuals where nobody's mouth has to match it (b-roll, product, hands, POV, a silent reacting face).
_Avoid_: faceless video

**Talking-head Short**:
A Short where a visible person's mouth must match the Arabic speech.
_Avoid_: lip-sync video, selfie video

**Preset**:
A named Short format the user picks instead of writing prompts (Product Hero, Hands-on, Reaction), carrying its own cost budget.
_Avoid_: template, skill, workflow

### Arabic speech

**Dialect**:
The spoken variety of Arabic a Short uses: Gulf, Egyptian, Levantine, Maghrebi, or MSA (Modern Standard Arabic).
_Avoid_: accent, language

**Voice**:
A named synthetic or cloned speaker, tagged with exactly one Dialect.

**Approved Voice**:
A Voice that a native speaker of its Dialect has accepted as natural. Only Approved Voices may appear in a published Short.
_Avoid_: supported voice, available voice

**Personal Voice**:
A Voice cloned from a user's own recordings. It counts as an Approved Voice for its owner only.
_Avoid_: custom voice, my voice

**Human Recording**:
Arabic speech recorded by a real person (the user or a voice actor) for one Short, rather than synthesised.

**Brief**:
What the user asks for, in any language; not what gets spoken.
_Avoid_: prompt, script

**Product Details**:
The facts about the product being sold (name, description, notes or ingredients, benefits), given separately from the Brief; the Script sells these, never invents them.
_Avoid_: product copy, description (alone)

**Script**:
The exact dialect text spoken in a Short, in plain dialect spelling with Targeted Diacritics and optional Delivery Tags, reviewed by the user before voicing.
_Avoid_: copy, text, prompt

**Targeted Diacritics**:
تشكيل on every word a voice could misread (product nouns, notes, ingredients, and words with a common second reading, e.g. جِلد, مِسك); everything else stays unmarked. Enforced by the writer's own report of the product terms it marked plus a growing list of known misreadable words (homographs) that native reviewers extend when they hear a mis-read (`HOMOGRAPHS` in `services/api-v2/src/drafts/script-check.ts`).
_Avoid_: full diacritics, tashkeel (alone)

**Delivery Tag**:
A bracketed direction inside a Script that shapes how the next words are spoken (e.g. [softly], [excited]); it is never spoken and never shown in Captions.
_Avoid_: audio tag, emotion tag

**Captions**:
Right-to-left Arabic text burned into a Short, timed from the voiced Script, without its Delivery Tags. Opt-in.
_Avoid_: subtitles

**Qualified Preset**:
A Preset–Dialect pair whose sample Shorts native speakers of that Dialect have accepted. Only Qualified Presets are offered to users; a completed render is never evidence of quality on its own.
_Avoid_: accepted short, supported preset

**Arabic Report**:
A user's flag that a Short's Arabic sounds wrong; enough of them send a Qualified Preset back for review.

**Music Bed**:
A licensed track chosen per Preset, ducked under the voice.
_Avoid_: soundtrack, background audio
