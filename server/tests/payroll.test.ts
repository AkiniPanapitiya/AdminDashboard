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

describe('job types', () => {
  it('rejects negative, fractional and absurd rates', async () => {
    for (const rateCents of [-1, 10.5, 1e12, '100']) {
      const res = await agent.post('/api/job-types', { name: 'X', rateCents });
      expect(res.status, String(rateCents)).toBe(400);
    }
  });

  it('refuses duplicate names (case-insensitive)', async () => {
    await makeJob('DTF print A4');
    const dup = await agent.post('/api/job-types', { name: 'dtf PRINT a4', rateCents: 100 });
    expect(dup.status).toBe(409);
  });
});

describe('production entries', () => {
  it('snapshots the rate so later rate changes do not rewrite history', async () => {
    const staff = await makeStaff();
    const job = await makeJob('DTF print A4', 15_000);

    const entry = await agent.post('/api/production', {
      staffId: staff.id,
      jobTypeId: job.id,
      quantity: 10,
      workDate: '2026-03-03',
    });
    expect(entry.status).toBe(201);
    expect(entry.body.entry).toMatchObject({ rateCents: 15_000, lineTotalCents: 150_000 });

    await agent.patch(`/api/job-types/${job.id}`, { rateCents: 20_000 });
    const list = await agent.get(`/api/production?staffId=${staff.id}`);
    expect(list.body.entries[0].rateCents).toBe(15_000);

    const after = await agent.post('/api/production', {
      staffId: staff.id,
      jobTypeId: job.id,
      quantity: 1,
      workDate: '2026-03-04',
    });
    expect(after.body.entry.rateCents).toBe(20_000);
  });

  it('rejects future dates, bad quantities, inactive staff or job types and unknown ids', async () => {
    const staff = await makeStaff();
    const job = await makeJob();
    const base = { staffId: staff.id, jobTypeId: job.id, quantity: 1, workDate: '2026-03-03' };

    expect((await agent.post('/api/production', { ...base, workDate: '2999-01-01' })).status).toBe(400);
    expect((await agent.post('/api/production', { ...base, workDate: '2026-02-30' })).status).toBe(400);
    for (const quantity of [0, -5, 1.5, 100_001]) {
      expect((await agent.post('/api/production', { ...base, quantity })).status, String(quantity)).toBe(400);
    }
    expect((await agent.post('/api/production', { ...base, staffId: uuid })).status).toBe(404);
    expect((await agent.post('/api/production', { ...base, jobTypeId: uuid })).status).toBe(404);

    await agent.patch(`/api/job-types/${job.id}`, { active: false });
    expect((await agent.post('/api/production', base)).status).toBe(409);
    await agent.patch(`/api/job-types/${job.id}`, { active: true });
    await agent.patch(`/api/staff/${staff.id}`, { active: false });
    expect((await agent.post('/api/production', base)).status).toBe(409);
  });

  it('filters by staff and date range, paginates, and deletes with an audit trail', async () => {
    const a = await makeStaff('Amal');
    const b = await makeStaff('Bimal');
    const job = await makeJob();
    for (const [staffId, workDate] of [
      [a.id, '2026-03-01'],
      [a.id, '2026-03-05'],
      [b.id, '2026-03-05'],
    ] as const) {
      await agent.post('/api/production', { staffId, jobTypeId: job.id, quantity: 2, workDate });
    }
    expect((await agent.get(`/api/production?staffId=${a.id}`)).body.entries).toHaveLength(2);
    expect((await agent.get('/api/production?from=2026-03-04&to=2026-03-30')).body.entries).toHaveLength(2);
    expect((await agent.get('/api/production?from=2026-03-30&to=2026-03-01')).status).toBe(400);
    expect((await agent.get('/api/production?limit=1')).body.entries).toHaveLength(1);
    expect((await agent.get('/api/production?limit=9999')).status).toBe(400);

    const first = (await agent.get('/api/production')).body.entries[0];
    expect((await agent.delete(`/api/production/${first.id}`)).status).toBe(204);
    expect((await agent.delete(`/api/production/${first.id}`)).status).toBe(404);
    const { rows } = await ctx.pool.query("SELECT meta FROM audit_log WHERE action = 'production.delete'");
    expect(rows).toHaveLength(1);
    expect(rows[0].meta).toMatchObject({ quantity: 2, rateCents: 15_000 });
  });
});

