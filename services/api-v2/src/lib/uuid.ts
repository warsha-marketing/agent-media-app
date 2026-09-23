// Copyright 2026 agent-media contributors. Apache-2.0 license.

/** A canonical 8-4-4-4-12 hex UUID (any version), case-insensitive. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
