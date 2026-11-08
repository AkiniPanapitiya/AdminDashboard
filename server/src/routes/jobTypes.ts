import { Router } from 'express';
import { z } from 'zod';
import type { Pool } from '../db.js';
import { notFound } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';

const idParam = z.object({ id: z.uuid() });

// rateCents is an integer number of cents (e.g. LKR 150.00 = 15000).
const rateCents = z.number().int().min(0).max(100_000_000);

const createSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  rateCents,
});

const updateSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80).optional(),
    rateCents: rateCents.optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

interface JobTypeRow {
  id: string;
  name: string;
  rate_cents: number;
  active: boolean;
}

const toDto = (row: JobTypeRow) => ({
  id: row.id,
  name: row.name,
  rateCents: row.rate_cents,
  active: row.active,
});

export function jobTypesRouter(pool: Pool) {
  const router = Router();

  router.get('/', async (_req, res) => {
    const { rows } = await pool.query<JobTypeRow>(
      'SELECT id, name, rate_cents, active FROM job_types ORDER BY active DESC, lower(name)',
    );
    res.json({ jobTypes: rows.map(toDto) });
  });

  router.post('/', async (req, res) => {
    const body = createSchema.parse(req.body);
    const { rows } = await pool.query<JobTypeRow>(
      'INSERT INTO job_types (name, rate_cents) VALUES ($1, $2) RETURNING id, name, rate_cents, active',
      [body.name, body.rateCents],
    );
    const row = rows[0]!;
    await writeAudit(pool, req, {
      action: 'job_type.create',
      entity: 'job_type',
      entityId: row.id,
      meta: { rateCents: row.rate_cents },
    });
    res.status(201).json({ jobType: toDto(row) });
  });

  // Changing a rate only affects NEW production entries; old entries keep their snapshot.
  router.patch('/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = updateSchema.parse(req.body);
    const { rows } = await pool.query<JobTypeRow>(
      `UPDATE job_types
          SET name       = COALESCE($2, name),
              rate_cents = COALESCE($3, rate_cents),
              active     = COALESCE($4, active),
              updated_at = now()
        WHERE id = $1
        RETURNING id, name, rate_cents, active`,
      [id, body.name ?? null, body.rateCents ?? null, body.active ?? null],
    );
    if (!rows[0]) throw notFound('Job type');
    await writeAudit(pool, req, {
      action: 'job_type.update',
      entity: 'job_type',
      entityId: id,
      meta: { fields: Object.keys(body), rateCents: body.rateCents },
    });
    res.json({ jobType: toDto(rows[0]) });
  });

  return router;
}
