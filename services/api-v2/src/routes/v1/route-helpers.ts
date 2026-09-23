// Copyright 2026 agent-media contributors. Apache-2.0 license.

/**
 * Helpers the `{ error: { code, message, … } }` route family shares (drafts,
 * voices, presets): the caller's user id, the 400 INVALID_INPUT answer, and
 * the operator gate.
 */

import type { Request, RequestHandler, Response } from 'express';

/** The authenticated caller (set by authMiddleware). */
export function userOf(req: Request): string {
  return (req as { userId?: string }).userId as string;
}

/** 400 INVALID_INPUT naming the first issue; `root` labels an issue at the top level. */
export function sendInvalidInput(
  res: Response,
  issues: { path: (string | number)[]; message: string }[],
  root = 'input',
): void {
  const first = issues[0];
  res.status(400).json({
    error: {
      code: 'INVALID_INPUT',
      message: first ? `${first.path.join('.') || root}: ${first.message}` : 'Invalid input',
      issues,
    },
  });
}

/**
 * After auth: only operators pass, else 403 OPERATOR_ONLY with `message`.
 * Fails closed if the check itself fails (logged under `tag`).
 */
export function operatorOnly(isOperator: (userId: string) => Promise<boolean>, tag: string, message: string): RequestHandler {
  return async (req, res, next) => {
    let ok = false;
    try {
      ok = await isOperator(userOf(req));
    } catch (err) {
      console.error(`[v1 ${tag}/operator] ${(err as Error)?.message ?? 'operator check failed'}`);
    }
    if (!ok) {
      res.status(403).json({ error: { code: 'OPERATOR_ONLY', message } });
      return;
    }
    next();
  };
}
