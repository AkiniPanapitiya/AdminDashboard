import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** The exact browser origin that is allowed to call the API (used for CSRF/Origin checks). */
  CLIENT_ORIGIN: z.url().default('http://localhost:5173'),
  /** Optional path to the built client (client/dist). When set, the API also serves the UI. */
  CLIENT_DIST: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  /** Set to "true" in production (HTTPS). Defaults to true when NODE_ENV=production. */
  COOKIE_SECURE: booleanString.optional(),
  /** Number of reverse proxies in front of the app (e.g. 1 behind nginx). 0 = none. */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  /** IANA time zone used to decide what "today" is for work dates. */
  BUSINESS_TZ: z.string().default('Asia/Colombo'),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  /** Disable rate limiting only in automated tests. */
  RATE_LIMIT_ENABLED: booleanString.default(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = Omit<z.infer<typeof schema>, 'COOKIE_SECURE'> & { COOKIE_SECURE: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const data = parsed.data;
  const cookieSecure = data.COOKIE_SECURE ?? data.NODE_ENV === 'production';
  if (data.NODE_ENV === 'production' && !cookieSecure) {
    throw new Error('COOKIE_SECURE must not be "false" in production.');
  }
  return { ...data, COOKIE_SECURE: cookieSecure };
}
