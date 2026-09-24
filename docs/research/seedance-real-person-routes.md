# Seedance and real-looking people: how creators do it, and our legitimate routes

All sources were checked on **2026-09-24**. Summaries are in my own words. Quotes are short and limited to one per source. Anything marked **UNVERIFIED** is a claim from a secondary source, or an inference I could not confirm in primary docs.

Our test results (same date) are the starting point. ModelArk returns `InputImageSensitiveContentDetected.PrivacyInformation` for any photoreal face input, including AI-generated faces. fal returns 422 "likeness". EvoLink accepts the input, but its output moderation blocked 3 of 3 hijab videos. Kling O3 and Veo 3.1 accept the images, but the owner finds their realism poor.

---

## TL;DR: the most promising legitimate routes

1. **ModelArk "trusted model outputs" (cheapest, no approval needed, try first).** ModelArk trusts face-containing images that the **same account** generated with **Seedream 5.0 lite text-to-image** within the last 30 days. It also trusts Seedance videos and their last frames. These can be sent to Seedance 2.0/2.5 as inputs without triggering the real-person input block. For us, that means generating the hijab creator portrait on ModelArk with `seedream-5-0-260128` (alias `seedream-5-0-lite-260128`) text-to-image. We keep the **original file untouched** (store it in BytePlus TOS rather than recompressing it) and pass it to `dreamina-seedance-2-0-260128` or `-2-5-260628` as `reference_image` or `first_frame`. Output moderation still applies.
2. **ModelArk Private Virtual Portrait Library (AIGC asset group).** This is the official home for our own AI-generated characters. The steps: complete BytePlus enterprise verification, turn on "Advanced Creation Rights", sign the virtual-avatar commitment letter in the console, then call `CreateAssetGroup` (GroupType `AIGC`) and `CreateAsset`. BytePlus runs a security review. The approved asset is then referenced as `asset://<id>`. A free "Entry" tier exists: 50 assets, 3 QPM. We must warrant that the avatar is original and "not identical or similar" to any natural person.
3. **ModelArk Private Real-Human Portrait Library (for a real consenting actor).** The actor completes a BytePlus H5 liveness check and authorization. We use `CreateVisualValidateSession` → `GetVisualValidateResult` → `CreateAsset`. Uploaded images are face-matched against the liveness capture. The result is `asset://<id>` in Seedance requests. This is the right route if we hire a real hijabi creator or model and want her likeness.
4. **Not recommended for commercial ads without written permission:** the ModelArk **preset Digital Character Library**. Its terms restrict output to "experience" and internal use.
5. **Avoid:** the "mesh/grid overlay" and similar tricks for defeating the face classifier. They circumvent moderation and break the platform ToS.

---

## 1. What X creators actually use

