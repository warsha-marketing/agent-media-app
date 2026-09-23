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
(non-retryable, refunded).

## Simulate mode

Set `SIMULATE_OPENAI=true` to skip the real OpenAI call and return a
placeholder PNG. Used for the first end-to-end smoke test, before
the human-approved live-spend gate.
