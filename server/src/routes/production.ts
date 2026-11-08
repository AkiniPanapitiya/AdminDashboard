import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../config.js';
import { withTransaction, type Pool } from '../db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import { todayIn } from '../lib/dates.js';

const idParam = z.object({ id: z.uuid() });

const createSchema = z.strictObject({
  staffId: z.uuid(),
  jobTypeId: z.uuid(),
  quantity: z.number().int().min(1).max(100_000),
  workDate: z.iso.date(),
  note: z.string().trim().max(500).optional(),
});

const listQuery = z.object({
  staffId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

interface EntryRow {
  id: string;
  staff_id: string;
  staff_name: string;
  job_type_name: string;
  quantity: number;
  rate_cents: number;
  line_total_cents: number;
  work_date: string;
  note: string | null;
  created_at: Date;
}

const toDto = (row: EntryRow) => ({
  id: row.id,
  staffId: row.staff_id,
  staffName: row.staff_name,
  jobTypeName: row.job_type_name,
  quantity: row.quantity,
  rateCents: row.rate_cents,
  lineTotalCents: row.line_total_cents,
  workDate: row.work_date,
  note: row.note,
  createdAt: row.created_at,
});

const SELECT_ENTRY = `
  SELECT e.id, e.staff_id, s.full_name AS staff_name, e.job_type_name, e.quantity, e.rate_cents,
         (e.quantity * e.rate_cents)::bigint AS line_total_cents,
         e.work_date, e.note, e.created_at
    FROM production_entries e
    JOIN staff s ON s.id = e.staff_id`;

export function productionRouter(pool: Pool, config: Config) {
  const router = Router();

  router.get('/', async (req, res) => {
    const query = listQuery.parse(req.query);
    if (query.from && query.to && query.from > query.to) {
      throw badRequest('"from" must not be after "to"');
    }
    const { rows } = await pool.query<EntryRow>(
      `${SELECT_ENTRY}
        WHERE ($1::uuid IS NULL OR e.staff_id = $1)
          AND ($2::date IS NULL OR e.work_date >= $2)
          AND ($3::date IS NULL OR e.work_date <= $3)
        ORDER BY e.work_date DESC, e.created_at DESC
        LIMIT $4 OFFSET $5`,
      [query.staffId ?? null, query.from ?? null, query.to ?? null, query.limit, query.offset],
    );
    res.json({ entries: rows.map(toDto), limit: query.limit, offset: query.offset });
  });

  router.post('/', async (req, res) => {
    const body = createSchema.parse(req.body);
    if (body.workDate > todayIn(config.BUSINESS_TZ)) {
      throw badRequest('Work date cannot be in the future');
    }

    const entry = await withTransaction(pool, async (client) => {
      const staff = await client.query<{ active: boolean }>('SELECT active FROM staff WHERE id = $1', [
        body.staffId,
      ]);
      if (!staff.rows[0]) throw notFound('Staff member');
      if (!staff.rows[0].active) throw conflict('Staff member is inactive');

      const job = await client.query<{ name: string; rate_cents: number; active: boolean }>(
        'SELECT name, rate_cents, active FROM job_types WHERE id = $1',
        [body.jobTypeId],
      );
      const jobType = job.rows[0];
      if (!jobType) throw notFound('Job type');
      if (!jobType.active) throw conflict('Job type is inactive');

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO production_entries
           (staff_id, job_type_id, job_type_name, quantity, rate_cents, work_date, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          body.staffId,
          body.jobTypeId,
          jobType.name,
          body.quantity,
          jobType.rate_cents,
          body.workDate,
          body.note || null,
          req.user!.id,
        ],
      );
      const id = inserted.rows[0]!.id;
      const { rows } = await client.query<EntryRow>(`${SELECT_ENTRY} WHERE e.id = $1`, [id]);
      return rows[0]!;
    });

    await writeAudit(pool, req, {
      action: 'production.create',
      entity: 'production_entry',
      entityId: entry.id,
      meta: { staffId: entry.staff_id, quantity: entry.quantity, rateCents: entry.rate_cents },
    });
    res.status(201).json({ entry: toDto(entry) });
  });

  router.delete('/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { rows } = await pool.query<{
      staff_id: string;
      quantity: number;
      rate_cents: number;
      work_date: string;
    }>(
      `DELETE FROM production_entries WHERE id = $1
       RETURNING staff_id, quantity, rate_cents, work_date`,
      [id],
    );
    const removed = rows[0];
    if (!removed) throw notFound('Production entry');
    await writeAudit(pool, req, {
      action: 'production.delete',
      entity: 'production_entry',
      entityId: id,
      meta: {
        staffId: removed.staff_id,
        quantity: removed.quantity,
        rateCents: removed.rate_cents,
        workDate: removed.work_date,
      },
    });
    res.status(204).end();
  });

  return router;
}
