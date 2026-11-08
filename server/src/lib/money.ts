/**
 * Money helpers. All amounts are integer cents (1 LKR = 100 cents) so that sums are exact.
 */

/** Net pay = piece-rate earnings + bonuses - advances - deductions. May be negative. */
export function computeNetCents(parts: {
  grossCents: number;
  bonusCents: number;
  advanceCents: number;
  deductionCents: number;
}): number {
  const values = Object.values(parts);
  if (!values.every((value) => Number.isSafeInteger(value))) {
    throw new RangeError('Payroll amounts must be safe integers (cents)');
  }
  return parts.grossCents + parts.bonusCents - parts.advanceCents - parts.deductionCents;
}

/** Earnings of one production entry. */
export function lineTotalCents(quantity: number, rateCents: number): number {
  const total = quantity * rateCents;
  if (!Number.isSafeInteger(total)) throw new RangeError('Line total is too large');
  return total;
}
