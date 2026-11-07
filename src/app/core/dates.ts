const pad = (n: number) => String(n).padStart(2, '0');

export const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => toISO(new Date());
export const monthKey = (iso: string) => iso.slice(0, 7);
export const currentMonth = () => todayISO().slice(0, 7);
export const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

export function addMonths(key: string, n: number): string {
  let [y, m] = key.split('-').map(Number);
  m += n;
  while (m > 12) { m -= 12; y++; }
  while (m < 1) { m += 12; y--; }
  return `${y}-${pad(m)}`;
}

export function monthsBetween(fromISO: string, toISOStr: string): number {
  const [y1, m1] = fromISO.split('-').map(Number);
  const [y2, m2] = toISOStr.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

export function periodRange(kind: 'month' | 'year', key: string): [string, string] {
  if (kind === 'year') return [`${key}-01-01`, `${key}-12-31`];
  const [y, m] = key.split('-').map(Number);
  return [`${key}-01`, `${key}-${pad(daysInMonth(y, m))}`];
}

export function monthLabel(key: string, style: 'long' | 'short' | 'shortY' = 'long'): string {
  const [y, m] = key.split('-').map(Number);
  const opts: Intl.DateTimeFormatOptions =
    style === 'short' ? { month: 'short' } : style === 'shortY' ? { month: 'short', year: '2-digit' } : { month: 'long', year: 'numeric' };
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', opts);
}

export function dateLabel(iso: string, withYear = false): string {
  const [y, m, d] = iso.split('-').map(Number);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (withYear || y !== new Date().getFullYear()) opts.year = 'numeric';
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', opts);
}

export function weekday(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short' });
}

export function daysUntil(iso: string, from = todayISO()): number {
  const a = new Date(from + 'T00:00:00');
  const b = new Date(iso + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / 864e5);
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toISO(new Date(y, m - 1, d + n));
}
