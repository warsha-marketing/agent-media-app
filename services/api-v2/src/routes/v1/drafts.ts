// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Product Hero draft routes (#4). The logic lives in drafts/product-hero-draft.ts;
 * this file is only HTTP: validate, call, map DraftError to a status.
 *
 *   POST /v1/drafts/product-hero          { brief, dialect }             → 201 { draft }
 *   POST /v1/drafts/product-hero/revoice  { script, dialect,
 *                                           parent_draft_id?, brief? }   → 201 { draft }
 *   GET  /v1/drafts/:id                                                   → 200 { draft } | 404
 *
 * Free (no credits) — see the module header. `draftLimiter` runs AFTER auth so
 * it buckets per user.
 */

import type express from 'express';
import type { Request, RequestHandler, Response } from 'express';
import {
  CreateDraftInputSchema,
  DraftError,
  RevoiceDraftInputSchema,
  createDraftFromBrief,
  revoiceDraft,
  toDraftView,
  type DraftDeps,
} from '../../drafts/product-hero-draft.js';

interface DraftRouteMiddleware {
  generateLimiter: RequestHandler;
  readLimiter: RequestHandler;
  authMiddleware: RequestHandler;
  draftLimiter: RequestHandler;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(res: Response, err: unknown, tag: string): void {
  if (err instanceof DraftError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.details } });
    return;
  }
  const message = (err as Error)?.message ?? 'unknown error';
  console.error(`[v1 drafts/${tag}] ${message}`);
  // Provider-side failures (Claude, ElevenLabs, storage) are retryable by the caller.
  res.status(502).json({ error: { code: 'DRAFT_FAILED', message: 'Drafting failed upstream. Try again in a moment.' } });
}

function userOf(req: Request): string {
  return (req as { userId?: string }).userId as string;
}

function invalid(res: Response, issues: { path: (string | number)[]; message: string }[]): void {
  const first = issues[0];
  res.status(400).json({
    error: {
      code: 'INVALID_INPUT',
      message: first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid input',
      issues,
    },
  });
}

export function registerDraftRoutes(app: express.Express, mw: DraftRouteMiddleware, deps: DraftDeps): void {
  const { generateLimiter, readLimiter, authMiddleware, draftLimiter } = mw;

  app.post('/v1/drafts/product-hero', generateLimiter, authMiddleware, draftLimiter, async (req, res) => {
    const parsed = CreateDraftInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error.issues);
    try {
      const row = await createDraftFromBrief(deps, userOf(req), parsed.data);
      res.status(201).json({ draft: toDraftView(row) });
    } catch (err) {
      fail(res, err, 'create');
    }
  });

  app.post('/v1/drafts/product-hero/revoice', generateLimiter, authMiddleware, draftLimiter, async (req, res) => {
    const parsed = RevoiceDraftInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error.issues);
    try {
      const row = await revoiceDraft(deps, userOf(req), parsed.data);
      res.status(201).json({ draft: toDraftView(row) });
    } catch (err) {
      fail(res, err, 'revoice');
    }
  });

  app.get('/v1/drafts/:id', readLimiter, authMiddleware, async (req, res) => {
    const id = String(req.params.id ?? '');
    const notFound = () => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Draft not found.' } });
    if (!UUID.test(id)) return void notFound();
    try {
      // Owner-scoped lookup: another user's draft is indistinguishable from none.
      const row = await deps.repo.getOwned(id, userOf(req));
      if (!row) return void notFound();
      res.status(200).json({ draft: toDraftView(row) });
    } catch (err) {
      fail(res, err, 'get');
    }
  });
}
