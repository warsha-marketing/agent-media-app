# primitive-worker-vnext

Fresh Temporal worker for vNext primitives. NOT a replacement for
legacy `media-worker-v2` — runs alongside on its own task queue.

## Task queue

`primitive-vnext-v1`

## Primitives implemented

- `portrait_gpt2` — single realistic portrait via OpenAI `gpt-image-2`.

## Local run

```bash
# 1. Make sure .env.vnext.local has TEMPORAL_*, OPENAI_API_KEY, R2_*, SUPABASE_*.
# 2. Apply the migration (see supabase/migrations/*_vnext_primitive_*.sql).
# 3. Start the worker:
pnpm --filter primitive-worker-vnext dev
```

## Workflow tests

`pnpm --filter primitive-worker-vnext test` runs workflows against fake
activities in Temporal's time-skipping test server
(`src/__tests__/support/workflow-harness.ts`). That server is a native binary:
by default the SDK downloads it from `temporal.download` on first use and
caches it in the OS temp dir for a day.

To run offline (or pin the binary), fetch it once and point
`TEMPORAL_TEST_SERVER_PATH` at it; the harness then uses it as-is and never
downloads:

```bash
v=$(node -p "require('./node_modules/@temporalio/testing/package.json').version")
os=$(uname -s | tr A-Z a-z); arch=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
info=$(curl -fsSL "https://temporal.download/temporal-test-server/default?arch=$arch&platform=$os&sdk-name=sdk-typescript&sdk-version=$v")
curl -fsSL "$(echo "$info" | jq -r .archiveUrl)" | tar -xz -C /tmp "$(echo "$info" | jq -r .fileToExtract)"
export TEMPORAL_TEST_SERVER_PATH=/tmp/$(echo "$info" | jq -r .fileToExtract)
chmod +x "$TEMPORAL_TEST_SERVER_PATH"   # the archive does not keep the exec bit
```

CI does the same, cached per `@temporalio/testing` version
(`.github/workflows/ci.yml`, test job). `turbo.json` passes the variable
through to the test task.

## Cost guardrails

Three caps enforced in code before any provider call:

- `PRIMITIVE_CAP_USD` (default 0.50)
- `RUN_CAP_USD` (default 5.00)
- `DAY_CAP_USD` (default 20.00)

Exceeding any cap rejects the Activity with a non-retryable failure.

A Preset's clips are exempt from `PRIMITIVE_CAP_USD`: the Preset declares its
own budget for the whole render (`PRODUCT_HERO.budget` in `@agentmedia/schema`),
and its shot plan is held to it by tests. The day cap still applies. Every
other activity keeps the per-primitive cap.

`R2_PRIVATE_BUCKET` is required for Product Hero and must match api-v2's: the
render reads the draft's private audio from it by key. It never falls back to
`R2_BUCKET`; unset, a render fails with `DRAFT_STORAGE_UNCONFIGURED`
(non-retryable, refunded). The Music Bed tracks (`music-bed/…`) live in the same
private bucket; a track read without it fails with
`MUSIC_BED_STORAGE_UNCONFIGURED`, a missing track with `MUSIC_BED_TRACK_MISSING`
(both non-retryable, refunded).

## Manual check: a headscarf portrait on Seedance (Modesty Default, #17)

People and hands shots carry the Modesty Default (`src/presets/modesty.ts`,
appended by `presetShotPrompt`); for a woman that can mean a hijab. Our own
image moderation gate is held by a unit test
(`services/api-v2/src/__tests__/image-moderation.test.ts`, headscarf fixture).
Provider-side moderation cannot be unit-tested: Seedance Mini once refused a
benign headscarf portrait with a generic `content_policy_violation` (MENA
acceptance notes, commit `c556541`). Check it by hand **before qualifying any
Preset that shows people (Hands-on, Reaction) for a Dialect, and whenever
`EVOLINK_SEEDANCE_MODEL` changes**:

1. Make three portraits of different fictional adult women wearing a hijab,
   modestly dressed with long sleeves (`make_portrait`, e.g. "a woman in her
   thirties wearing a navy hijab and a long-sleeved abaya, soft daylight").
   Never use a real person's photo.
2. Upload each through the normal image upload path. Expected: accepted. A 422
   `UNSAFE_CONTENT` here is OUR gate and a bug: keep the scores from the
   `[image-moderation] BLOCKED` log line and fix the thresholds or the test.
3. Animate each silently on the Preset clip model (`seedance-2.0-mini-reference-to-video`,
   `generate_audio: false`), the portrait as `@image1`, with a people prompt
   ending in the Modesty Default for a woman with hijab (the `person.covered` and
   `hijab` sentences of `MODESTY_PROMPTS`), e.g. `make_simple_selfie` from the
   portrait's character sheet (`make_character_sheet`) in `scene_action` mode
   with no script and no music, so the clip is silent.
4. Expected: every clip completes and she keeps the hijab in every frame.
   On `EVOLINK_CONTENT_POLICY_VIOLATION` do NOT remove the hijab, change the
   clothing or resubmit the same input (the worker never retries it). Record
   the date, model, EvoLink task id, prompt and which portrait, and try the
   other portraits: one refusal is not a policy (acceptance criterion 5). If
   refusals repeat, the Preset is not qualified on that model; raise it with the
   provider and test a compatible model instead.

## Simulate mode

Set `SIMULATE_OPENAI=true` to skip the real OpenAI call and return a
placeholder PNG. Used for the first end-to-end smoke test, before
the human-approved live-spend gate.
