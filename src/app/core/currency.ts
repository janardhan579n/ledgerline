export const CURRENCIES: ReadonlyArray<readonly [code: string, name: string]> = [
  ['MYR', 'Malaysian ringgit'], ['INR', 'Indian rupee'], ['USD', 'US dollar'], ['SGD', 'Singapore dollar'],
  ['EUR', 'Euro'], ['GBP', 'British pound'], ['AUD', 'Australian dollar'], ['AED', 'UAE dirham'],
  ['SAR', 'Saudi riyal'], ['QAR', 'Qatari riyal'], ['JPY', 'Japanese yen'], ['CNY', 'Chinese yuan'],
  ['HKD', 'Hong Kong dollar'], ['THB', 'Thai baht'], ['IDR', 'Indonesian rupiah'], ['PHP', 'Philippine peso'],
  ['VND', 'Vietnamese dong'], ['KRW', 'South Korean won'], ['CAD', 'Canadian dollar'], ['NZD', 'New Zealand dollar'],
  ['CHF', 'Swiss franc'], ['LKR', 'Sri Lankan rupee'], ['BDT', 'Bangladeshi taka'], ['PKR', 'Pakistani rupee'],
  ['NPR', 'Nepalese rupee'], ['BND', 'Brunei dollar'],
];

export const currencyName = (c: string) => CURRENCIES.find((x) => x[0] === c)?.[1] ?? c;

const cache = new Map<string, Intl.NumberFormat>();
function formatter(cur: string, compact: boolean): Intl.NumberFormat {
  const key = cur + (compact ? ':c' : '');
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-GB', {
      style: 'currency',
      currency: cur,
      currencyDisplay: 'narrowSymbol',
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 1 : undefined,
    });
    cache.set(key, f);
  }
  return f;
}

export interface MoneyOpts { compact?: boolean; sign?: boolean; abs?: boolean }

export function formatMoney(n: number | null | undefined, cur: string, opts: MoneyOpts = {}): string {
  if (n == null || Number.isNaN(n)) return '—';
  let s: string;
  try {
    s = formatter(cur, !!opts.compact).format(opts.abs ? Math.abs(n) : n);
  } catch {
    s = `${cur} ${n.toFixed(2)}`;
  }
  if (opts.sign && n > 0) s = '+' + s;
  return s;
}

/** ASCII-only money for CSV/PDF where fonts lack ₹ and similar glyphs. */
export const moneyPlain = (n: number, cur: string) =>
  `${cur} ${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isNaN(n) ? 0 : n;
}
