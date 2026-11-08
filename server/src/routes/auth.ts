import { Router, type CookieOptions } from 'express';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Pool } from '../db.js';
import { unauthorized } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import { verifyAgainstDummy, verifyPassword } from '../lib/password.js';
import { requireAuth } from '../middleware/auth.js';
import { createSession, deleteSession, SESSION_COOKIE } from '../services/sessions.js';

const loginSchema = z.strictObject({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(128),
});

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: 'owner';
  failed_login_attempts: number;
  locked_until: Date | null;
}

export function authRouter(pool: Pool, config: Config, loginLimiter: import('express').RequestHandler) {
  const router = Router();

  const cookieOptions = (maxAgeMs?: number): CookieOptions => ({
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/',
    ...(maxAgeMs === undefined ? {} : { maxAge: maxAgeMs }),
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const { rows } = await pool.query<UserRow>(
      `SELECT id, email, password_hash, role, failed_login_attempts, locked_until
         FROM users WHERE lower(email) = lower($1)`,
      [email],
    );
    const user = rows[0];

    // Same response for "unknown e-mail", "wrong password" and "locked" so attackers
    // learn nothing about which accounts exist.
    const fail = async (reason: string, userId?: string) => {
      await writeAudit(pool, req, { action: 'auth.login_failed', userId, meta: { reason } });
      throw unauthorized('Invalid email or password');
    };

    if (!user) {
      await verifyAgainstDummy(password);
      return fail('unknown_user');
    }

    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      await verifyAgainstDummy(password);
      return fail('locked', user.id);
    }

    const valid = await verifyPassword(user.password_hash, password);
    if (!valid) {
      const attempts = user.failed_login_attempts + 1;
      const lock = attempts >= config.LOGIN_MAX_ATTEMPTS;
      await pool.query(
        `UPDATE users
            SET failed_login_attempts = $2,
                locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE locked_until END
          WHERE id = $1`,
        [user.id, lock ? 0 : attempts, lock, config.LOGIN_LOCK_MINUTES],
      );
      return fail(lock ? 'bad_password_now_locked' : 'bad_password', user.id);
    }

    await pool.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1', [
      user.id,
    ]);
    const { token } = await createSession(pool, {
      userId: user.id,
      ttlHours: config.SESSION_TTL_HOURS,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.cookie(SESSION_COOKIE, token, cookieOptions(config.SESSION_TTL_HOURS * 3_600_000));
    await writeAudit(pool, req, { action: 'auth.login', userId: user.id });
    res.json({ user: { id: user.id, email: user.email, role: user.role } });
  });

  router.post('/logout', async (req, res) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token) await deleteSession(pool, token);
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    res.status(204).end();
  });

  router.get('/me', requireAuth(pool), (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
