import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { testConfig } from './helpers.js';

let root: string;
const config = () => testConfig({ CLIENT_DIST: path.join(root, 'dist') });
const pool = createPool(testConfig().DATABASE_URL);

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'inka-static-'));
  await mkdir(path.join(root, 'dist', 'assets'), { recursive: true });
  await writeFile(path.join(root, 'dist', 'index.html'), '<!doctype html><title>app</title>');
  await writeFile(path.join(root, 'dist', 'assets', 'app.js'), 'console.log(1)');
  await writeFile(path.join(root, 'secret.txt'), 'TOP-SECRET');
});
afterAll(async () => {
  await pool.end();
  await rm(root, { recursive: true, force: true });
});

describe('serving the built web app', () => {
  it('serves assets and falls back to index.html for client-side routes', async () => {
    const app = createApp({ pool, config: config() });
    expect((await request(app).get('/assets/app.js')).text).toBe('console.log(1)');
    const page = await request(app).get('/payroll');
    expect(page.status).toBe(200);
    expect(page.text).toContain('<title>app</title>');
    expect(page.headers['cache-control']).toBe('no-cache');
  });

  it('never serves files outside the dist folder', async () => {
    const app = createApp({ pool, config: config() });
    for (const url of ['/../secret.txt', '/assets/..%2f..%2fsecret.txt', '/%2e%2e/secret.txt']) {
      const res = await request(app).get(url);
      expect(res.text, url).not.toContain('TOP-SECRET');
    }
  });

  it('keeps unknown /api routes as JSON errors, not the HTML page', async () => {
    const app = createApp({ pool, config: config() });
    const res = await request(app).get('/api/nope');
    expect(res.headers['content-type']).toMatch(/json/);
  });
});
