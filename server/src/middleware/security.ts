import type { RequestHandler } from 'express';
import { forbidden } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth (the session cookie is also SameSite=Strict):
 *  - state-changing requests must come from the configured client origin when the
 *    browser sends an Origin header (browsers always do for cross-site POSTs);
 *  - requests with a body must be JSON, which cannot be sent by a plain HTML form.
 */
export function csrfGuard(allowedOrigin: string): RequestHandler {
  const expected = new URL(allowedOrigin).origin;
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (origin && origin !== expected) throw forbidden('Cross-origin request blocked');
    const hasBody = Number(req.get('content-length') ?? 0) > 0 || req.get('transfer-encoding');
    if (hasBody && !req.is('application/json')) {
      throw forbidden('Content-Type must be application/json');
    }
    next();
  };
}
