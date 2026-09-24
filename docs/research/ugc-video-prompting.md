# Prompting realistic UGC product clips (Seedance 2.0 first, Kling and Veo second)

All sources were checked on **2026-09-24**. Summaries are in my own words, with at most one short quote per source. **UNVERIFIED** marks a claim from a secondary source, or my own inference, that I could not confirm in first-party docs. Related notes: `seedance-real-person-routes.md` (how to get a consistent face into Seedance legitimately) and `arabic-seedance-ugc.md` (Mini, audio, hijab moderation).

The case under review is the Reaction shot pair in `scratchpad/last-prompts.txt`: Seedance 2.0 Mini, reference-to-video, with the product's in-use photo as image 1.

| Shot | Chars | Words | Negations (no/not/never/nowhere) | "cap" | "face" |
|---|---|---|---|---|---|
| Spray | 2,631 | 467 | 26 | 4 | 5 |
| Smell | 2,572 | 455 | 26 | 4 | 4 |

What came back: the smell close-up was good. In the spray shot a silver object (probably the cap) appeared in her hand, and she sprayed close to her face. Her face changed between shots, and the background was a plain grey wall.

---

## Sources

**First-party**
- **[B1]** BytePlus ModelArk, *Dreamina Seedance 2.0 series prompt guide*, https://docs.byteplus.com/en/docs/ModelArk/2222480. No publication date is shown. The page renders client-side, so I read its embedded document JSON.
- **[B2]** BytePlus ModelArk, *Dreamina Seedance 2.0 series tutorial*, https://docs.byteplus.com/en/docs/ModelArk/2291680.
- **[B3]** BytePlus ModelArk, *Create video generation task* API reference, https://docs.byteplus.com/en/docs/ModelArk/1520757.
- **[B4]** BytePlus ModelArk, `sd2-pe` "Seedance 2.0 Prompt Optimizer" SKILL.md, linked from B2 (hosted on byteimg.com). This is ByteDance's own prompt-rewriting skill.
- **[B5]** BytePlus ModelArk, *Create portrait videos with Dreamina Seedance models*, https://docs.byteplus.com/en/docs/ModelArk/2608626.
- **[B6]** BytePlus ModelArk, *Seedance-1.5-pro prompt guide*, https://docs.byteplus.com/en/docs/ModelArk/2168087.
- **[G1]** Google Cloud, *Video generation prompt guide* (Veo), https://docs.cloud.google.com/vertex-ai/generative-ai/docs/video/video-gen-prompt-guide. Last updated 2026-09-24.
- **[K1]** fal.ai, *Kling 3.0 Prompting Guide*, https://blog.fal.ai/kling-3-0-prompting-guide/ (2026-02-05). This is a partner guide, not Kling's own.

