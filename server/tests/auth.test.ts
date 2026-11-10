import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CLIENT_ORIGIN,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  createContext,
  createOwner,
  loggedInAgent,
  resetData,
} from './helpers.js';

const ctx = createContext({ LOGIN_MAX_ATTEMPTS: '3', LOGIN_LOCK_MINUTES: '15' });
afterAll(() => ctx.pool.end());
beforeEach(async () => {
  await resetData(ctx.pool);
  await createOwner(ctx.pool);
});

const login = (body: object, origin: string | undefined = CLIENT_ORIGIN) => {
  const req = request(ctx.app).post('/api/auth/login');
  if (origin) req.set('Origin', origin);
  return req.send(body);
};

describe('authentication', () => {
  it('logs in and sets a hardened session cookie', async () => {
    const res = await login({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: OWNER_EMAIL, role: 'owner' });
    expect(JSON.stringify(res.body)).not.toMatch(/hash|argon/i);

    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toMatch(/^inka_sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('is case-insensitive for the e-mail', async () => {
    const res = await login({ email: OWNER_EMAIL.toUpperCase(), password: OWNER_PASSWORD });
    expect(res.status).toBe(200);
  });

  it('gives an identical generic error for unknown user and wrong password', async () => {
    const unknown = await login({ email: 'nobody@inka.test', password: 'whatever-123' });
    const wrong = await login({ email: OWNER_EMAIL, password: 'wrong-password-1' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('locks the account after too many failures, even for the right password', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await login({ email: OWNER_EMAIL, password: 'bad-password-1' })).status).toBe(401);
    }
    const locked = await login({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
    expect(locked.status).toBe(401);

    // Lock expiry makes the account usable again.
    await ctx.pool.query("UPDATE users SET locked_until = now() - interval '1 minute'");
    expect((await login({ email: OWNER_EMAIL, password: OWNER_PASSWORD })).status).toBe(200);
  });

  it('resets the failure counter after a successful login', async () => {
    await login({ email: OWNER_EMAIL, password: 'bad-password-1' });
    await login({ email: OWNER_EMAIL, password: 'bad-password-1' });
    expect((await login({ email: OWNER_EMAIL, password: OWNER_PASSWORD })).status).toBe(200);
    await login({ email: OWNER_EMAIL, password: 'bad-password-1' });
    await login({ email: OWNER_EMAIL, password: 'bad-password-1' });
    expect((await login({ email: OWNER_EMAIL, password: OWNER_PASSWORD })).status).toBe(200);
  });

  it('rejects malformed login bodies with 400 and unknown fields', async () => {
    expect((await login({ email: OWNER_EMAIL })).status).toBe(400);
    expect((await login({ email: OWNER_EMAIL, password: 'x', admin: true })).status).toBe(400);
    expect((await login({ email: { $ne: '' }, password: 'x' })).status).toBe(400);
  });

  it('protects every data route without a session', async () => {
    for (const url of ['/api/staff', '/api/job-types', '/api/production', '/api/payroll?month=2026-11']) {
      const res = await request(ctx.app).get(url);
      expect(res.status, url).toBe(401);
    }
    expect((await request(ctx.app).get('/api/auth/me')).status).toBe(401);
  });

  it('rejects forged or garbage session cookies', async () => {
    const res = await request(ctx.app)
      .get('/api/staff')
      .set('Cookie', 'inka_sid=' + 'a'.repeat(43));
    expect(res.status).toBe(401);
  });

  it('returns the current user for /me and ends the session on logout', async () => {
    const agent = await loggedInAgent(ctx.app);
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(OWNER_EMAIL);

    expect((await agent.post('/api/auth/logout')).status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    const { rows } = await ctx.pool.query('SELECT count(*)::int AS n FROM sessions');
    expect(rows[0].n).toBe(0);
  });

  it('refuses expired sessions', async () => {
    const agent = await loggedInAgent(ctx.app);
    await ctx.pool.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('stores only a hash of the session token', async () => {
    const res = await login({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
    const token = /inka_sid=([^;]+)/.exec((res.headers['set-cookie'] as unknown as string[])[0]!)![1]!;
    const { rows } = await ctx.pool.query('SELECT token_hash FROM sessions');
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('writes login attempts to the audit log without secrets', async () => {
    await login({ email: OWNER_EMAIL, password: 'bad-password-1' });
    await login({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
    const { rows } = await ctx.pool.query('SELECT action, meta FROM audit_log ORDER BY id');
    expect(rows.map((r) => r.action)).toEqual(['auth.login_failed', 'auth.login']);
    expect(JSON.stringify(rows)).not.toContain('bad-password-1');
    expect(JSON.stringify(rows)).not.toContain(OWNER_PASSWORD);
  });
});

describe('request hardening', () => {
  it('blocks state-changing requests from other origins (CSRF)', async () => {
    const agent = await loggedInAgent(ctx.app);
    const res = await request(ctx.app)
      .post('/api/staff')
      .set('Origin', 'https://evil.example')
      .send({ fullName: 'X' });
    expect(res.status).toBe(403);
    expect((await agent.get('/api/staff')).body.staff).toHaveLength(0);
  });

  it('only accepts JSON bodies on writes (no form posts)', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .set('Origin', CLIENT_ORIGIN)
      .type('form')
      .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
    expect(res.status).toBe(403);
  });

  it('sends security headers and never caches API responses', async () => {
    const res = await request(ctx.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns JSON 400 for malformed JSON and 413 for oversized bodies', async () => {
    const bad = await request(ctx.app)
      .post('/api/auth/login')
      .set('Origin', CLIENT_ORIGIN)
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('bad_json');

    const huge = await login({ email: OWNER_EMAIL, password: 'x'.repeat(60_000) });
    expect(huge.status).toBe(413);
  });

  it('does not leak internals on unknown routes', async () => {
    const agent = await loggedInAgent(ctx.app);
    const res = await agent.get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/express|stack|node_modules/i);
  });
});

describe('rate limiting', () => {
  it('throttles repeated login attempts when enabled', async () => {
    const limited = createContext({ RATE_LIMIT_ENABLED: 'true' });
    try {
      let last = 0;
      for (let i = 0; i < 25; i += 1) {
        const res = await request(limited.app)
          .post('/api/auth/login')
          .set('Origin', CLIENT_ORIGIN)
          .send({ email: 'nobody@inka.test', password: 'whatever-123' });
        last = res.status;
        if (last === 429) break;
      }
      expect(last).toBe(429);
    } finally {
      await limited.pool.end();
    }
  });
});
