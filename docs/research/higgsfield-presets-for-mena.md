# Higgsfield presets: what to port for MENA Voice-over Shorts

Research date: 2026-09-24. All sources below were checked on that date. Scope: Higgsfield's presets, templates, effects and apps for short-form vertical video, judged against our audio-first Voice-over Short model ([ADR 0001](../adr/0001-audio-first-arabic-shorts.md)), the Preset / Modesty Default / Qualified Preset vocabulary in [`CONTEXT.md`](../../CONTEXT.md), and our shot kinds (`product`, `hands`, `person` in `PresetDefinition.shotKinds`).

Descriptions are summarised in my own words. Higgsfield's pages are marketing pages; any claim about quality (lip sync, languages) is theirs, not verified by us.

## Sources

| # | Source | Kind | Checked |
|---|---|---|---|
| S1 | [higgsfield.ai home](https://higgsfield.ai) | primary | 2026-09-24 |
| S2 | [Apps directory](https://higgsfield.ai/apps) | primary | 2026-09-24 |
| S3 | [Ads & Products apps](https://higgsfield.ai/apps/ads-products) | primary | 2026-09-24 |
| S4 | [Camera Controls](https://higgsfield.ai/camera-controls) | primary | 2026-09-24 |
| S5 | [Visual Effects gallery](https://higgsfield.ai/effects) | primary | 2026-09-24 |
| S6 | [Changelog](https://higgsfield.ai/creator-hub/changelog) | primary | 2026-09-24 |
| S7 | [Marketing Studio intro](https://higgsfield.ai/marketing-studio-intro) | primary | 2026-09-24 |
| S8 | [Blog: Meet the New Marketing Studio](https://higgsfield.ai/blog/new-marketing-studio-higgsfield) (2026-08-18) | primary | 2026-09-24 |
| S9 | [AI Ad Generator page](https://higgsfield.ai/ai-ad-generator) | primary | 2026-09-24 |
| S10 | [Blog: How to Make AI UGC Videos](https://higgsfield.ai/blog/how-to-make-ai-ugc-videos) (2026-08-20) | primary | 2026-09-24 |
| S11 | [Blog: 10 AI product video formats](https://higgsfield.ai/blog/Product-Videos-TikTok-Reels-Without-Filming) (2026-06-10, mod. 08-28) | primary | 2026-09-24 |
| S12 | [Blog: Viral Presets](https://higgsfield.ai/blog/how-to-make-viral-videos-viral-presets) (2026-08-14) | primary | 2026-09-24 |
| S13 | [Blog: LipSync videos](https://higgsfield.ai/blog/make-ai-lipsync-videos) (2026-07-07) | primary | 2026-09-24 |
| S14 | [AI Talking Avatar page](https://higgsfield.ai/ai-talking-avatar) | primary | 2026-09-24 |
| S15 | [Ad Multiplier page](https://higgsfield.ai/ad-multiplier); [launch post on X](https://x.com/higgsfield/status/2092349666113527903) | primary | 2026-09-24 |
| S16 | [AI Commercial Generator page](https://higgsfield.ai/ai-commercial-generator) | primary | 2026-09-24 |
| S17 | Soul ID: [Higgsfield blog](https://higgsfield.ai/blog/sould-id-best-character-consistency), [Soul 2.0 intro](https://higgsfield.ai/soul-intro) (via search snippets) | primary | 2026-09-24 |
| S18 | Draw-to-Video / Product Placement / Sketch-to-Video: search-result summaries of Higgsfield and third-party pages ([videoweb.ai](https://videoweb.ai/blog/detail/How-to-Use-Draw-to-Video-with-Higgsfield-AI-on-VideoWeb-fbe04abcd554/), [gaga.art](https://gaga.art/blog/higgsfield-ai/)) | secondary | 2026-09-24 |
| S19 | TechCrunch: [$1.3B valuation (2026-01-15)](https://techcrunch.com/2026/01/15/ai-video-startup-higgsfield-founded-by-ex-snap-exec-lands-1-3b-valuation/), [$400M Series B (2026-08-17)](https://techcrunch.com/2026/08/17/higgsfield-raises-400m-series-b-quadrupling-its-valuation-in-8-months-to-5-4b/) | reputable coverage | 2026-09-24 |
| S20 | [Miracamp: 13 viral presets](https://www.miracamp.com/learn/video-editing/new-higgsfield-viral-presets) | secondary | 2026-09-24 |

Context from S19: Higgsfield positions Marketing Studio as its ads product, next to Cinema Studio for film. Its video engine for ads is Seedance 2.0 with native audio and lip sync in one pass (S9) — exactly the path ADR 0001 rejected for Arabic.

## Verdict key

- **PORT** — fits a Voice-over Short now: visuals silent, Arabic voice and Music Bed laid over, shots are `product`, `hands`, or a silent `person`.
- **PORT-LATER** — needs a capability we lack (named).
- **SKIP** — culturally unsuitable for MENA ads or off-strategy (reason given).

## 1–2. Catalogue with verdicts

### Marketing Studio modes (ads, video)

| Name | What it does | Category | Source | Verdict |
|---|---|---|---|---|
| Hyper Motion | Product-only CGI commercial: fast cuts, dynamic camera, premium lighting; the most energetic paid-social mode | template | S7, S8, S9, S10 | **PORT** — product shots only; a faster-cut sibling of Product Hero |
| Product Review | Hands-on close-up demo of the product with voice-over | template | S7, S9 | **PORT** — this is our Hands-on; borrow its pacing and closing pull-back |
| Unboxing | Packaging-first slow reveal, then first touch and a reaction | template | S7, S9, S10, S11 | **PORT** — hands + product; the "reaction" beat as a silent face (our Reaction) |
| TV Spot | Cinematic narrative ad with broadcast production value | template | S7, S9 | **PORT** — mixed shots under an MSA or dialect voice-over; people must stay silent |
| Tutorial | Step-by-step usage demo on camera | template | S7, S9 | **PORT** as hands-only (step beats cut to the Script's steps); on-camera presenter version is PORT-LATER (talking heads) |
| UGC (Talking Head) | Creator talking to camera recommending the product | template | S7, S9, S10 | **PORT-LATER** — needs Talking-head Shorts (Arabic lip sync bake-off) |
| UGC Virtual Try-On | At-home creator tries on clothing/accessory | template | S7, S9 | **PORT-LATER** — needs garment-accurate try-on on a saved character; silent version possible, but body-focused try-on clashes with Modesty Default unless redesigned (see §4) |
| Pro Virtual Try-On | Street-style editorial try-on with tracking shots | template | S7, S9 | **PORT-LATER / partly SKIP** — street editorial with fitted clothing is off for Gulf; a modest abaya version is §4 |
| Wild Card | AI picks the creative concept, user approves | template | S7, S9 | **SKIP for now** — unpredictable concepts can't be a Qualified Preset (native review per Preset–Dialect); revisit as a brief-to-Preset recommender |
| UGC styles: Shopping, At home, Delivery, Review, Try-on, Unboxing, Tutorial, Before/after | Eight creator-style UGC scenarios | template | S10 | Delivery, Unboxing, Before/after, Review (hands) → **PORT**; At home/Shopping as silent person → **PORT** with Kling/Veo; Try-on → PORT-LATER |
| UGC formats: Faceless / Talking Head / Silent | How the creator appears | template option | S8 | Faceless and Silent → **PORT** (they *are* Voice-over Shorts); Talking Head → **PORT-LATER** |
| Motion: 2D Product Motion, Mixed Media, Motion Design, Typography, Dark minimalism | Product/logo/UI animated graphics, no people | template | S8, S10 | **PORT-LATER** — needs a motion-graphics/Arabic typography renderer (RTL kinetic text); good fit for e-commerce/apps once built |
| Product Shots, Ads, Marketplace, Posters | Static images (packshot, Meta/Google ad sizes, listing images, editable posters) | app (image) | S8 | **SKIP** — off-strategy (we make Shorts); Packshot as end card is covered below |
| URL-to-Ad / Click to Ad | Paste a product link; name, description and images extracted into an ad | app | S2, S3, S9 | **PORT** as an input feature — auto-fill Product Details from a Salla/Zid/Shopify/Noon link; Script still sells only those facts |
| 40–100+ avatars (Soul 2.0) | Presenter library for With-Model shots and UGC | avatar | S7, S9 | **PORT** as a modest, MENA-cast character library for silent person shots |

### Ads & Products apps (single-effect product clips)

| Name | What it does | Category | Source | Verdict |
|---|---|---|---|---|
| Bullet Time White | Camera spins round the product on seamless white | effect/app | S2, S3 | **PORT** — ideal Product Hero shot variant (perfume, electronics) |
| Bullet Time Scene | Same spin with an adaptive themed background | effect/app | S3 | **PORT** — backgrounds can be seasonal (Ramadan lanterns, desert dusk) |
| Bullet Time Splash | Product "explodes" in frozen splash/particles | effect/app | S3 | **PORT** — skincare, drinks (non-alcoholic), food; avoid anything reading as alcohol |
| Macro Scene / Macroshot Product | Extreme close-up details in an adaptive environment | effect/app | S3 | **PORT** — texture shots for oud, fabric, gold, skincare |
| Packshot | Polished closing frame for an ad | effect/app | S3 | **PORT** — end-card shot for every Preset (logo/price in Captions) |
| ASMR Classic / ASMR Host | Whispering ASMR scene; photo turned into ASMR studio | app | S3 | **PORT-LATER** for Host (a person whispering = lip sync); Classic as sound design is **SKIP** — our audio is the Arabic voice |
| ASMR Add-On | Insert product into an ASMR video | app | S3 | **PORT** (visual only) — tactile hands + product close-ups; audio is ours, whisper-style Delivery Tag `[softly]` |
| Giant Product | Product as giant over a city skyline | effect/app | S3 | **PORT** — strong for launches; skyline can be Riyadh/Dubai/Doha |
| Billboard Ad / Truck Ad | Brand on a billboard / moving truck | effect/app | S2, S3 | **PORT** — cheap "we're everywhere" hook; Sheikh Zayed Road-style billboards |
| Fridge Ad | Product shown inside a fridge display | effect/app | S3 | **PORT** — food & beverage, Ramadan iftar drinks |
| Magic Button | Product in a whimsical magical scene | effect/app | S3 | **PORT** (low priority) — kids/gifting |
| Chameleon | Chameleon shifts colour to match product | effect/app | S3 | **PORT** (low priority) — novelty hook |
| Kick Ad | Product "kicks" the competition | effect/app | S3 | **SKIP** — comparative/aggressive ads carry legal risk in KSA/UAE advertising rules; tone off for family brands |
| Volcano Ad | Product in front of an erupting volcano | effect/app | S3 | **SKIP** — low relevance; disaster imagery |
| Graffiti Ad | Product as street graffiti | effect/app | S3 | **SKIP** for Gulf default (vandalism connotation); possible for Levant streetwear |
| Poster | Product as bold poster | app (image) | S3 | **SKIP** — static |

### Camera-motion presets (S4, 65 listed)

| Name(s) | What it does | Category | Verdict |
|---|---|---|---|
| Dolly In/Out/Left/Right, Super Dolly In/Out, Double Dolly | Tracking moves toward/away/alongside the subject | camera motion | **PORT** — as a per-shot `camera` field in Preset data; prompt-level on Seedance/Kling/Veo |
| 360 Orbit, Arc Left/Right, Lazy Susan, 3D Rotation | Orbit / turntable around subject | camera motion | **PORT** — core product moves |
| Crash/Rapid Zoom In/Out, YoYo Zoom, Zoom In/Out | Zoom-based punches | camera motion | **PORT** — hook shots (first 1–2 s) |
| Crane/Jib Up/Down, Crane Over The Head, Overhead | Vertical/overhead moves | camera motion | **PORT** — food flat-lays, majlis tables, real estate |
| Aerial Pullback, FPV Drone, Hyperlapse, Timelapse Landscape | Wide reveals and drone flights | camera motion | **PORT** — real estate, tourism, cafés |
| Car Grip, Car Chasing, Road Rush, Buckle Up | Vehicle-mounted cinematography | camera motion | **PORT** — cars vertical (a big Gulf category) |
| Through Object In/Out, Flying Cam Transition | Camera passes through objects/spaces | camera motion | **PORT** — transitions between shots; real estate walk-throughs |
| Focus Change, Static, Handheld, Wiggle, Tilt, Pan, Whip Pan, Dutch Angle, Fisheye, Low Shutter, Object POV, Robo Arm | Basic grammar and lens looks | camera motion | **PORT** — Handheld/Object POV for UGC feel, Robo Arm for product |
| Hero Cam, Glam, Head Tracking, Snorricam, BTS | Person-centred cinematic moves | camera motion | **PORT** for silent person shots with modest styling; Glam needs care (§5) |
| Eating Zoom | Close-up on eating | camera motion | **PORT** — food/restaurants; food only, not mouth (see Mouth In) |
| Mouth In, Eyes In | Zoom to mouth / eyes | camera motion | Mouth In **SKIP** (mouth draws attention to non-matching speech); Eyes In **PORT** for oud/perfume/abaya-niqab-friendly beauty (eyes-only framing is culturally natural in Gulf beauty ads) |
| Timelapse Glam, Timelapse Human | Sped-up person styling / action | camera motion | **PORT-LATER** — body-focused styling timelapse needs modesty-safe redesign |

### Viral effects and presets (S1, S5, S12, S20)

| Name(s) | What it does | Category | Verdict |
|---|---|---|---|
| Earth Zoom (Out) | Camera falls from orbit to street level | effect | **PORT** — city launch / "now in Riyadh" hook, real estate, delivery apps |
| Bullet Time / Frozen in Motion / Stop World | Freeze-frame with orbit | effect | **PORT** — product or silent person |
| World Morphing, Lidar Transition, Architecture Wave, Studio Slide, Windows, Canvas, Scrapbook Collage, Comic, Palette, Cutout, Particles | Stylised transitions and looks | effect | **PORT** (selectively) as transition/look options between shots; low priority |
| Clones, Infinite Clones, Selfception, Vanish, Levitation, Floating Fall, High Flip, Moonwalk, Monster Dab, Mighty Fighter, Superstar, Act Natural, Wild Ride, Lacewalker, Street Colossus, Incline, Tracking, Blue Depth | Character stunts and identity effects | effect | **SKIP** — creator-selfie entertainment, not product ads; many are dance/stunt-coded |
| Burning Man, Melting, Set on Fire, Explosion, Head/Building Explosion, Disintegration, Black Tears, Powder Explosion, Smash and Grab | Destruction/body-horror VFX | effect | **SKIP** — violence/horror tone unfit for family-friendly MENA ads (Powder Explosion on product only could be a Bullet Time Splash variant) |
| LSD | Psychedelic look | effect | **SKIP** — drug connotation |
| Living Paintings: Pearl Earring, Monet Muse, Fallen Angel, Cyclope, Argus, Lost in a Book | You placed inside a Western painting | viral preset | **SKIP** — Fallen Angel/Cyclope feature nudity or religious-mythic imagery; others off-strategy. Idea worth adapting: Arabic calligraphy/miniature "living art" (§4) |
| Impossible Rides: Dolphin/Penguin/Puffin Ride, Skatedog, Pigeons | Absurd animal rides | viral preset | **SKIP** — entertainment; dogs are a mixed signal in Gulf ads |
| Agamemnon | Subject steps out of a cinema screen as warriors storm in | viral preset | **SKIP** — war imagery |
| Boarding Pass, Fairytale Castle | Travel/fairytale scenes | effect | **PORT-LATER** low priority — travel agencies, kids |
| Effects 2.0 in ChatGPT | Viral effects applied to uploaded photos via ChatGPT plugin (2026-09-10) | app/integration | **SKIP** — distribution channel, not a format |

### Other apps and platform features

| Name | What it does | Category | Source | Verdict |
|---|---|---|---|---|
| 10 product formats: Unboxing Surprise, Before & After, Day in the Life, POV Walkthrough, Reaction Cut, Trend Remix, ASMR Product, Streamer Highlight, Epic Fail to Hero, Minimal Product Loop | Proven TikTok/Reels product formats, each mapped to a preset | template | S11 | Unboxing, Before & After, POV Walkthrough, Reaction Cut, ASMR Product, Minimal Loop, Epic Fail→Hero → **PORT**; Day in the Life → PORT (silent person); Trend Remix → **SKIP** in Gulf default (beat-synced music-heavy); Streamer Highlight → **SKIP** (gaming-streamer talking) |
| Soul ID / Soul 2.0 | Train a reusable character from ~20 photos; keeps the face across image and video models | avatar | S17 | **PORT** (already partly have saved characters) — strengthen consistency across Kling/Veo shots |
| LipSync Studio (Veo 3, Kling 2.6, Wan 2.5 Speak, Kling Avatars 2.0; scenes such as Selfie, Podcast, Car Talking) | Image/video + audio → talking performance | avatar | S13 | **PORT-LATER** — Talking-head Shorts; Arabic not listed |
| AI Talking Avatar (script→presenter, 74+ languages, multi-speaker) | Presenter from script | avatar | S14 | **PORT-LATER** — Arabic not listed; dialect quality unknown |
| Ad Multiplier | Clone a winning Meta ad into variants swapping characters, outfits, locations, objects; keeps cut/pacing/audio; optional synthetic dub (launched 2026-08-25) | app | S6, S15 | **PORT** (strong) — our version: keep voice-over + cut, swap product/character/location/dialect |
| Hook variants / AI Commercial Generator | Multiple opening hooks, resizing, seasonal promos, 140+ language dubbing claimed | app | S15, S16 | **PORT** hook variants (new first shot + first Script line, rest reused); dubbing **SKIP** (our promise is native dialect, not dubbing) |
| Virality Predictor | Scores the hook before posting | app | S2 | **PORT-LATER** — needs MENA engagement data |
| Shots / Angles 2.0 | 9 shots or any angle from one image | app | S2 | **PORT** — generate product/character reference angles before rendering shots |
| Transitions | Seamless transitions between shots | app | S2 | **PORT** — stitching layer between our clips |
| Draw-to-Video / Product Placement / Sketch-to-Video | Drag a product into a frame, sketch motion arrows | app | S18 | **PORT-LATER** — nice editor UX; not needed for Presets |
| Recast / Character Swap / Face Swap / Video Face Swap | Replace a person in image/video | app | S2 | **SKIP** — impersonation/consent risk; Ad Multiplier covers the legitimate use |
| AI Stylist / Outfit Swap / ClipCut / Urban Cuts | Outfit try-on reels, beat-synced | app | S2 | **PORT-LATER** as modest fashion (§4); Urban Cuts **SKIP** (music-driven) |
| Skin Enhancer / Relight / Headshot / Background Remover | Image utilities | app | S2 | **SKIP** — utilities, off-strategy |
| Shorts Studio (44 restyle presets, 2026-06-29) | Restyle existing footage keeping motion | app | S6 | **PORT-LATER** — "restyle your own phone video" for cafés/shops; needs video-to-video path |
| Faceless Studio (Education, History, Kids, Storytelling; 2026-08-20) | Animated faceless explainers | app | S6 | **SKIP** for now — content creators, not advertisers |
| Presets for After Effects / AI Motion Designer (2026-09-11/15) | Motion graphics in AE | app | S6 | **SKIP** — pro-tool integration |
| Games & Characters, Trending Templates (Game Dump, Skibidi, Mukbang, K-pop Idol, On Fire, Plushies, Micro-Beasts…) | Meme/selfie entertainment | template | S2 | **SKIP** — consumer memes; Mukbang/Idol off-norm for Gulf ads |
| Higgsfield MCP / Supercomputer / ChatGPT plugin | Agent integrations | platform | S1, S15 | Not a Preset; note that Higgsfield sells ads through Claude/ChatGPT agents, as we do |

## 3. Ranked shortlist to build next

Shot lengths below are clip lengths the orchestrator picks; the total always follows the voiced Script (ADR 0001).

### 1. Unboxing (Higgsfield: Unboxing / Unpacking / "Unboxing Surprise")

- **Why MENA:** gifting culture — Eid, Ramadan hampers, Mother's Day (21 Mar), Graduation, weddings; e-commerce/Noon/Amazon.ae sellers, perfume gift sets, electronics, dates/sweets boxes. White Friday.
- **Shots:** hands 3–4 s (box/gift wrap on majlis table or bed, top-down) → hands 3–5 s (lid lifts, tissue parts) → product 3–5 s (macro reveal, slow dolly in) → optional silent person 2–3 s (reaction, from Reaction preset) → product 2–3 s Packshot.
- **Product Interaction:** opening, lifting out, first touch/spray; the reveal beat lands on the product name in the Script.
- **Modesty:** sleeved wrists, no nail-polish-heavy closeups by default for Gulf (neutral option); reaction person follows Modesty Default (hijab for Gulf women).
- **Model:** Seedance (EvoLink) for hands/product; Kling O3 Pro / Veo 3.1 for the reaction face.
- **Effort:** S — composes existing Hands-on + Reaction shot kinds; new prompts and a Packshot end shot.

### 2. Bullet Time / 360 Product Spin (Higgsfield: Bullet Time White/Scene/Splash, 360 Orbit, Lazy Susan)

- **Why MENA:** the best-looking thing you can do with one product photo — oud and perfume bottles, watches, gold/jewellery, phones, sneakers, skincare jars. Seasonal backgrounds turn it into a campaign asset (Ramadan lanterns, Eid, National Day green/red-white-black).
- **Shots:** product 4–5 s (orbit on white or themed set) → product 3–4 s (macro detail: cap, engraving, texture) → product 3–5 s (splash/particle variant or slow dolly out) → product 2 s Packshot.
- **Product Interaction:** none (product-only); optional a hand placing it at the start.
- **Modesty:** no people by default; trivially safe.
- **Model:** Seedance (EvoLink).
- **Effort:** S — a Product Hero variant as data: new camera fields plus a `background theme` input.

### 3. Before & After (Higgsfield: Before/after UGC style, Before & After Transformation)

- **Why MENA:** skincare/haircare (with care, see §5), cleaning products, home services, car detailing, furniture/interiors, restaurant fit-outs, real-estate renovation, laundry/abaya care.
- **Shots:** product/hands 3–4 s "before" (dull surface, stained fabric, empty room) → hands 3–5 s (applying/using product) → product 3–5 s "after" (same framing, match cut) → product 2–3 s Packshot.
- **Product Interaction:** application or use that causes the change.
- **Modesty:** avoid before/after on faces and bodies by default (claim risk + body focus); hands and objects only. Skin claims only on hands/forearm-free framing.
- **Model:** Seedance for all; match-cut consistency is the hard part (same seed/reference image for before and after).
- **Effort:** M — needs a paired-frame shot (same composition twice) in the shot planner.

### 4. Ad Multiplier for MENA (Higgsfield: Ad Multiplier + hook variants)

- **Why MENA:** one brand sells into KSA, UAE, Kuwait, Jordan, Egypt; advertisers need Gulf vs Levantine vs Egyptian versions, male vs female voice, hijab vs no-hijab cast, and seasonal re-skins, all from one winning Short.
- **Shots:** reuses the source Short's shot plan; swaps character (saved characters), location (majlis/café/street), Voice/Dialect (re-voiced by an Approved Voice, not dubbed), and the first shot + first Script line for hook variants.
- **Product Interaction:** inherits.
- **Modesty:** each variant re-applies Modesty Default for its Dialect (Gulf variants get hijab on by default).
- **Model:** same per shot kind as the source.
- **Effort:** M — orchestrator feature over existing Presets (clone Draft, change inputs, re-render changed shots only). Each variant's Preset–Dialect pair must already be Qualified.

### 5. Hyper Motion / TV Spot product commercial

- **Why MENA:** premium brands (perfume houses, luxury abaya lines, cars, electronics, real estate) want "TV-quality" vertical spots; MSA or Gulf voice-over with a Music Bed fits cinema-style ads.
- **Shots:** product 1.5–2 s crash-zoom hook → product 3–4 s orbit → product 2–3 s macro → optional hands 3 s → product 2–3 s hero dolly out → Packshot 2 s. Faster cut rhythm than Product Hero (clips can be generated at 5 s and trimmed).
- **Product Interaction:** minimal; drama through light and camera.
- **Modesty:** product-only; if a person is added, silent and Modesty Default.
- **Model:** Seedance; Veo 3.1 for hero lighting on cars/real estate.
- **Effort:** S–M — Product Hero with a "pace: fast" parameter and trim-to-beat; the Music Bed must allow energetic but vocal-free tracks.

### 6. POV Walkthrough (Higgsfield: First-Person POV with Product, FPV Drone, Through Object)

- **Why MENA:** real estate (the biggest paid-social spender in Dubai/Riyadh), hotels, cafés/restaurants, showrooms, malls, car interiors.
- **Shots:** POV 3–5 s (door opens / arrive at entrance) → POV 3–5 s (through-object into living room / café counter) → hands 2–4 s (touching marble, picking up cup, keys) → wide 3–5 s (aerial pullback / balcony view) → end card.
- **Product Interaction:** first-person hands open, touch, hold.
- **Modesty:** hands sleeved; no people in frame by default (avoid mixed-gender crowd scenes).
- **Model:** Veo 3.1 / Kling for spaces (better architecture coherence, to test); Seedance for hands.
- **Effort:** M — needs a user-uploaded location image or listing photos as references, and new camera vocabulary.

### 7. Day in the Life / Delivery (silent person + product)

- **Why MENA:** delivery apps (Talabat, HungerStation, Jahez-style), cafés, gyms (sex-segregated), family products; Ramadan "iftar prep" routine.
- **Shots:** person 3–4 s (silent, doorstep receiving bag / arriving at café) → hands 3–4 s (unpacking food, pouring gahwa) → product 3–4 s (food macro, Eating Zoom on food) → person 2–3 s (silent satisfied reaction) → end card.
- **Product Interaction:** receive, open, serve.
- **Modesty:** Modesty Default; same-gender or family groupings only; no couple scenes by default.
- **Model:** Kling O3 Pro / Veo 3.1 for person; Seedance for hands/product (hijab-wearing women must go to Kling/Veo).
- **Effort:** M — mixes all three shot kinds and needs saved-character continuity across 2 person shots.

### 8. Giant Product / Billboard / Earth Zoom launch hook

- **Why MENA:** launches and openings ("now in Riyadh", new branch), National Day and big-sale moments; skyline recognition (Burj Khalifa, Kingdom Centre) is a strong regional hook.
- **Shots:** effect 3–5 s (Earth Zoom into city / product as giant on skyline / billboard) → product 3–5 s (Product Hero shot) → end card.
- **Product Interaction:** none.
- **Modesty:** no people.
- **Model:** Veo 3.1 (scale and cityscapes) — test; Seedance for product.
- **Effort:** S as a "hook shot" option usable at the front of any Preset rather than a full Preset. Landmark likeness/trademark use needs a check.

## 4. What MENA needs that Higgsfield lacks

Nothing in Higgsfield's catalogue (as of 2026-09-24) is regional or seasonal for the Arab world, and Arabic is not listed on its avatar/lip-sync pages. Candidate Presets or options:

1. **Seasonal themes as a Preset input**, not separate Presets: Ramadan (lanterns/fanous, crescent, iftar table at golden hour, suhoor blue hour), Eid al-Fitr/al-Adha (gift wrapping, new clothes, maamoul/sweets), White Friday / 11.11, Saudi National Day (23 Sep) / Founding Day (22 Feb), UAE National Day (2 Dec), Back to School, summer travel. Themes set background, props, colour grade, and Script tone; they must avoid religious-sacred imagery on commercial products (no Kaaba, Quran pages, or mosque interiors as backdrops).
2. **Oud / bakhoor ritual:** hands light charcoal, place bakhoor in a mabkhara, smoke curls, wafting over an abaya/ghutra or into a majlis; perfume layering (oil then spray). Hands + product; Targeted Diacritics already cover note names (عود، مسك، عنبر).
3. **Majlis hospitality / gahwa pour:** dallah pour into finjan, dates on a tray, bakhoor passing — for coffee brands, dates, sweets, home fragrance, real estate "the majlis you'll host in". Hands only; right hand serving.
4. **Modest fashion try-on without body focus:** abaya/jalabiya/kaftan shown on a hanger or mannequin spin, fabric macro (embroidery, crepe drape), hands fastening a sleeve cuff, a silent full-length walk with no body-contour camera moves (no Glam timelapse, no low angles, no slow pans up the body); hijab styling shown on the model with Modesty Default. Replaces Higgsfield's Try-On modes.
5. **Family-framed Reaction:** reactions by same-gender friends, mother/daughter, father/son; never mixed-gender romance.
6. **Arabic kinetic typography / calligraphy end cards:** RTL animated headline and offer (سعر، خصم) — Higgsfield's Motion/Typography modes are Latin-centric. Could lean on our Captions renderer.
7. **Restaurant menu hero:** overhead crane over a mansaf/kabsa/shawarma spread, steam, Eating Zoom on food only, hands tearing bread — for cafés/restaurants, Ramadan iftar offers.
8. **Car showroom walkaround (silent):** Car Grip / orbit / interior POV with a Gulf male voice-over; desert road run for SUVs.
9. **Real-estate off-plan reveal:** Earth Zoom → aerial pullback → POV walkthrough → amenities, from renders/listing photos; payment-plan line in Captions.
10. **"Living calligraphy" viral hook** (adaptation of Living Paintings): product emerges from ink calligraphy strokes — culturally rooted, no figurative-art issues.

## 5. Risks and unknowns

- **Unverified quality claims.** Everything here is from Higgsfield's own pages and blogs (S1–S16) plus a few secondary summaries (S18, S20). I did not generate anything on Higgsfield (no sign-in). Preset names and counts change often (camera page says "50+", lists 65; other sources say 70+).
- **Arabic.** None of the talking-avatar, lip-sync or ad pages checked lists Arabic explicitly; one search snippet (from a Higgsfield Audio blog post, not fetched) implies Arabic was "coming soon". Their 74+/140+ language claims are for dubbing and lip sync, which ADR 0001 already found unacceptable for native dialect listeners on the Seedance path.
- **Pages that failed:** several Higgsfield blog URLs returned 404 on fetch (Ads 2.0 launch, "Create Selling Content", catalog automation); Draw-to-Video/Product Placement details come from search summaries only. S11's exact internal preset names (e.g. "Unpacking", "Luxury Ad") may be older Higgsfield preset names now superseded by Marketing Studio modes.
- **Model portability.** Higgsfield's presets run mostly on Seedance 2.0 (S9, S11); our routing sends person shots to Kling O3 Pro / Veo 3.1 because EvoLink Seedance blocks hijab-wearing women. Camera-move reliability on Kling/Veo vs Seedance for moves such as Bullet Time, Through Object and Earth Zoom is untested.
- **Cost.** Fast-cut Presets (Hyper Motion) need more clips per second of audio; each Preset carries its own cost budget, so short clips trimmed from 5 s renders may blow it. Needs a quote per Preset.
- **Cultural judgment calls** (need native Gulf/Levant marketing review, not just Dialect review): Before & After on skin (regulated beauty claims in KSA/UAE), Eyes In framing, nail polish on hands, music intensity of Hyper Motion Music Beds, landmark and national-emblem use on National Days (flag-use rules differ by country), comparative ads (Kick Ad).
- **Legal.** Face swap/character swap and Ad Multiplier-style variants must only use characters the user owns or consented to; landmark likeness and competitor comparison may need legal sign-off per market.
- **Qualification load.** Every new Preset × Dialect pair needs native acceptance before it is offered; 8 Presets × 2 Dialects is 16 review rounds, so prioritise.