**Practitioner and secondary**
- **[P1]** Higgsfield, *Seedance 2.0 Complete Prompting Guide*, https://higgsfield.ai/blog/seedance-prompting-guide (2026-04-13, updated 2026-08-28).
- **[P2]** ugcmaker.org, *UGC Prompts for Seedance 2*, https://ugcmaker.org/blog/detail/UGC-Prompts-for-Seedance-2-How-to-Create-Native-AI-Video-Ads-8b6c50c7c537/ (2026-05-09).
- **[P3]** Krea, *The 5 best AI video models for UGC shorts in 2026*, https://www.krea.ai/blog/the-5-best-ai-video-models-for-ugc-shorts-in-2026 (2026-07-16).
- **[P4]** MyUP, *The prompt guide for AI UGC ads that actually look real*, https://myup.ai/blog/ai-ugc-ads-realistic-prompt-guide (2026-06-28).
- **[P5]** Oakgen, *AI Product Video Prompt Guide*, https://oakgen.ai/blog/ai-product-video-prompt-guide (2026-07-06).
- **[P6]** invideo, *Seedance 2.0 Prompt Guide*, https://invideo.io/blog/seedance-2-0-prompt-guide/ (undated).
- **[P7]** Apiyi, *Seedance 2.0 official prompt guide interpretation*, https://help.apiyi.com/en/seedance-2-0-prompt-guide-video-generation-camera-style-tips-en.html (undated).
- **[P8]** VIDEOAI.ME, *Seedance 2.0 negative prompts*, https://videoai.me/blog/seedance-2-0-negative-prompts (2026-04-08).
- **[P9]** ChatCut, *Seedance 2.0 prompt guide*, https://chatcut.io/blog/seedance-2-prompt-guide (2026-03-18).
- **[P10]** fal.ai model page, *Seedance 2.0 reference-to-video*, https://fal.ai/models/bytedance/seedance-2.0/reference-to-video.
- **[P11]** GitHub ZeroLu/awesome-seedance, https://github.com/ZeroLu/awesome-seedance (updated 2026-09-24).
- **[P12]** Atlabs, *UGC ads with a single prompt using Seedance 2.0*, https://www.atlabs.ai/blog/how-to-make-ugc-ads-with-a-single-prompt-using-seedance-2.0-(15-prompts) (the page's date is unclear).
- **[P13]** Kling API `negative_prompt` parameter, as documented by third-party wrappers: https://useapi.net/docs/api-kling-v1/post-kling-videos-image2video-elements and https://github.com/aself101/kling-api.
- **[R1]** *Do not think about pink elephant!*, arXiv 2404.15154 (2024). This paper is about text-to-image models, not video.

---

## 1. Findings per question

### Q1. Structure and length

- **The official Seedance 2.0 order is fixed.** B1 gives the advanced formula as: precise subject, action details, scene/environment, lighting and colour tone, camera movement, visual style, image quality, constraints. In B1's words, first establish "who" is "doing what", then "where" and "what atmosphere", then "how to shoot", and finish with style, quality and constraints. B1 describes the model as splitting a prompt into a spatial layer (who/where) and a temporal layer (what happens, in what order).
- **Write it as instructions, not ad copy.** B1 contrasts "copywriting-style description" with "engineering-style instruction". It also says to keep descriptions concise and to avoid redundancy and semantic conflicts. Its FAQ warns against pasting the whole script: redundant copy confuses the model.
- **Multi-shot syntax.** B1 recommends a simple storyboard labelled `Shot 1:` / `Shot 2:`, with each shot written as who + where + doing what + how the camera moves. It **advises against strict timecodes** ("0–3 s"), because the model's timing support is unstable and forcing durations can produce abnormal output. Some practitioners use timecodes anyway (P1 for 15 s animation, P11, P12). The ModelArk navigation lists timestamp support as a *Seedance 2.5* difference. For 2.0/Mini, follow the official guidance.
- **Length.**
  - B3's official ceiling is about 500 Chinese characters or 1,000 English words. B3 warns that long text scatters the information, so the model keeps only the key points and drops details.
  - P7 recommends 60–100 words. P12's UGC prompts run 100–150 words. P6 claims a 3,000-character hard cap and says the first 20–30 words carry the most weight (**UNVERIFIED**; this is not in B1–B3).
  - P6 and P9 agree that when reference images are attached, the text should get **shorter**, because the image carries appearance. B1 also says to express spatial relationships through reference images first and keep the text simple.
  - **Conclusion:** our 2,600-character prompts are under the official cap, but they are 4–6× longer than what practitioners ship. By B3's own warning, that length makes the model drop details, which matches the missing environment and the ignored face/cap rules.
- **Referencing images.** B3 says to refer to assets as type + number (Image 1, Video 1). B4, ByteDance's own optimizer, requires `@Image N` **followed immediately by a noun in parentheses**, e.g. `@Image 1 (the perfume bottle)`. It says putting a verb or number straight after the tag causes tokenisation ambiguity and wrong object counts. B1: every time a subject is mentioned, bind it (`<Subject>@Image N`) or reuse the same label. Put the assets that need the most precise reference **first** in the prompt.
- **Actions.** B1 asks for movement tied to body parts, with amplitude, speed and force ("slowly raise a hand"). It prefers slow, gentle, continuous small movements over big bursts, and wants the transition between actions spelled out. Emotion should be shown through physical detail, not words like "very happy".
- **Camera.** B1: use standard terms (medium shot, close-up, slow push-in, lateral tracking, fixed shot), and use **one camera movement per shot**, because combining them destabilises the image. P7 and B4 say the same.

