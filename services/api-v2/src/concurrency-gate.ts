// Copyright 2026 agent-media contributors. Apache-2.0 license.

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from './logger.js';

export interface VideoConcurrencyGateDeps {
  /** How many videos the account may have rendering at once; <= 0 turns the gate off. */
  max: number;
  /** Renders (and Caption exports) the account has in flight. */
  countInFlight(userId: string): Promise<number>;
}

/**
 * The per-account "videos rendering at once" gate (see concurrency.ts for why
 * the cap is on renders in flight). Mounted after auth; every route that starts
 * a render or a Caption export goes through the same instance.
 *
 * Fails OPEN: if the count errors we let the request through. A database
 * hiccup must not stop paying customers generating; the credit ledger is the
 * backstop that actually protects us from runaway spend.
 */
export function makeVideoConcurrencyGate(deps: VideoConcurrencyGateDeps): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = (req as Request & { userId?: string }).userId;
    if (!userId || deps.max <= 0) {
      next();
      return;
    }

    let active: number;
    try {
      active = await deps.countInFlight(userId);
    } catch (err) {
      logger.warn({ err, userId }, 'concurrency gate: count failed, allowing');
      next();
      return;
    }

    if (active >= deps.max) {
      res.status(429).json({
        error: {
          code: 'TOO_MANY_ACTIVE_VIDEOS',
          message: `You already have ${active} videos generating. Wait for one to finish, then try again. (Limit ${deps.max}.)`,
          active,
          limit: deps.max,
        },
      });
      return;
    }

    next();
  };
}
