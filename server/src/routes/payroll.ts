import { Router } from 'express';
import { z } from 'zod';
import type { Pool } from '../db.js';
import { notFound } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import { monthRange } from '../lib/dates.js';
import { getPayroll, payrollToCsv } from '../services/payroll.js';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must look like YYYY-MM');
const idParam = z.object({ id: z.uuid() });

const monthQuery = z.object({ month });
const adjustmentListQuery = z.object({ month, staffId: z.uuid().optional() });

const adjustmentSchema = z.strictObject({
  staffId: z.uuid(),
  month,
  kind: z.enum(['bonus', 'advance', 'deduction']),
  amountCents: z.number().int().min(1).max(1_000_000_000),
  note: z.string().trim().max(500).optional(),
});

interface AdjustmentRow {
  id: string;
  staff_id: string;
  staff_name: string;
  period: string;
  kind: 'bonus' | 'advance' | 'deduction';
  amount_cents: number;
  note: string | null;
  created_at: Date;
}

const toAdjustmentDto = (row: AdjustmentRow) => ({
  id: row.id,
  staffId: row.staff_id,
  staffName: row.staff_name,
  month: row.period.slice(0, 7),
  kind: row.kind,
  amountCents: row.amount_cents,
  note: row.note,
  createdAt: row.created_at,
});

const SELECT_ADJUSTMENT = `
  SELECT a.id, a.staff_id, s.full_name AS staff_name, a.period, a.kind, a.amount_cents, a.note, a.created_at
    FROM payroll_adjustments a
    JOIN staff s ON s.id = a.staff_id`;

export function payrollRouter(pool: Pool) {
  const router = Router();

  router.get('/', async (req, res) => {
    const query = monthQuery.parse(req.query);
    res.json({ payroll: await getPayroll(pool, query.month) });
  });

  router.get('/export.csv', async (req, res) => {
    const query = monthQuery.parse(req.query);
    const summary = await getPayroll(pool, query.month);
    await writeAudit(pool, req, { action: 'payroll.export', meta: { month: query.month } });
    res
      .type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="payroll-${query.month}.csv"`)
      .set('Cache-Control', 'no-store')
      .send(payrollToCsv(summary));
  });

  // --- adjustments (bonus / advance / deduction) ---

  router.get('/adjustments', async (req, res) => {
    const query = adjustmentListQuery.parse(req.query);
    const { start } = monthRange(query.month);
    const { rows } = await pool.query<AdjustmentRow>(
      `${SELECT_ADJUSTMENT}
        WHERE a.period = $1::date AND ($2::uuid IS NULL OR a.staff_id = $2)
        ORDER BY a.created_at DESC`,
      [start, query.staffId ?? null],
    );
    res.json({ adjustments: rows.map(toAdjustmentDto) });
  });

  router.post('/adjustments', async (req, res) => {
    const body = adjustmentSchema.parse(req.body);
    const { start } = monthRange(body.month);
    const staff = await pool.query('SELECT 1 FROM staff WHERE id = $1', [body.staffId]);
    if (staff.rowCount === 0) throw notFound('Staff member');

    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO payroll_adjustments (staff_id, period, kind, amount_cents, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [body.staffId, start, body.kind, body.amountCents, body.note || null, req.user!.id],
    );
    const id = inserted.rows[0]!.id;
    const { rows } = await pool.query<AdjustmentRow>(`${SELECT_ADJUSTMENT} WHERE a.id = $1`, [id]);
    await writeAudit(pool, req, {
      action: 'payroll_adjustment.create',
      entity: 'payroll_adjustment',
      entityId: id,
      meta: { staffId: body.staffId, kind: body.kind, amountCents: body.amountCents, month: body.month },
    });
    res.status(201).json({ adjustment: toAdjustmentDto(rows[0]!) });
  });

  router.delete('/adjustments/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { rows } = await pool.query<{ staff_id: string; kind: string; amount_cents: number }>(
      'DELETE FROM payroll_adjustments WHERE id = $1 RETURNING staff_id, kind, amount_cents',
      [id],
    );
    if (!rows[0]) throw notFound('Adjustment');
    await writeAudit(pool, req, {
      action: 'payroll_adjustment.delete',
      entity: 'payroll_adjustment',
      entityId: id,
      meta: { staffId: rows[0].staff_id, kind: rows[0].kind, amountCents: rows[0].amount_cents },
    });
    res.status(204).end();
  });

  // --- one person's month: summary, per-job breakdown and adjustments ---

  router.get('/staff/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    const query = monthQuery.parse(req.query);
    const { start, end } = monthRange(query.month);

    const summary = await getPayroll(pool, query.month, id);
    const line = summary.lines[0];
    if (!line) throw notFound('Staff member');

    const [byJob, adjustments] = await Promise.all([
      pool.query<{ job_type_name: string; rate_cents: number; pieces: number; total: number }>(
        `SELECT job_type_name, rate_cents,
                SUM(quantity)::bigint AS pieces,
                SUM(quantity * rate_cents)::bigint AS total
           FROM production_entries
          WHERE staff_id = $1 AND work_date >= $2::date AND work_date < $3::date
          GROUP BY job_type_name, rate_cents
          ORDER BY job_type_name, rate_cents`,
        [id, start, end],
      ),
      pool.query<AdjustmentRow>(
        `${SELECT_ADJUSTMENT} WHERE a.staff_id = $1 AND a.period = $2::date ORDER BY a.created_at`,
        [id, start],
      ),
    ]);

    res.json({
      month: query.month,
      summary: line,
      breakdown: byJob.rows.map((row) => ({
        jobTypeName: row.job_type_name,
        rateCents: row.rate_cents,
        pieces: row.pieces,
        totalCents: row.total,
      })),
      adjustments: adjustments.rows.map(toAdjustmentDto),
    });
  });

  return router;
}
