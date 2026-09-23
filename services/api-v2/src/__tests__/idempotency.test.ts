// Copyright 2026 agent-media contributors. Apache-2.0 license.
//
// The one Idempotency-Key reader every run path shares (skills, primitives,
// Caption exports): the header in either spelling, trimmed; blank or longer
// than 200 characters means "no key".

import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { readIdempotencyKey } from '../skills/idempotency.js';

/** A request whose header lookup is case-SENSITIVE, like a hand-rolled fake. */
function reqWith(headers: Record<string, string>): Request {
  return { header: (name: string) => headers[name] } as unknown as Request;
}

describe('readIdempotencyKey', () => {
  it('reads the header in either spelling', () => {
    expect(readIdempotencyKey(reqWith({ 'idempotency-key': 'k-1' }))).toBe('k-1');
    expect(readIdempotencyKey(reqWith({ 'Idempotency-Key': 'k-2' }))).toBe('k-2');
  });

  it('trims the key', () => {
    expect(readIdempotencyKey(reqWith({ 'idempotency-key': '  k-3 \t' }))).toBe('k-3');
  });

  it('is null when missing, blank or longer than 200 characters', () => {
    expect(readIdempotencyKey(reqWith({}))).toBeNull();
    expect(readIdempotencyKey(reqWith({ 'idempotency-key': '   ' }))).toBeNull();
    expect(readIdempotencyKey(reqWith({ 'idempotency-key': 'k'.repeat(201) }))).toBeNull();
    expect(readIdempotencyKey(reqWith({ 'idempotency-key': 'k'.repeat(200) }))).toBe('k'.repeat(200));
  });
});
