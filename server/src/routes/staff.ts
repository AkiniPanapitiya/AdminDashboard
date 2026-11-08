import { Router } from 'express';
import { z } from 'zod';
import type { Pool } from '../db.js';
import { notFound } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';

const idParam = z.object({ id: z.uuid() });

const phone = z
  .string()
  .trim()
  .max(30)
  .regex(/^[0-9+()\-\s]*$/, 'Phone may only contain digits, spaces, + ( ) -')
  .transform((value) => (value === '' ? null : value));

const createSchema = z.strictObject({
  fullName: z.string().trim().min(1).max(120),
  phone: phone.nullish(),
});

const updateSchema = z
  .strictObject({
    fullName: z.string().trim().min(1).max(120).optional(),
    phone: phone.nullish(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

const listQuery = z.object({
  active: z.enum(['true', 'false']).optional(),
});

interface StaffRow {
  id: string;
  full_name: string;
  phone: string | null;
  active: boolean;
  created_at: Date;
}

const toDto = (row: StaffRow) => ({
  id: row.id,
  fullName: row.full_name,
  phone: row.phone,
  active: row.active,
  createdAt: row.created_at,
});

export function staffRouter(pool: Pool) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { active } = listQuery.parse(req.query);
    const { rows } = await pool.query<StaffRow>(
      `SELECT id, full_name, phone, active, created_at
         FROM staff
        WHERE ($1::boolean IS NULL OR active = $1::boolean)
        ORDER BY active DESC, lower(full_name)`,
      [active === undefined ? null : active === 'true'],
    );
    res.json({ staff: rows.map(toDto) });
  });

  router.post('/', async (req, res) => {
    const body = createSchema.parse(req.body);
    const { rows } = await pool.query<StaffRow>(
      `INSERT INTO staff (full_name, phone) VALUES ($1, $2)
       RETURNING id, full_name, phone, active, created_at`,
      [body.fullName, body.phone ?? null],
    );
    const row = rows[0]!;
    await writeAudit(pool, req, { action: 'staff.create', entity: 'staff', entityId: row.id });
    res.status(201).json({ staff: toDto(row) });
  });

  router.get('/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { rows } = await pool.query<StaffRow>(
      'SELECT id, full_name, phone, active, created_at FROM staff WHERE id = $1',
      [id],
    );
    if (!rows[0]) throw notFound('Staff member');
    res.json({ staff: toDto(rows[0]) });
  });

  // Staff are never hard-deleted: past production and payroll must stay explainable.
  // Set active=false to retire someone instead.
  router.patch('/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = updateSchema.parse(req.body);
    const { rows } = await pool.query<StaffRow>(
      `UPDATE staff
          SET full_name  = COALESCE($2, full_name),
              phone      = CASE WHEN $3::boolean THEN $4 ELSE phone END,
              active     = COALESCE($5, active),
              updated_at = now()
        WHERE id = $1
        RETURNING id, full_name, phone, active, created_at`,
      [id, body.fullName ?? null, 'phone' in body, body.phone ?? null, body.active ?? null],
    );
    if (!rows[0]) throw notFound('Staff member');
    await writeAudit(pool, req, {
      action: 'staff.update',
      entity: 'staff',
      entityId: id,
      meta: { fields: Object.keys(body) },
    });
    res.json({ staff: toDto(rows[0]) });
  });

  return router;
}
