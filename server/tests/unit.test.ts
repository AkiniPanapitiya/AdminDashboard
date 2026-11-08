import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { monthRange, todayIn } from '../src/lib/dates.js';
import { computeNetCents, lineTotalCents } from '../src/lib/money.js';
import { hashPassword, passwordSchema, verifyPassword } from '../src/lib/password.js';
import { csvCell, payrollToCsv } from '../src/services/payroll.js';

describe('money', () => {
  it('computes net pay from earnings, bonus, advances and deductions', () => {
    expect(
      computeNetCents({
        grossCents: 100_000,
        bonusCents: 5_000,
        advanceCents: 20_000,
        deductionCents: 1_500,
      }),
    ).toBe(83_500);
  });

  it('can be negative when advances exceed earnings (so the owner notices)', () => {
    expect(
      computeNetCents({ grossCents: 1_000, bonusCents: 0, advanceCents: 5_000, deductionCents: 0 }),
    ).toBe(-4_000);
  });

  it('rejects fractional cents', () => {
    expect(() =>
      computeNetCents({ grossCents: 10.5, bonusCents: 0, advanceCents: 0, deductionCents: 0 }),
    ).toThrow(RangeError);
  });

  it('multiplies quantity by rate exactly', () => {
    expect(lineTotalCents(3, 12_050)).toBe(36_150);
    expect(() => lineTotalCents(Number.MAX_SAFE_INTEGER, 2)).toThrow(RangeError);
  });
});
