# Music Bed — licence records

Every Music Bed track in `./tracks.ts` must have its own entry here (a `## <track id>`
heading), and CI fails without it (`musicBedTrackProblems`). This file also records
the terms of each candidate *source*, checked before any track from it is added.

Rule for any source: its terms must allow **us** (agent-media, a hosted app) to put
the track into Shorts that **our users** export and run as ads on social platforms
(TikTok, Instagram, YouTube, Snapchat), in any MENA market, with no per-use
attribution the Short can't carry. TikTok sounds never qualify: TikTok licenses
them only inside its app. TikTok Creative Center may be used only as a *style
reference* when an operator picks a Preset's mood.

---

## Source: ElevenLabs music generation (Eleven Music / Music API)

- Checked on: 2026-09-23
- Checked by: agent (issue #9), from official ElevenLabs pages only
- **Verdict: NOT CLEARED for our use on a self-serve plan. Do not generate or add
  Eleven Music tracks until ElevenLabs confirms our use in writing, most likely
  under an Enterprise (Lite) agreement with "Music Libraries & Repositories" and
  redistribution rights.**

What the terms say, and why this is not a clear yes:

1. **Advertising is allowed in principle, but the pages disagree.** The Music
   capability docs say Eleven Music is cleared for commercial uses including
   "social media videos" and "advertisements"
   (https://elevenlabs.io/docs/overview/capabilities/music). The Model-Specific
   Terms table gives every paid self-serve tier "Media Rights" of "all commercial
   use except film, TV, radio, Studio Games"
   (https://elevenlabs.io/eleven-music-model-specific-terms, last updated
   26 May 2026). But the ElevenCreative FAQ says Eleven Music "requires an
   additional license for marketing campaigns, advertising"
   (https://elevenlabs.io/creative). Exported ads are our only use case, so this
   conflict alone blocks building on it.
2. **Our use is a library made available to third parties.** A per-Preset track
   set, mixed into Shorts that our users download and publish, fits the Model-
   Specific Terms' "Music Libraries & Repositories" (§5(e): a repository of Output
   made available to third parties), which is **Prohibited** on every self-serve
   tier (Free → Business) and "Custom" only on Enterprise Lite / Enterprise.
3. **Redistribution is barred by the API terms.** The Music API Terms (§3.A)
   forbid you to "resell, repackage, redistribute, sublicense" Output unless you
   are an Authorized Reseller (https://elevenlabs.io/music-api-terms, last updated
   18 Aug 2025). §4.A adds a co-branding duty ("powered by ElevenLabs") for some
   customer types.
4. **Plan eligibility.** Starter, Creator and Pro are "Individual use only"; Scale
   and Business are capped by employee count (<10, <50) — see the Commercial
   Rights table in the Model-Specific Terms.
5. **Content restrictions carry through to Output.** The Music Terms prohibit use
   for some industries (firearms, tobacco, pharmaceuticals, adult, religious,
   political) (https://elevenlabs.io/music-terms, last updated 26 May 2026). Our
   users' products are not screened for these, so a bed could end up in a
   prohibited ad.
6. General: paid plans include a commercial licence and the free plan does not
   (https://elevenlabs.io/docs/help-center/legal/can-i-publish-the-content-i-generate-on-the-platform);
   Service-Specific Terms index: https://elevenlabs.io/service-specific-terms
   (last updated 17 Aug 2026).

Consequence for the build (issue #9): the pipeline is source-agnostic (a track is
source + licence + mood + private storage key). No generation script exists and
no paid API is called. The shipped set is empty, so a Short with the Music Bed on
is voice only and the quote/page say so (`reason: no_tracks`).

Next step for an operator: either (a) get written confirmation / an Enterprise
music licence from ElevenLabs covering tracks reused across our users' exported
ads, or (b) pick the fallback: a royalty-free library with an API whose licence
explicitly covers use by a platform's end users in paid social ads (check its
"SaaS / app / sublicensing" clause specifically), record it here as a new
"Source" section, then add tracks.

---

## Track entries

<!-- One section per track, heading = its id in tracks.ts, e.g.

## ph-luxurious-01

- Preset / mood: product_hero / luxurious
- Source: <provider>, <provider_ref> (generated on YYYY-MM-DD by <operator> | picked from <library>)
- Licensor: <legal entity>
- Terms: <url> (checked on YYYY-MM-DD)
- Grant: <what we may do: exported paid social ads, territories, term, attribution>
- Proof: <licence certificate / invoice / generation receipt location>
- Storage: music-bed/product_hero/ph-luxurious-01.mp3 (private bucket)
-->

(none yet)