### Q2. Negatives

- **Seedance has no negative-prompt parameter.** B3 lists no such field, and P10 confirms fal's schema has none. Negatives can only be written into the prompt.
- **ByteDance uses constraint words, but only for generic artefacts.** B1 treats "constraint words" as essential, and its examples are all generic: "keep it subtitle-free", "do not generate a logo", "do not generate a watermark". The anti-duplicate template in B1's FAQ is also generic: no twin or identical characters in the same frame. B4 adds generic anti-distortion lines ("faces stable and not distorted, no clipping through objects"). None of the official examples names a scene-specific object to leave out.
- **Google says outright not to write "no X".** G1 recommends against words like "no" or "don't", with the example of avoiding "no walls". Veo's separate negative-prompt field should list plain nouns ("wall, frame"). Inside the main prompt, describe the state you want (a secondary summary of G1: "a desolate landscape with no buildings" rather than "no man-made structures").
- **Naming an object puts it in play.** R1 documents this "pink elephant" effect for image models. P13's Veo summary says the same for video: "cartoon" stays active even inside "no cartoons". No first-party ByteDance document tests this for Seedance (**UNVERIFIED for Seedance specifically**). Our own result fits it: the spray prompt says "cap" 4 times and "silver crown cap" twice, and a silver object appeared in her hand.
- **Practitioners who say negatives work** (P8, P1) mean short generic closers such as "no music, no logo, no text on screen" or "no 3D, no cartoon". They do not mean lists of scene objects.
- **Best practice:**
  1. Describe the desired state of every hand and surface, so nothing is left open: "her other hand is open and empty", "the dresser top is bare".
  2. Let the reference image carry the product state (uncapped).
  3. Keep in-prompt negatives to one closing clause of generic artefacts (subtitles, logo, watermark, twin).
  4. Never name the specific object you fear.

### Q3. UGC realism cues

- **Cues that work (P2, P4, P5, P3):** "vertical 9:16 phone video", "handheld", "filmed by a friend / selfie angle", a **named, lived-in real place** (bedroom by a window, bathroom counter, car seat), window daylight or overcast light, "natural skin texture / visible pores", off-centre framing, everyday clothes with creases. P2 puts it bluntly: if the prompt sounds like a film trailer, it won't work as UGC.
- **Lighting matters most.** P7, summarising B1, says a single concrete lighting detail beats ten adjectives. "Soft window daylight from the left" is better than "flat, even everyday daylight".
- **The background comes from the setting, not from "sharp background".** Our prompts never name a location. "Flat, even" light plus "sharp background, no bokeh" with no place named produces a neutral grey wall, which is the model's default. P4 lists "generic setting, minimalist, studio background" as markers of the plastic look.
- **What not to say:**
  - Stacked adjectives: "premium, cinematic, viral" (P5, P6).
  - "cinematic", "commercial", "studio", even when negated. Our REALISM line says "not a commercial, not cinematic … no studio, ring light", which keeps those concepts active (inference from Q2).
  - "slow motion", "golden mist", "glides".
  - Anything that implies a gimbal: "smooth", "steady", "orbit" (P1 notes that raw handheld needs non-smooth wording).

### Q4. Product fidelity and hand–object interaction

