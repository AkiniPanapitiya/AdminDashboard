import path from 'node:path';
import { existsSync } from 'node:fs';
import cookieParser from 'cookie-parser';
import express, { type Express, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { pino } from 'pino';
import type { Config } from './config.js';
import type { Pool } from './db.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { csrfGuard } from './middleware/security.js';
import { authRouter } from './routes/auth.js';
import { jobTypesRouter } from './routes/jobTypes.js';
import { payrollRouter } from './routes/payroll.js';
import { productionRouter } from './routes/production.js';
import { staffRouter } from './routes/staff.js';

export interface AppDeps {
  pool: Pool;
  config: Config;
}

const passthrough: RequestHandler = (_req, _res, next) => next();

export function createApp({ pool, config }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger: pino({
        level: config.LOG_LEVEL,
        // Never write credentials or session cookies to logs.
        redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
      }),
      // Health checks are noisy; skip them.
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      // Keep logs small and free of headers (cookies etc.).
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          // Only upgrade to HTTPS when we are actually served over HTTPS.
          'upgrade-insecure-requests': config.COOKIE_SECURE ? [] : null,
        },
      },
      strictTransportSecurity: config.COOKIE_SECURE ? undefined : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  const apiLimiter = config.RATE_LIMIT_ENABLED
    ? rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false })
    : passthrough;
  const loginLimiter = config.RATE_LIMIT_ENABLED
    ? rateLimit({
        windowMs: 15 * 60_000,
        limit: 20,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: { code: 'rate_limited', message: 'Too many attempts, try again later' } },
      })
    : passthrough;

  const api = express.Router();
  api.use(apiLimiter);
  api.use(express.json({ limit: '50kb' }));
  api.use(cookieParser());
  api.use(csrfGuard(config.CLIENT_ORIGIN));
  // Anything under /api can contain private data: never let a browser or proxy cache it.
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  api.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  api.use('/auth', authRouter(pool, config, loginLimiter));

  const protectedApi = express.Router();
  protectedApi.use(requireAuth(pool));
  protectedApi.use('/staff', staffRouter(pool));
  protectedApi.use('/job-types', jobTypesRouter(pool));
  protectedApi.use('/production', productionRouter(pool, config));
  protectedApi.use('/payroll', payrollRouter(pool));
  api.use(protectedApi);

  api.use(notFoundHandler);
  app.use('/api', api);

  // Optionally serve the built React app from the same origin (production).
  if (config.CLIENT_DIST && existsSync(config.CLIENT_DIST)) {
    const dist = path.resolve(config.CLIENT_DIST);
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.set('Cache-Control', 'no-cache').sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
