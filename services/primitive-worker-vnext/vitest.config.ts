// Copyright 2026 agent-media contributors. Apache-2.0 license.
import { defineConfig } from 'vitest/config';

// Workflow tests run a real Temporal test server and bundle the workflows; under
// load (turbo running every package at once) a single test can exceed vitest's
// 5 s default and fail spuriously. 30 s keeps real hangs visible.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