- **Image anchoring beats text.** P5 says image-to-video preserves labels and proportions, while text makes the model invent them. P5 lists the causes of product distortion: weak reference, aggressive camera moves, impossible physics, the product too small in frame, and clips that are too long.
- **Reference mode and first-frame mode are exclusive in one request.** B3 says first-frame, first+last-frame, and omni-reference are mutually exclusive request types. Omni-reference prompts can still name an image as the first frame "via prompt". In first-frame mode the prompt should describe **only the motion** (P7, K1).
- **One simple action per clip,** described plainly with one hand and one grip (P5). Oakgen's examples are exactly our case: "mist sprays once", "hand places product on table".
- **Specify both hands.** This is my inference from Q2, and it matches the failure we saw. An unassigned hand is where extra objects appear. Say what the second hand is doing.
- **Keep geometry positive.** Say "the nozzle points down at her wrist, the bottle at chest height, about a forearm's length below her chin" instead of "not toward the face". Every "face" token in an action sentence pulls the action toward the face (inference from Q2; the face was mentioned 5 times in the spray prompt).
- **Cut on action.** Start the clip with the action already underway, as our smell shot does ("the wrist already rising"). That shot worked. B1's "supplement transitions between actions" is the same idea.
- **Multi-angle product references help, but multi-angle faces hurt.** B1 and ChatCut (P9) both say products benefit from several views. B1 says a multi-view *character* sheet causes identity drift and twins.
- **(Inference, UNVERIFIED)** On shots where the product is not supposed to be visible (smell), attaching the product image invites the model to put the product in frame. Consider sending no product reference, or the persona only, on product-absent shots.

### Q5. Same face across the shots of one ad

