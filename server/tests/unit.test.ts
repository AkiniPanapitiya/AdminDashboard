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

describe('dates', () => {
  it('builds month ranges, including December rollover', () => {
    expect(monthRange('2026-11')).toEqual({ start: '2026-11-01', end: '2026-12-01' });
    expect(monthRange('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
  });

  it('rejects bad month strings', () => {
    for (const bad of ['2026-13', '2026-00', '26-01', '2026/01', '', '2026-1']) {
      expect(() => monthRange(bad)).toThrow();
    }
  });

  it('uses the business time zone to decide what today is', () => {
    const instant = new Date('2026-11-08T20:00:00Z'); // already 9 Nov 01:30 in Colombo
    expect(todayIn('Asia/Colombo', instant)).toBe('2026-11-09');
    expect(todayIn('UTC', instant)).toBe('2026-11-08');
  });
});

describe('passwords', () => {
  it('enforces length and character mix', () => {
    expect(passwordSchema.safeParse('short1A').success).toBe(false);
    expect(passwordSchema.safeParse('alllowercase123456').success).toBe(false);
    expect(passwordSchema.safeParse('NoDigitsInHereAtAll').success).toBe(false);
    expect(passwordSchema.safeParse('Valid-Passw0rd-123').success).toBe(true);
  });

  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword('Valid-Passw0rd-123');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'Valid-Passw0rd-123')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});

describe('csv export', () => {
  it('neutralises spreadsheet formulas and escapes quotes', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('Nimal, Perera')).toBe('"Nimal, Perera"');
    expect(csvCell(42)).toBe('42');
  });

  it('writes totals row with 2-decimal amounts', () => {
    const csv = payrollToCsv({
      month: '2026-11',
      lines: [
        {
          staffId: 'x',
          fullName: 'Kamal',
          active: true,
          pieces: 10,
          grossCents: 150_000,
          bonusCents: 0,
          advanceCents: 50_000,
          deductionCents: 0,
          netCents: 100_000,
        },
      ],
      totals: {
        pieces: 10,
        grossCents: 150_000,
        bonusCents: 0,
        advanceCents: 50_000,
        deductionCents: 0,
        netCents: 100_000,
      },
    });
    expect(csv.split('\r\n')[1]).toBe('Kamal,10,1500.00,0.00,500.00,0.00,1000.00');
    expect(csv.split('\r\n')[2]).toBe('TOTAL,10,1500.00,0.00,500.00,0.00,1000.00');
  });
});

describe('config', () => {
  it('fails fast with a readable message when required settings are missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('forces secure cookies in production', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x', COOKIE_SECURE: 'false' }),
    ).toThrow(/COOKIE_SECURE/);
    expect(loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' }).COOKIE_SECURE).toBe(true);
  });
});
