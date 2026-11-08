import { createHash, randomBytes } from 'node:crypto';
import type { Queryable } from '../db.js';
import type { AuthUser } from '../types.js';

export const SESSION_COOKIE = 'inka_sid';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Creates a session and returns the raw token. Only a SHA-256 hash is stored in the database. */
export async function createSession(
  db: Queryable,
  input: { userId: string; ttlHours: number; ip?: string; userAgent?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + input.ttlHours * 3_600_000);
  await db.query(
    `INSERT INTO sessions (user_id, token_hash, ip, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.userId, hashToken(token), input.ip ?? null, input.userAgent?.slice(0, 300) ?? null, expiresAt],
  );
  return { token, expiresAt };
}

export async function findSessionUser(db: Queryable, token: string): Promise<AuthUser | null> {
  const { rows } = await db.query<AuthUser>(
    `SELECT u.id, u.email, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function deleteSession(db: Queryable, token: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function purgeExpiredSessions(db: Queryable): Promise<number> {
  const result = await db.query('DELETE FROM sessions WHERE expires_at <= now()');
  return result.rowCount ?? 0;
}
