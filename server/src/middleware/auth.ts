import type { RequestHandler } from 'express';
import type { Pool } from '../db.js';
import { unauthorized } from '../lib/errors.js';
import { findSessionUser, SESSION_COOKIE } from '../services/sessions.js';

/** Blocks the request unless it carries a valid session cookie. */
export function requireAuth(pool: Pool): RequestHandler {
  return async (req, _res, next) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) {
      throw unauthorized();
    }
    const user = await findSessionUser(pool, token);
    if (!user) throw unauthorized();
    req.user = user;
    next();
  };
}