- **Root cause here.** The person is text only: "a woman, an ordinary real person". A hijab hides hair and ears, which removes most identity cues. Each shot therefore samples a new face. ModelArk rejects re-hosted photoreal faces (B5; see `seedance-real-person-routes.md`).
- **Legitimate routes, strongest first:**
  1. **Trusted persona image.** Generate the creator portrait with Seedream on the **same ModelArk account**. Keep the original file untouched (store it in TOS). Pass it as `@Image 2 (the woman)` on every person shot. B5 trusts original outputs from the same account for 30 days. B1's face-reference tips: use a separate head-only close-up with a neutral expression, plus optionally one full-body/outfit image. Never use a multi-view sheet. Label it `facial features reference Image 2`, and put it early in the prompt.
  2. **Frame chaining.** Use shot N's last frame (a Seedance output, which B5 trusts) as shot N+1's `first_frame`. This keeps face, hijab, clothes and room identical. (B5 lists trusted outputs; that last frames count is stated in our routes doc and is **UNVERIFIED** here.)
  3. **One generation for both beats.** Write `Shot 1: spray … Shot 2: close-up, smell …` in a single 8–10 s generation. Identity holds within one generation (B1's shot-sequencing guidance). Then cut the clip in post if the edit needs separate shots.
  4. **Text fallback only.** Use a fixed, concrete description that is identical in every shot: age, face shape, brows, eye colour, skin tone, hijab colour and fabric, top colour. P1 notes practitioners repeat the same identifier string in every shot. This is the weakest route.
- **Official preset digital characters** (`asset://`) exist, but their terms restrict commercial use (see the routes doc).

### Q6. Dynamic, lively UGC

- **Hook in the first 1–2 seconds.** The product should be in hand or in action by then (P2). For a silent Reaction shot, the hook is motion already happening at frame 0 (cut on action), not a slow approach.
- **Camera moves that read as real:** handheld with a slight sway, small reframes, and a quick push-in or cut to close-up (P2). **Moves that read as AI or an ad:** slow orbits, smooth dolly/gimbal glides, rack focus, slow motion (P1 and camera-movement guides; P3 says Seedance is strong at orbits, which is exactly why it tends to offer them).
- **Keep bodies calm, not frozen.** B1 prefers slow, gentle, continuous body movement for stability. Get the life from handheld camera energy and editing (cut on action, 2–4 s beats), not from big body motion.
- **Clip length:** 5–8 s per product clip for control (P5).

### Q7. Perfume and MENA/hijab specifics

- **Perfume.** Community Seedance perfume prompts (P11 and search results) use the same beat we use: mist onto the inner wrist, then wrist to nose, eyes closing, a small smile. One awesome-seedance perfume prompt tells the model to attend to the bottle's proportions and avoid a cut-out look. Our Scale Anchor already covers this. Luxury perfume prompts in these libraries are cinematic (slow-motion golden mist, hands entering the frame). For UGC, avoid that vocabulary.
- **Hijab.** I found no first-party Seedance or Veo guidance. Practitioner fashion tools (for example lovino.ai) use phrasing like "hijab fully covering hair, neck, and chest", and name the hijab's colour, fabric and draping so it stays the same across shots (**UNVERIFIED**; image-tool guidance). The consistency lever is the same as for the face: put the hijab in the persona image. Moderation notes are in `arabic-seedance-ugc.md`.

---

## 2. Critique of the current spray and smell prompts

**Order is inverted.** About 700 characters of references, product state and size come before the shot says what happens ("UGC-style medium shot … sprays once"). B1 wants subject → action → scene → light → camera → style → constraints. P6 says the opening words carry the most weight (unverified). Our opening words are spent on the cap.

**Specific lines:**

| Our line (quoted) | Problem | Do instead |
|---|---|---|
| "The person is a woman, an ordinary real person, the same in every shot." | No identity is given, so the face differs every shot. "the same in every shot" does nothing across separate generations. | Attach the persona as `@Image 2 (the woman)`. If none exists, use a fixed concrete description. |
| "the silver crown cap is removed and nowhere in the scene (not in a hand, not on a surface, not in the background), and no second silver crown cap appears." and "The cap is already off and out of sight: no cap appears, comes off or goes back on." | "cap" 4× and "silver crown cap" 2×. The prompt puts a silver cap in play, and a silver object appeared in her hand. | **Drop it.** The in-use reference image already shows the bottle uncapped. Describe both hands positively ("her left hand is open, palm up, and empty"). |
| "Real size: … about as tall as her whole hand … (about 14 cm tall, about 6.5 cm wide, 100 ml); it keeps exactly this size …" | This is the best-supported guardrail (P11), but it is long. "100 ml" means nothing visually. | "a bottle about the height of her hand" (one clause). Drop the ml figure. |
| "The spray happens right at the start of the shot; then the bottle is set down …" **and** "The person holds the uncapped bottle at chest height, sprays once onto the inner wrist, then sets the bottle down and lets go of it." | The same action is given twice in different words. B1 says to avoid redundancy. | Say it once, as an ordered chain with body parts. |
| "The uncapped bottle stays at chest height, well away from the face." + "never brings the bottle itself to their face or nose: the bottle leaves the hand, set down, before the wrist comes up" + "No spray toward the face" | "face" 5×, "nose" 1×. The playbook line describes a wrist-to-face motion **in the spray shot**, where the wrist never rises. She sprayed near her face. | Give positive geometry once: "nozzle pointing down at her wrist, bottle at chest level". Keep the playbook face rules out of the spray prompt; they belong to the Critic/guardrail check, not the text. |
| "Handheld phone camera with a slight natural sway." … "slight handheld motion" … "The camera and the body may move freely." | The camera is stated three times, and the third contradicts the first two. B1: one camera instruction, no conflicts. | "Handheld phone, slight natural sway, one continuous take." |
| "Flat, even everyday daylight." + "flat soft everyday light (no studio, ring light, dramatic or warm glow, no glare); sharp background, no bokeh" | Light is described twice. No place is named, and "flat, even" plus "sharp background" gives the grey wall. Negated "studio/ring light/dramatic" keeps those concepts in play. | Name a room and one light source: "her bedroom, soft daylight from a window on her left; a wooden dresser behind her". |
| "Raw unedited iPhone video/photo look, not a commercial, not cinematic" | The "video/photo" slash is ambiguous. "not a commercial, not cinematic" puts "commercial, cinematic" in play (G1 advice). | "Everyday iPhone video, true-to-life colours." |
| "real matte skin with visible pores and small natural imperfections, no airbrushing, no waxy or glossy look, no beauty filter" | The positive half works (P4). The four negations add "airbrushing/waxy/glossy/beauty filter" tokens. | "natural skin texture with visible pores". |
| "The person never speaks: the mouth stays closed … no talking, no mouthing words, no lip movement, no singing, no whispering." | 7 negations about speech put talking, singing and whispering in play. `generate_audio: false` is already set on the request. | "She is silent, lips gently closed throughout; she reacts with her eyes and a closed-mouth smile." |
| "The hands and the product stay physically simple: one continuous action, … no parts appearing, vanishing or coming apart. The camera and the body may move freely." | Generic, and it restates the action. "parts appearing" invites exactly that. | Drop it. The single ordered action sentence carries it. |
| "Modest styling: … long sleeves reaching the wrists and a high neckline; no bare arms or shoulders. She wears a neat hijab that fully covers her hair, ears and neck, the same in every frame." | The positive halves are good. "no bare arms or shoulders" adds "bare arms/shoulders" tokens. The hijab and outfit have no colour or fabric, so they vary between shots. | "Loose long-sleeved [colour] blouse, cuffs at the wrists, high neckline; [colour] jersey hijab covering her hair, ears and neck." Better still, put it in the persona image. |
| "No text overlays, no captions. Vertical 9:16." | Fine, and B1 endorses this form. | Use B1's own wording: "Keep it subtitle-free, no logo or watermark." Put 9:16 in the request `ratio`, and optionally the first line. |
| Token "image 1" (person shots) vs "@image1" (product shot) | Inconsistent. B4 wants `@Image N (noun)`. | Have the provider adapter emit `@Image 1 (the perfume bottle)`. |
| Smell shot keeps the full product block (≈700 chars on cap and size) | The product is not in frame. The words are wasted and may invite the bottle into frame. | Drop product lines on product-absent shots. Consider sending no product image (inference). |

**Why the smell shot still worked:** it has a single, physically simple beat that starts mid-motion ("wrist already rising … cut on the action"), and the hands are fully specified ("With empty hands"). That is exactly the pattern to use everywhere.

---

## 3. Proposed rewrites (target 90–140 words, ≈600–900 characters)

Assumptions: omni-reference mode. `@Image 1` is the in-use (uncapped) product photo. `@Image 2` is a trusted Seedream head-and-shoulders portrait of the creator in her hijab. `generate_audio: false` and `ratio: 9:16` are set on the request. If there is no persona image, replace the `@Image 2` sentence with the bracketed fixed description, used **verbatim in every shot**.

### Spray shot (≈125 words)

```
@Image 2 (the woman) is the creator; keep her face exactly. @Image 1 (the perfume bottle) is the product; keep its shape, colours, logo and label exactly, a bottle about the height of her hand.
[No persona image: A woman in her late twenties with a soft oval face, thick dark brows, brown eyes and light-olive skin, wearing a dusty-rose jersey hijab covering her hair, ears and neck, and a loose cream long-sleeved blouse with a high neckline.]
Vertical phone video, medium shot, filmed handheld by a friend in her bedroom; soft daylight from a window on her left, a wooden dresser behind her.
She holds the bottle in her right hand at chest level, her left hand open, palm up, sleeve cuff at the wrist. She presses the nozzle once, a light mist onto her inner left wrist, then sets the bottle on the dresser and lets go. A small closed-mouth smile.
Handheld, slight natural sway, one continuous take. True-to-life colours, natural skin texture with visible pores. She is silent, lips gently closed. Keep it subtitle-free, no logo or watermark.
```

### Smell shot (≈100 words; no product lines, and preferably no product image attached)

```
@Image 2 (the woman) is the creator; keep her face exactly.
[No persona image: the same fixed description as the spray shot, verbatim.]
Vertical phone video, close-up from her shoulders up, handheld by a friend in the same bedroom; soft daylight from a window on her left.
Her hands are empty. Her left wrist is already rising toward her face as the shot begins; she holds the inner wrist just below her nose, breathes in slowly with her eyes half closed, then lowers the wrist and gives a soft closed-mouth smile and a small approving nod.
Handheld, slight natural sway. True-to-life colours, natural skin texture with visible pores. She is silent, lips gently closed. Keep it subtitle-free.
```

### Single-generation alternative for identity (Seedance `Shot N` syntax, 8–10 s)

Write the persona and product header once, then `Shot 1:` (the spray sentences) and `Shot 2: cut to a close-up …` (the smell sentences), then the look and constraint lines once. The face, hijab and room stay consistent inside one generation. Split the two shots in the editor.

---

## 4. Rules for the prompt composer (`packages/shot-prompts`)

1. **Order.** `[refs: @Image N (noun) + one-clause identity/fidelity]` → `[subject look, only if no persona image]` → `[framing + place + light]` → `[the ONE action, as an ordered chain with body parts, both hands assigned]` → `[camera: one move]` → `[look: 1 sentence]` → `[constraints: 1 sentence]`. Today's `before_scene` block (product, in-use, scale) is too heavy. Keep only the reference-binding clauses there and move everything else after the action.
2. **Length budget.** Seedance: target **≤ 900 characters (~140 words)** per single-beat shot. Hard-fail above 1,400 characters in `guardrail-check`. The official limit is about 1,000 words, but we are a single 5 s beat with references attached. Kling: ≤ 1,000 characters in the prompt, with negatives in the separate field. Veo: ≤ 1,000 characters.
3. **Say each concept once.** The composer should dedupe camera, light and action across the scene fields and the Guardrails. Scene text owns the action, place and light. Guardrails own the reference binding, modesty and silence. Nothing else gets a second copy.
4. **Guardrail disposition:**

   | Guardrail | Disposition |
   |---|---|
   | `product_reference` / `start_frame` | Keep, rewritten as `@Image 1 (the <product noun>)…; keep its shape, colours, logo and label exactly.` Omit on shots where the product is not in frame (smell, reaction-only). |
   | `in_use_reference` | **Drop from the video prompt.** The image carries the state. Keep it only in the gpt-image/Seedream edit prompt that *makes* the in-use image, where naming the removed part is necessary. Never name removed parts (cap, lid, seal) in a video prompt. |
   | `scale_anchor` | Keep, shortened to one clause ("about the height of her hand"). Drop volume. Keep the dimensions only in the product description. |
   | `person_reference` | Primary route: a trusted Seedream persona as `@Image 2`, placed second, head-only crop. |
   | `person_description` | Fallback only. Require **concrete** fields (age band, face shape, brows, eyes, skin tone, hijab colour and fabric, top colour), frozen per Character and emitted verbatim in every shot. "An ordinary real person" alone should fail the check. |
   | `realism` | **Rewrite positively:** "Vertical phone video, handheld by a friend … true-to-life colours, natural skin texture with visible pores." Remove every "not/no" and every mention of cinematic/studio/commercial/ring light/bokeh/beauty filter. The place and window light come from the scene fields, and the composer should require a named place on every person or hands shot. |
   | `no_speaking` | Rewrite to one positive sentence: "She is silent, lips gently closed; she reacts with her eyes and a closed-mouth smile." `generate_audio: false` stays on the request. |
   | `simple_physics` | **Drop from prompt text.** Enforce it structurally: one action verb chain per shot (a shot-field validator), and the second hand's state must be specified. |
   | `modesty` / `hijab` | Keep, positive-only ("long sleeves with cuffs at the wrists, high neckline"). Add colour and fabric from the Character so it is stable across shots. Drop the "no bare arms or shoulders" tail. |
   | `hands_only` | Positive: "Framed on her hands and forearms only." |
   | `no_people` (product shots) | Positive: "The bottle alone on the surface." |
   | `playbook` banned motions | **Keep them as validators (banned-motion.ts), not prompt text.** Only emit a positive geometry line that fits *this* shot's action ("nozzle pointing down at her wrist, bottle at chest level"). Never emit face-related rules into a shot whose action does not involve the face. |
   | `format` | B1's wording: "Keep it subtitle-free, no logo or watermark." Aspect ratio goes in the request. |

5. **Reference token syntax per provider.** ModelArk/EvoLink: `@Image N (noun)`, with a noun always right after the tag (B4). fal: `@Image1` (P10). Veo: reference images of type `asset` (up to 3) plus plain words. Kling: Elements / `@element` (**UNVERIFIED** exact syntax).
6. **Camera vocabulary.** Allow-list for person/hands shots: `handheld`, `slight natural sway`, `fixed shot`, `quick push-in`, `cut to close-up`, `medium shot`, `close-up`. Deny-list for UGC: `orbit`, `glide`, `dolly`, `smooth`, `slow motion`, `cinematic`, `rack focus`. Enforce one move per shot.
7. **Cut on action by default.** Every hands or person shot's action sentence should start mid-motion ("is already …" / "as the shot begins").
8. **Identity plumbing, above the prompt.**
   - Prefer the persona image (trusted Seedream) → `@Image 2` on every person shot.
   - Otherwise chain the last frame into the next `first_frame`, where the provider trusts its own output.
   - Otherwise generate multi-beat shots together with `Shot 1 / Shot 2`.
   - First-frame mode and omni-reference are exclusive on ModelArk (B3), so choose per shot. Use first frame when face + product + room are already correct in a trusted still; its prompt is **motion-only** (~50–80 words).
9. **Per-model differences:**

   | | Seedance 2.0 / Mini (ModelArk, EvoLink) | Kling 3.x | Veo 3.1 |
   |---|---|---|---|
   | Negatives | No field. At most one generic clause (subtitles, logo, watermark, twin). No scene objects. | `negative_prompt` field, up to 2,500 chars (P13). Move artefact negatives there as plain nouns: "morphing, extra fingers, duplicate bottle, text, watermark". Still don't name the cap. | Vertex `negativePrompt`: plain nouns, no "no" (G1). The Gemini API field list may differ (**UNVERIFIED**). |
   | Multi-shot | `Shot 1:` labels, no strict timecodes (B1) | Labelled shots, up to 6 per output (K1) | Single shot per clip. Extend or chain frames. |
   | Identity | Trusted persona image / asset library (B5) | Elements binding (K1) | Up to 3 `asset` reference images |
   | I2V prompt | Motion only | "How the scene evolves from the image" (K1) | Motion + camera + audio |

10. **Iteration discipline.** Change one variable per re-render (P7, B1 FAQ). Log prompt length and negation count with every render, so the owner's acceptance tests can correlate them with failures.

---

## 5. Unverified claims

- P6: a 3,000-character hard cap and "the first 20–30 words carry the most weight". Neither appears in B1–B3. The official limit is about 500 Chinese characters or 1,000 English words.
- That naming an unwanted object *raises* its probability **in Seedance** is shown for image models (R1) and asserted for Veo by secondary sources. It is not tested by ByteDance. Our cap result is one data point, not proof.
- That attaching the product image on a product-absent shot pulls the product into frame is my inference.
- That ModelArk's trust extends to Seedance *last frames* is stated in `seedance-real-person-routes.md`. I did not re-read the scope table in B5 (it renders as an image or table I could not extract).
- The Seedance 2.5 timestamp support comes from the ModelArk navigation and search snippets, not from reading the 2.5 guide (the page did not render).
- The exact Kling Elements prompt syntax, and whether the Gemini API (as opposed to Vertex) exposes `negativePrompt` for Veo 3.1.
- The hijab phrasing comes from fashion-image tools, not from video-model documentation.
- P3's "90%+ first-try shippable" figure for Seedance UGC is a vendor claim.
- P12's publication date is unclear. Its prompt-length figures (100–150 words for UGC) are illustrative only.