| Platform | Real/photoreal face as reference? | How | Source |
|---|---|---|---|
| **Dreamina / CapCut** (ByteDance consumer) | Blocked for uploads. A secondary source reports an in-app "record real person" camera scan that registers *your own* face as a verified asset. | Model-layer block. CapCut's launch press cited safeguards against unauthorized likeness use. | TechCrunch 2026-03-26; X post by @alisaqqt noting the "does not support real human faces" label; ZeroLu GitHub guide (**UNVERIFIED** in-app scan) |
| **Higgsfield** | Yes, via **Soul ID**. The user trains an identity from 5 to 20+ photos, it becomes an "Element", and Seedance 2.0/2.5 references it through `@Elements`. | Help page advises training a Soul ID first when the character is a real person. How Higgsfield clears ByteDance's filter is not documented. It may be a partner or trusted-asset arrangement (**UNVERIFIED**). There is no public REST API, only Canvas, MCP and CLI. | higgsfield.ai help center, "How to use Seedance" (modified 2026-09-09) |
| **ComfyUI partner nodes** | Yes, for **verified real people**. You upload a portrait, receive a liveness link (under 1 minute), and get back an Asset ID and Group ID. | This is the BytePlus real-human asset flow, wrapped in a node. | docs.comfy.org "Seedance 2.0 Real Human" |
| **EvoLink** | Advertised as supporting real-human photo references. Account verification is required. The mechanism is not documented. | Our own test: hijab outputs fail output moderation (0/3). | evolink.ai blog "Seedance 2.0 Real Human Video API Guide" |
| **fal.ai** | No for photoreal faces. A third-party PR (2026-09-15) reports rejection even for Seedance's own untouched outputs. Stylized/3D faces pass. | Likeness classifier. | github.com/recoupable/skills PR #145 |
| **Replicate, AtlasCloud** | No private real-person assets. AtlasCloud offers the public character library only. | — | gracech0322-cmd/best-seedance-2-api (2026-07-24, **UNVERIFIED** secondary) |
| **SeeGen AI, PiAPI, MuAPI** | Claimed to support private real-person assets "after review". | Probably built on the BytePlus asset flow (**UNVERIFIED**). | same GitHub comparison |
| **Kie.ai** | Markets "Realistic Human Support". Its page describes "virtual human" creation and gives no mechanism. | **UNVERIFIED** | kie.ai/seedance-2-0 |
| **Runway (Seedance 2.0 integration)** | Coverage conflicts. Some say Runway has lighter moderation. Others say requests still hit the model-layer block. | **UNVERIFIED** | Geeky Gadgets; useapi.net blog 2026-04-15 |

**Circumvention (do not use):** useapi.net (2026-04-15) and several blogs describe overlaying a thin crisscross grid or mesh on the face so that Dreamina's face detector misses it. That deliberately evades a safety control. It is not a legitimate route, and it exposes the owner to ToS termination.

**What this means:** most "real-looking person" Seedance demos on X come from one of three places. Some use **Higgsfield Soul ID Elements**. Some use **AI portraits generated inside the ByteDance ecosystem** (Seedream → Seedance), which is effectively the trusted-output route. The rest use official asset-library routes (ComfyUI or BytePlus real-human verification), or the preset digital characters.

## 2. Official BytePlus ModelArk routes for human likeness

### 2a. Portrait-video overview page (primary)
Source: BytePlus docs, *Create portrait videos with Dreamina Seedance models*, https://docs.byteplus.com/en/docs/ModelArk/2608626.
The page states that Seedance 2.0/2.5 do not accept directly uploaded reference images or videos containing real human faces. It lists three official solutions:
- **Trusted model outputs as input assets.** Trust covers three kinds of output, each for 30 days and only from the same account:
  - Seedance 2.0/2.5 face-containing videos (from 2026-03-11).
  - Their last-frame images (from 2026-04-16).
  - **Seedream 5.0 lite text-to-image** face images (from 2026-04-16).

  The conditions: the file must be original and unedited, from the same account and the ModelArk platform. Compression or forwarding "may invalidate trust verification", so storing to BytePlus TOS is recommended. Trust covers inputs only, and output moderation still applies.
- **Preset digital characters** (`asset://` IDs from the Digital Character Library).
- **Authorized real-person assets** (real-human asset library).

Quote: "Trust applies only to input assets. Output may still fail due to ModelArk security moderation policies."

### 2b. Private Virtual Portrait Library (AIGC)
Source: https://docs.byteplus.com/en/docs/ModelArk/2333565
- Uploaded virtual portraits must be legally owned, **must not resemble any real natural person**, and must contain no unauthorized logos. ModelArk runs a security review before an asset becomes usable.
- The first `CreateAssetGroup` requires signing an authorization letter in the console. `GroupType` defaults to `AIGC`, which is the only supported type.
- `CreateAsset` accepts an optional `Moderation: {Strategy: "Skip"}` to skip "most non-baseline" pre-filter review. The code sample notes that the pre-filter must first be turned off in the console.
- Images: jpeg/png/webp/etc., aspect 0.4–2.5, 300–6000 px, <30 MB. The docs recommend one frontal full-body shot plus one face close-up per group.
- Use it as `asset://<asset_id>` in `content[].image_url.url` with `role: reference_image`. In the prompt, refer to it as "Image 1", never by its asset ID.

