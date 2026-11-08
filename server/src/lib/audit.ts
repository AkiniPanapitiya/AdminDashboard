import type { Request } from 'express';
import type { Queryable } from '../db.js';

export interface AuditEvent {
  action: string;
  entity?: string;
  entityId?: string;
  userId?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Appends a row to the audit log. Never put passwords, tokens or other secrets in `meta`.
 * A failure to write the log must not break the user's request, so errors are swallowed
 * (and reported through the optional logger).
 */
export async function writeAudit(db: Queryable, req: Request | undefined, event: AuditEvent): Promise<void> {
  try {
    await db.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, meta, ip)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.userId ?? req?.user?.id ?? null,
        event.action,
        event.entity ?? null,
        event.entityId ?? null,
        event.meta ? JSON.stringify(event.meta) : null,
        req?.ip ?? null,
      ],
    );
  } catch (error) {
    req?.log?.error({ err: error, action: event.action }, 'failed to write audit log');
  }
}
