/** Integer cents -> "LKR 1,234.50". Money is never handled as floating point in the app. */
const formatter = new Intl.NumberFormat('en-LK', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}LKR ${formatter.format(Math.abs(cents) / 100)}`;
}

/** "1234.5" -> 123450. Returns null for anything that is not a valid non-negative amount with <= 2 decimals. */
export function parseAmountToCents(input: string): number | null {
  const text = input.trim().replace(/,/g, '');
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  return whole * 100 + fraction;
}