Quote: "The asset must not resemble any real human person's portrait".

### 2c. Private Real-Human Portrait Library
Sources: https://docs.byteplus.com/en/docs/ModelArk/2333589 (titled "invited users only") and https://docs.byteplus.com/en/docs/ModelArk/2315856 (console QR flow).
- **API flow:**
  1. `CreateVisualValidateSession` (CallbackURL, ProjectName) returns an `H5Link` and a `BytedToken`.
  2. The end user completes liveness and authorization in the H5 page. The H5 page supports zh/en/zh-Hant only.
  3. The callback returns `resultCode=10000` on success.
  4. `GetVisualValidateResult(BytedToken)` returns the `GroupId`. The token is valid for 30 minutes.
  5. `CreateAsset` then face-matches each upload against the liveness capture. Uploads with more than one face are rejected.
  6. Once the asset status is `Active`, pass `asset://<id>` to Seedance.
- **Console flow:** go to Playground → My assets → Real-human → create a group and set the validity period. This generates a QR code. The actor scans it, logs into their **own BytePlus account**, agrees to the face-processing rules, does liveness, and uploads assets.
- The actor authorizes once. New looks or styling go into the same group without re-verification. Liveness is currently "free for a limited time".

Quote: "Through real person verification, the ownership of portrait rights is secured at the source".

### 2d. Advanced Creation Rights (the gate for 2b and 2c)
Source: https://docs.byteplus.com/en/docs/ModelArk/2377608
- **Prerequisites:** a BytePlus account with **enterprise/organization real-name authentication** (a corporate registration certificate), plus agreement to four documents: the Asset Library Terms (2275639), the Commitment Letter for Virtual Avatar Assets (2275638), the Real Person Verification H5/API Usage Rules, and the Customer Code of Conduct.

| Tier | Price | Real-person verification | Virtual portrait upload | Quota | CreateAsset QPM |
|---|---|---|---|---|---|
| Basic (free) | Free | Console only | No | 50 assets / 50 groups | 3 |
| **Advanced (Entry)** | **Free** | Console + API | Yes | 50 / 50 | 3 |
| Advanced | $14,000/yr or $1,400/mo | Yes | Yes | 1M / 1M | 120 |
| Premium | $42,000/yr or $4,200/mo | Yes | Yes | 5M / 5M | 300 |

- Purchases are non-refundable. Assets created during a paid period are deleted 15 days after expiry.
- **Discrepancy:** the real-human guide's title says "invited users only", but the pricing page lists a free Entry tier with API access. Confirm availability in the console or with a support ticket.

Quote: "Complete the Organization real-name authentication ... including a photo copy of the corporate registration certificate."

