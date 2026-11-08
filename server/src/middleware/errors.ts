import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
};

// PostgreSQL error codes we translate into friendly client errors.
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error instanceof AppError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  if (error instanceof z.ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Invalid request',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  // Body parser errors (malformed JSON, payload too large).
  const parserError = error as { type?: string; status?: number };
  if (parserError.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'bad_json', message: 'Malformed JSON body' } });
    return;
  }
  if (parserError.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'too_large', message: 'Request body too large' } });
    return;
  }

  const pgCode = (error as { code?: string }).code;
  if (pgCode === PG_UNIQUE_VIOLATION) {
    res.status(409).json({ error: { code: 'conflict', message: 'That record already exists' } });
    return;
  }
  if (pgCode === PG_FOREIGN_KEY_VIOLATION) {
    res.status(409).json({
      error: { code: 'conflict', message: 'This record is referenced by other data' },
    });
    return;
  }
  if (pgCode === PG_CHECK_VIOLATION) {
    res.status(400).json({ error: { code: 'bad_request', message: 'Value out of allowed range' } });
    return;
  }

  // Anything else is a bug or an outage. Log the detail, but never leak it to the client.
  req.log?.error({ err: error }, 'unhandled error');
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong' } });
};
