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

**Modesty Default**:
How modest the people and hands in a Preset's shots are, declared by the Preset: arms covered or sleeved (never bare), and for a woman on screen a hijab, on by default for Gulf. It goes into every shot that shows a person or hands; the user may pick another culturally acceptable option, never a less modest one than the Preset allows.
_Avoid_: dress code, modesty filter, safe mode

**Product Interaction**:
How a real person uses the product on camera, as one short, simple, continuous English action with the product already in the state it is used in (perfume: "holds the uncapped bottle, sprays once on the inner wrist, brings the wrist to the nose, smiles"; coffee: a sip; skincare: from the open jar, applied to the back of the hand). The Script writer drafts it from the Product Profile and the Product Details alongside the Script; it is stored on the draft, and the user may edit it, which makes a new draft like a Script edit. It goes into every shot that shows hands or a person (and a hands starting frame), never a product shot, and never overrides the Modesty Default or the no-speaking instruction: one that contradicts them (speech, a hijab removed, bare arms or skin, undressing; English or Arabic) is refused when saved.
_Avoid_: usage, action prompt, demo, gesture

**Shot Plan**:
Every shot a render will make, composed before it starts from the approved draft and the Preset: each shot's kind (product, hands or person), on-screen length and video model (with its fallback), and its Shot Prompt. The quote prices it; the user may open it ("Review shots") and edit each shot's scene text before Confirm, which never changes the price. Not opening it renders exactly the Preset's plan.
_Avoid_: storyboard, shot list, timeline

**Shot Prompt**:
What one shot's video model is asked for: its scene text (what happens in the shot, provider-neutral: "the product", "the person"; the Preset's by default, with the Product Interaction on hands and person shots, and editable by the user) plus the shot's Guardrails. The server always builds it itself; the final prompt as sent to the model is kept with the render and shown to the owner on the result.
_Avoid_: prompt (alone), shot description, template

**Guardrail**:
A locked line of a Shot Prompt that the user sees but can never edit or remove: the fixed product and character references, the no-speaking instruction on person and hands shots (ADR 0001), the Modesty Default, nobody on a product shot, no text or captions, and the video model's own audio off. The server adds them to every shot whatever the client sends, and refuses scene text (or a Product Interaction) that contradicts one: speech, a hijab removed, bare arms or skin, undressing, in English or Arabic.
_Avoid_: safety filter, rule, constraint, negative prompt

### Product intelligence

**Product Profile**:
What the system understands about one product from its photo and Product Details: category, real size, parts and states, how it is used, grip, and physical risks for video. Read by Claude (vision) when a draft is made from a product photo, before the Script; stored on the draft, and the user may edit it, which makes a new draft (and re-writes the Product Interaction from it).
_Avoid_: product metadata, product analysis

**In-use Reference**:
An edited product image showing the product in the state it is used in (e.g. a perfume bottle uncapped), used as the video reference instead of the packshot.
_Avoid_: modified product photo

**Scale Anchor**:
A physical comparison in a Shot Prompt that fixes the product's real size (e.g. "about the height of her palm").
_Avoid_: size hint

**Playbook**:
Shared, tested shot and interaction rules for one product category, used by every product in it.
_Avoid_: template, category prompt

**Critic**:
The automatic check of a rendered shot's frames against its Product Profile and Guardrails; a hard defect triggers one automatic re-render, soft defects are flagged.
_Avoid_: QA bot, validator

**Evaluation Set**:
A fixed set of real products rendered after every pipeline change and scored by the Critic and a human, to show a change helps across products.
_Avoid_: test products, benchmark

**Set**:
The one place, light and props a whole Short happens in, fixed before any shot is rendered.
_Avoid_: background, location

### Arabic speech

**Dialect**:
The spoken variety of Arabic a Short uses: Gulf, Egyptian, Levantine, Maghrebi, or MSA (Modern Standard Arabic).
_Avoid_: accent, language

**Voice**:
A named synthetic or cloned speaker, tagged with exactly one Dialect and a gender, male or female (no gender-neutral Voices: not culturally acceptable for MENA ads).

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
Right-to-left Arabic text burned into a Short, line by line. Added after the render, never during it: every render keeps a clean Short, and the Caption editor starts from suggested lines timed from the voiced Script, shown without Targeted Diacritics (the Script's letters unchanged) and without its Delivery Tags. The user edits the lines (words, split and merge, timing) and their position, size and colour over a live preview, then exports: the server burns them into a new file of the Short (free, as many versions as they like). The same lines download as an .srt.
_Avoid_: subtitles

**Qualified Preset**:
A Preset–Dialect pair whose sample Shorts native speakers of that Dialect have accepted. Only Qualified Presets are offered to users; a completed render is never evidence of quality on its own.
_Avoid_: accepted short, supported preset

**Arabic Report**:
A user's flag that a Short's Arabic sounds wrong; enough of them send a Qualified Preset back for review.

**Music Bed**:
A licensed track chosen per Preset, ducked under the voice.
_Avoid_: soundtrack, background audio
