import type { Queryable } from '../db.js';
import { monthRange } from '../lib/dates.js';
import { computeNetCents } from '../lib/money.js';

export interface PayrollLine {
  staffId: string;
  fullName: string;
  active: boolean;
  pieces: number;
  grossCents: number;
  bonusCents: number;
  advanceCents: number;
  deductionCents: number;
  netCents: number;
}

export interface PayrollSummary {
  month: string;
  lines: PayrollLine[];
  totals: Omit<PayrollLine, 'staffId' | 'fullName' | 'active'>;
}

interface SummaryRow {
  staff_id: string;
  full_name: string;
  active: boolean;
  pieces: number;
  gross: number;
  bonus: number;
  advance: number;
  deduction: number;
}

const SUMMARY_SQL = `
  WITH earnings AS (
    SELECT staff_id,
           SUM(quantity)::bigint               AS pieces,
           SUM(quantity * rate_cents)::bigint  AS gross
      FROM production_entries
     WHERE work_date >= $1::date AND work_date < $2::date
       AND ($3::uuid IS NULL OR staff_id = $3)
     GROUP BY staff_id
  ), adjustments AS (
    SELECT staff_id,
           COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'bonus'), 0)::bigint     AS bonus,
           COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'advance'), 0)::bigint   AS advance,
           COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'deduction'), 0)::bigint AS deduction
      FROM payroll_adjustments
     WHERE period = $1::date
       AND ($3::uuid IS NULL OR staff_id = $3)
     GROUP BY staff_id
  )
  SELECT s.id AS staff_id, s.full_name, s.active,
         COALESCE(e.pieces, 0)::bigint    AS pieces,
         COALESCE(e.gross, 0)::bigint     AS gross,
         COALESCE(a.bonus, 0)::bigint     AS bonus,
         COALESCE(a.advance, 0)::bigint   AS advance,
         COALESCE(a.deduction, 0)::bigint AS deduction
    FROM staff s
    LEFT JOIN earnings e    ON e.staff_id = s.id
    LEFT JOIN adjustments a ON a.staff_id = s.id
   WHERE ($3::uuid IS NULL OR s.id = $3)
     AND (s.active OR e.staff_id IS NOT NULL OR a.staff_id IS NOT NULL)
   ORDER BY lower(s.full_name), s.id`;

/** Monthly payroll for every relevant staff member (or just one when staffId is given). */
export async function getPayroll(db: Queryable, month: string, staffId?: string): Promise<PayrollSummary> {
  const { start, end } = monthRange(month);
  const { rows } = await db.query<SummaryRow>(SUMMARY_SQL, [start, end, staffId ?? null]);

  const lines: PayrollLine[] = rows.map((row) => ({
    staffId: row.staff_id,
    fullName: row.full_name,
    active: row.active,
    pieces: row.pieces,
    grossCents: row.gross,
    bonusCents: row.bonus,
    advanceCents: row.advance,
    deductionCents: row.deduction,
    netCents: computeNetCents({
      grossCents: row.gross,
      bonusCents: row.bonus,
      advanceCents: row.advance,
      deductionCents: row.deduction,
    }),
  }));

  const sum = (pick: (line: PayrollLine) => number) => lines.reduce((total, line) => total + pick(line), 0);

  return {
    month,
    lines,
    totals: {
      pieces: sum((l) => l.pieces),
      grossCents: sum((l) => l.grossCents),
      bonusCents: sum((l) => l.bonusCents),
      advanceCents: sum((l) => l.advanceCents),
      deductionCents: sum((l) => l.deductionCents),
      netCents: sum((l) => l.netCents),
    },
  };
}

/** Escapes a CSV cell and neutralises spreadsheet formulas (CSV injection). */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const cents = (value: number) => (value / 100).toFixed(2);

export function payrollToCsv(summary: PayrollSummary): string {
  const header = ['Staff', 'Pieces', 'Earnings', 'Bonus', 'Advances', 'Deductions', 'Net pay'];
  const rows = summary.lines.map((line) => [
    line.fullName,
    line.pieces,
    cents(line.grossCents),
    cents(line.bonusCents),
    cents(line.advanceCents),
    cents(line.deductionCents),
    cents(line.netCents),
  ]);
  const t = summary.totals;
  rows.push([
    'TOTAL',
    t.pieces,
    cents(t.grossCents),
    cents(t.bonusCents),
    cents(t.advanceCents),
    cents(t.deductionCents),
    cents(t.netCents),
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
