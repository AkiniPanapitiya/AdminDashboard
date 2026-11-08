import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, type Pool } from '../src/db.js';
import { hashPassword } from '../src/lib/password.js';

export const OWNER_EMAIL = 'owner@inka.test';
export const OWNER_PASSWORD = 'Correct-Horse-9-Battery';
export const CLIENT_ORIGIN = 'http://localhost:5173';

export interface TestContext {
  app: Express;
  pool: Pool;
  config: Config;
}

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL!,
    CLIENT_ORIGIN,
    RATE_LIMIT_ENABLED: 'false',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

export function createContext(overrides: Record<string, string> = {}): TestContext {
  const config = testConfig(overrides);
  const pool = createPool(config.DATABASE_URL);
  return { app: createApp({ pool, config }), pool, config };
}

export async function resetData(pool: Pool): Promise<void> {
  await pool.query(
    `TRUNCATE audit_log, payroll_adjustments, production_entries, job_types, staff, sessions, users
     RESTART IDENTITY CASCADE`,
  );
}

export async function createOwner(pool: Pool): Promise<void> {
  await pool.query('INSERT INTO users (email, password_hash) VALUES ($1, $2)', [
    OWNER_EMAIL,
    await hashPassword(OWNER_PASSWORD),
  ]);
}

/** A supertest agent that is already logged in as the owner. */
export async function loggedInAgent(app: Express) {
  const agent = request.agent(app);
  const response = await agent
    .post('/api/auth/login')
    .set('Origin', CLIENT_ORIGIN)
    .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
  if (response.status !== 200) throw new Error(`Login failed in test helper: ${response.status}`);
  return {
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) => agent.post(url).set('Origin', CLIENT_ORIGIN).send(body),
    patch: (url: string, body?: object) => agent.patch(url).set('Origin', CLIENT_ORIGIN).send(body),
    delete: (url: string) => agent.delete(url).set('Origin', CLIENT_ORIGIN),
  };
}

export type Agent = Awaited<ReturnType<typeof loggedInAgent>>;
