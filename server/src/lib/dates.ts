/** Today's calendar date ("YYYY-MM-DD") in the given IANA time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  // The en-CA locale formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** "2026-11" -> { start: "2026-11-01", end: "2026-12-01" } (end is exclusive). */
export function monthRange(month: string): { start: string; end: string } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new RangeError('Month must look like YYYY-MM');
  const year = Number(match[1]);
  const monthIndex = Number(match[2]);
  const nextYear = monthIndex === 12 ? year + 1 : year;
  const nextMonth = monthIndex === 12 ? 1 : monthIndex + 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  return { start: `${year}-${pad(monthIndex)}-01`, end: `${nextYear}-${pad(nextMonth)}-01` };
}
