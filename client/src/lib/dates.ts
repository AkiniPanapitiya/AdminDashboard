const TIME_ZONE = 'Asia/Colombo';

/** Today's date as YYYY-MM-DD in the business time zone. */
export function today(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Current month as YYYY-MM in the business time zone. */
export function currentMonth(now: Date = new Date()): string {
  return today(now).slice(0, 7);
}
