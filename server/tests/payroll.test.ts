import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createContext, createOwner, loggedInAgent, resetData, type Agent } from './helpers.js';

const ctx = createContext();
let agent: Agent;

afterAll(() => ctx.pool.end());
beforeEach(async () => {
  await resetData(ctx.pool);
  await createOwner(ctx.pool);
  agent = await loggedInAgent(ctx.app);
});

const uuid = '00000000-0000-4000-8000-000000000000';

async function makeStaff(fullName = 'Nimal Perera') {
  const res = await agent.post('/api/staff', { fullName, phone: '077 123 4567' });
  expect(res.status).toBe(201);
  return res.body.staff as { id: string; fullName: string; active: boolean };
}

async function makeJob(name = 'DTF print A4', rateCents = 15_000) {
  const res = await agent.post('/api/job-types', { name, rateCents });
  expect(res.status).toBe(201);
  return res.body.jobType as { id: string; rateCents: number };
}

describe('staff', () => {
  it('creates, lists, updates and deactivates (never hard-deletes)', async () => {
    const staff = await makeStaff();
    expect((await agent.get('/api/staff')).body.staff).toHaveLength(1);

    const updated = await agent.patch(`/api/staff/${staff.id}`, { fullName: 'Nimal P.', phone: '' });
    expect(updated.body.staff).toMatchObject({ fullName: 'Nimal P.', phone: null });

    await agent.patch(`/api/staff/${staff.id}`, { active: false });
    expect((await agent.get('/api/staff?active=true')).body.staff).toHaveLength(0);
    expect((await agent.get('/api/staff?active=false')).body.staff).toHaveLength(1);
    expect((await agent.delete(`/api/staff/${staff.id}`)).status).toBe(404);
  });

  it('validates input', async () => {
    expect((await agent.post('/api/staff', { fullName: '   ' })).status).toBe(400);
    expect((await agent.post('/api/staff', { fullName: 'A', phone: 'abc' })).status).toBe(400);
    expect((await agent.post('/api/staff', { fullName: 'A', role: 'admin' })).status).toBe(400);
    expect((await agent.get('/api/staff/not-a-uuid')).status).toBe(400);
    expect((await agent.get(`/api/staff/${uuid}`)).status).toBe(404);
    expect((await agent.patch(`/api/staff/${uuid}`, {})).status).toBe(400);
  });

  it('is safe against SQL injection attempts', async () => {
    await makeStaff();
    const res = await agent.get(`/api/staff?active=${encodeURIComponent("true' OR '1'='1")}`);
    expect(res.status).toBe(400);
    const created = await agent.post('/api/staff', { fullName: "Robert'); DROP TABLE staff;--" });
    expect(created.status).toBe(201);
    expect((await agent.get('/api/staff')).body.staff).toHaveLength(2);
  });
});