### 2e. Terms that matter
- **Asset Library Terms** (https://docs.byteplus.com/en/docs/ModelArk/2275639): content made with BytePlus's **preset Reference Assets** (the digital character library) may only be used "for the purposes of experiencing model performance and for internal use" unless BytePlus gives prior written consent. **That rules out using preset characters in client ads without written consent.** For custom and authorized assets, we warrant we hold all rights, including portrait rights, and that our use of the outputs won't infringe third-party rights.
- **Virtual Avatar Commitment Letter** (https://docs.byteplus.com/en/docs/ModelArk/2275638): we declare the avatar is original, or commissioned by us. If AI-assisted, we must have complied with the source tool's ToS and made "substantial and creative" selection or modification. The avatar must not be identical or similar to any natural person.

### 2f. Exact error codes (primary)
Source: ModelArk error codes, https://docs.byteplus.com/en/docs/ModelArk/1299023
- `400 InputImageSensitiveContentDetected.PrivacyInformation`: "The request failed because the input image may contain real person." The console tells users to replace the image and retry.
- `400 InputVideoSensitiveContentDetected.PrivacyInformation`: the same check for video inputs.
- `400 OutputVideoSensitiveContentDetected`: generic output block. This is what we would expect if a hijab output gets flagged on ModelArk itself. It is untested on ModelArk.

I found no "mark as AI-generated" parameter and no per-request allowlist flag. The only documented bypasses are the asset libraries (`asset://`) and the trusted-output mechanism.

## 3. Text-only and first-frame routes

- **Text-to-video (no face input).** The `PrivacyInformation` codes are defined for *input* images and videos, so a text-only request has nothing for them to check. The 2.5 tutorial (https://docs.byteplus.com/en/docs/ModelArk/2607688) treats text-to-video as its own task type with no special constraints. Output moderation still applies. **Inference, not tested by us.** Downside: you cannot lock the same face across shots.
- **First-frame image-to-video.** The portrait-video page says the face restriction applies to reference images and videos in the Seedance 2.0/2.5 series in general. The trusted-output list explicitly covers "input assets". I found nothing saying `first_frame` is exempt, so assume a photoreal face in `first_frame` is also blocked **unless** it is a trusted output or an `asset://` ID. **UNVERIFIED by us**, and worth one quick API test.
- **fal:** a third-party test found fal rejects photoreal faces even from Seedance's own outputs, so the ModelArk trusted-output mechanism **does not carry over to fal**. ModelArk's own doc also says trust is same-platform and same-account only.

## 4. Digital-human / avatar models

- **OmniHuman 1.5** (BytePlus Vision product, separate from ModelArk). It takes one image plus audio and produces a lip-synced performance with prompt control over motion and camera. Docs: https://docs.byteplus.com/en/docs/byteplus-vision/omnihuman1_5overview. The overview accepts images "that contain people or other subjects" and its demos use photoreal people. **No likeness-verification gate is documented** on the overview page. Pricing per third-party sites is about $0.14–0.16/s (**UNVERIFIED**). Resellers include Kie.ai, ModelsLab, Pixazo and Hedra. This is a candidate for talking-head UGC with an AI hijabi persona, since the input does not face a Seedance-style block. Realism and Arabic lip-sync still need to be tested.
- **Seedance real-human assets** (2c) are the ByteDance-family route for *authorized* likeness in full scenes.

## 5. Consent and legal notes (general, not legal advice)

- **Real person in ads:** get a written, signed release covering use of likeness and voice, AI synthesis, media and territories, term, and payment. BytePlus's real-human flow adds a platform-side liveness authorization, but that **does not replace** a commercial model release.
- **Saudi Arabia (PDPL):** a person's image is personal data. Processing requires notice and consent, and marketing uses require explicit consent. Source: SDAIA guide to the PDPL (dgp.sdaia.gov.sa).
- **UAE:** the Media Council warned (2025-09-25, reported by The National and WAM) that using AI to depict national symbols or public figures without prior approval violates media content standards. Since 2026-02-01 an **Advertiser Permit** has been required for promotional content (Al Tamimi & Co. law update). **UNVERIFIED in the primary text:** I could not load the WAM page body.
- **EU (if ads reach the EU):** AI Act Art. 50 deepfake-disclosure duties for deployers apply from 2026-08-02. Content must be clearly labelled on first exposure, and machine-readable watermarks alone are not enough. Source: European Commission AI Act Art. 50 FAQ. Check for any Digital Omnibus changes.
- **AI-generated persona (no real person):** the BytePlus commitment letter requires that the persona not resemble any real individual. Keep the generation prompts and seeds as provenance evidence. Label ads as AI-generated where platform or local rules require it.

---

## What the owner would need to do

**Route A: trusted Seedream output (days, ~$0 extra)**
1. On the existing ModelArk account, generate the hijabi creator portrait with **Seedream 5.0 lite text-to-image** (`seedream-5-0-260128`). Use text only, with no input image.
2. Save the original output unmodified to BytePlus TOS, or pass the returned URL straight through. Do not re-encode or crop it.
3. Within 30 days, call Seedance 2.0/2.5 with that image as `reference_image` or `first_frame`.
4. Test whether hijab outputs pass ModelArk's own output moderation. That is a separate unknown from EvoLink's result.
5. For multi-shot consistency, chain the Seedance outputs and last frames, which are also trusted for 30 days.

**Route B: Virtual Portrait asset (persistent persona)**
1. Complete BytePlus **organization real-name authentication** (upload the company registration certificate).
2. Activate **Advanced Creation Rights (Entry, free)** and accept the four legal documents. Sign the authorization letter on first group creation.
3. Upload the AI persona images (full-body plus face close-up) via the console or `CreateAssetGroup`/`CreateAsset`, then wait for the review to reach `Active`.
4. Use `asset://<id>` in Seedance calls. Upgrade to a paid tier only if we need more than 50 assets or more than 3 QPM.

**Route C: real hired creator**
1. Complete the same enterprise verification and Entry tier as Route B.
2. Sign a commercial model release with the talent.
3. Send her the H5 or QR link. She logs into her own BytePlus account and completes liveness.
4. Upload her photos to the group and use `asset://<id>`.

**Open questions to raise in a BytePlus support ticket:**
- Is the real-human library still invite-only in our region?
- Does the virtual-portrait review accept photoreal AI faces, including hijab?
- Is `first_frame` treated like `reference_image` for the face check?
- Are hijab outputs subject to any extra output moderation?

## Sources (all checked 2026-09-24)
- BytePlus ModelArk: portrait videos with Seedance, 2608626 · Private virtual portrait library, 2333565 · Real-human asset library guide, 2333589 · Add real-human assets (console), 2315856 · Advanced Creation Rights purchase guide, 2377608 · Digital character library, 2223965 · Asset Library Terms, 2275639 · Virtual Avatar Commitment Letter, 2275638 · Error codes, 1299023 · Seedream tutorial, 1824121 · Seedance 2.5 tutorial, 2607688. All at `https://docs.byteplus.com/en/docs/ModelArk/<id>`.
- BytePlus OmniHuman 1.5 overview: https://docs.byteplus.com/en/docs/byteplus-vision/omnihuman1_5overview
- ComfyUI Seedance 2.0 Real Human: https://docs.comfy.org/tutorials/partner-nodes/bytedance/seedance-2-0-real-human
- Higgsfield help, How to use Seedance: https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-seedance
- fal Seedance reference-to-video: https://fal.ai/models/bytedance/seedance-2.0/reference-to-video ; recoupable/skills PR #145: https://github.com/recoupable/skills/pull/145
- EvoLink real-human guide: https://evolink.ai/blog/seedance-2-0-real-human-video-api-guide
- Provider comparison (secondary): https://github.com/gracech0322-cmd/best-seedance-2-api
- Kie.ai Seedance: https://kie.ai/seedance-2-0
- ClipDance workarounds (2026-05-08): https://clipdance.ai/blog/seedance-2-real-face-workaround
- useapi.net (circumvention, cited only as a warning): https://useapi.net/blog/260415
- TechCrunch, Seedance 2.0 in CapCut (2026-03-26): https://techcrunch.com/2026/03/26/bytedances-new-ai-video-generation-model-dreamina-seedance-2-0-comes-to-capcut/
- X post, @alisaqqt: https://x.com/alisaqqt/status/2020877903102460321
- UAE: The National, 2025-09-25: https://www.thenationalnews.com/news/uae/2025/09/25/uae-warns-against-use-of-ai-to-depict-public-figures-for-online-misinformation/ ; Al Tamimi, Advertiser Permit: https://www.tamimi.com/law-update/technology-edition/articles/uae-introduces-mandatory-advertiser-permit-for-content-creators/
- KSA PDPL guide (SDAIA): https://dgp.sdaia.gov.sa/wps/wcm/connect/f579bc32-fda8-47bd-bc6f-66b8cb77985c/ENG-Guide+to+the+saudi+PDP+law+for+controllersprocessors.pdf
- EU AI Act Art. 50 FAQ: https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act