describe('payroll', () => {
  it('calculates earnings, bonuses, advances and deductions per month', async () => {
    const nimal = await makeStaff('Nimal');
    const kamal = await makeStaff('Kamal');
    const a4 = await makeJob('DTF print A4', 15_000);
    const a3 = await makeJob('DTF print A3', 25_050);

    const add = (staffId: string, jobTypeId: string, quantity: number, workDate: string) =>
      agent.post('/api/production', { staffId, jobTypeId, quantity, workDate });
    await add(nimal.id, a4.id, 10, '2026-03-02');
    await add(nimal.id, a3.id, 3, '2026-03-20'); // 3 x 250.50 = 751.50
    await add(nimal.id, a4.id, 99, '2026-02-28'); // previous month: excluded
    await add(nimal.id, a4.id, 99, '2026-04-01'); // next month: excluded
    await add(kamal.id, a4.id, 4, '2026-03-05');

    const adj = (staffId: string, kind: string, amountCents: number) =>
      agent.post('/api/payroll/adjustments', { staffId, month: '2026-03', kind, amountCents });
    expect((await adj(nimal.id, 'bonus', 50_000)).status).toBe(201);
    expect((await adj(nimal.id, 'advance', 100_000)).status).toBe(201);
    expect((await adj(nimal.id, 'deduction', 2_500)).status).toBe(201);
    // adjustment in another month must not leak into November
    await agent.post('/api/payroll/adjustments', {
      staffId: nimal.id,
      month: '2026-02',
      kind: 'advance',
      amountCents: 999_999,
    });

    const res = await agent.get('/api/payroll?month=2026-03');
    expect(res.status).toBe(200);
    const lines = res.body.payroll.lines;
    const n = lines.find((l: { fullName: string }) => l.fullName === 'Nimal');
    expect(n).toMatchObject({
      pieces: 13,
      grossCents: 150_000 + 75_150,
      bonusCents: 50_000,
      advanceCents: 100_000,
      deductionCents: 2_500,
      netCents: 150_000 + 75_150 + 50_000 - 100_000 - 2_500,
    });
    const k = lines.find((l: { fullName: string }) => l.fullName === 'Kamal');
    expect(k).toMatchObject({ pieces: 4, grossCents: 60_000, netCents: 60_000 });
    expect(res.body.payroll.totals.netCents).toBe(n.netCents + k.netCents);
  });

  it('shows a per-job breakdown and the adjustments for one person', async () => {
    const nimal = await makeStaff('Nimal');
    const job = await makeJob('DTF print A4', 15_000);
    await agent.post('/api/production', {
      staffId: nimal.id,
      jobTypeId: job.id,
      quantity: 5,
      workDate: '2026-03-02',
    });
    await agent.patch(`/api/job-types/${job.id}`, { rateCents: 20_000 });
    await agent.post('/api/production', {
      staffId: nimal.id,
      jobTypeId: job.id,
      quantity: 2,
      workDate: '2026-03-03',
    });
    await agent.post('/api/payroll/adjustments', {
      staffId: nimal.id,
      month: '2026-03',
      kind: 'bonus',
      amountCents: 1_000,
      note: 'Rush order',
    });

    const res = await agent.get(`/api/payroll/staff/${nimal.id}?month=2026-03`);
    expect(res.status).toBe(200);
    expect(res.body.breakdown).toEqual([
      { jobTypeName: 'DTF print A4', rateCents: 15_000, pieces: 5, totalCents: 75_000 },
      { jobTypeName: 'DTF print A4', rateCents: 20_000, pieces: 2, totalCents: 40_000 },
    ]);
    expect(res.body.adjustments).toHaveLength(1);
    expect(res.body.summary.netCents).toBe(116_000);
    expect((await agent.get(`/api/payroll/staff/${uuid}?month=2026-03`)).status).toBe(404);
  });

  it('validates month and adjustment input', async () => {
    const staff = await makeStaff();
    expect((await agent.get('/api/payroll')).status).toBe(400);
    expect((await agent.get('/api/payroll?month=2026-13')).status).toBe(400);
    const base = { staffId: staff.id, month: '2026-03', kind: 'bonus', amountCents: 100 };
    for (const bad of [
      { amountCents: 0 },
      { amountCents: -100 },
      { amountCents: 1.5 },
      { kind: 'gift' },
      { month: '2026-1' },
    ]) {
      expect((await agent.post('/api/payroll/adjustments', { ...base, ...bad })).status).toBe(400);
    }
    expect((await agent.post('/api/payroll/adjustments', { ...base, staffId: uuid })).status).toBe(404);
  });

  it('deletes adjustments and records it in the audit log', async () => {
    const staff = await makeStaff();
    const created = await agent.post('/api/payroll/adjustments', {
      staffId: staff.id,
      month: '2026-03',
      kind: 'advance',
      amountCents: 5_000,
    });
    const id = created.body.adjustment.id;
    expect((await agent.delete(`/api/payroll/adjustments/${id}`)).status).toBe(204);
    expect((await agent.delete(`/api/payroll/adjustments/${id}`)).status).toBe(404);
    const { rows } = await ctx.pool.query(
      "SELECT 1 FROM audit_log WHERE action = 'payroll_adjustment.delete'",
    );
    expect(rows).toHaveLength(1);
  });

  it('exports a CSV that cannot trigger spreadsheet formulas', async () => {
    const evil = await makeStaff('=cmd|calc!A1');
    const job = await makeJob('DTF print A4', 15_000);
    await agent.post('/api/production', {
      staffId: evil.id,
      jobTypeId: job.id,
      quantity: 2,
      workDate: '2026-03-02',
    });
    const res = await agent.get('/api/payroll/export.csv?month=2026-03');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('payroll-2026-03.csv');
    expect(res.text).toContain("'=cmd|calc!A1");
    expect(res.text).not.toMatch(/^=cmd/m);
  });
});
