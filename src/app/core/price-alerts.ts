/**
 * Price alerts: what to watch (gold, silver, a currency pair), the rules that trigger a notification,
 * and the evaluation the scheduled job runs every hour. Pure TypeScript with no Angular imports,
 * so both the app and the job (scripts/price-alerts/run.ts) use exactly the same code.
 */

export const TROY_OZ_G = 31.1034768;

export type Asset = 'gold' | 'silver' | 'fx';
export type MetalUnit = 'g' | '10g' | 'oz' | 'kg';
export type RuleKind = 'daily' | 'above' | 'below' | 'move';

export interface PriceAlert {
  id: string;
  asset: Asset;
  /** Metals: the currency of the price. FX: the "to" currency (1 base = x currency). */
  currency: string;
  /** FX only: the "from" currency. */
  base?: string;
  unit?: MetalUnit;
  /** Gold only: 24K = 0.999, 22K = 0.916, 18K = 0.75. */
  purity?: number;
  kind: RuleKind;
  /** above/below: the price; move: percent. */
  value?: number;
  /** above/below/move: notify once and stop, or every time it happens again. */
  repeat?: 'once' | 'every';
  active: boolean;
  /** Changes whenever the rule is edited, so the job starts it fresh. */
  rev: string;
}

export interface AlertSettings {
  alerts: PriceAlert[];
  /** Hour of the day (0-23) for daily updates, in `timezone`. */
  dailyHour: number;
  timezone: string;
  ntfy: { on: boolean; topic: string };
  push: { on: boolean };
  updatedAt?: string;
}

/** Written only by the job. One entry per alert, keyed by id. */
export interface AlertState {
  lastRun?: string;
  lastError?: string;
  lastDaily?: string;
  rules: Record<string, RuleState>;
  quotes?: Quotes;
}
export interface RuleState {
  rev: string;
  /** above/below: ready to fire again. */
  armed?: boolean;
  /** once-rules that already fired. */
  done?: boolean;
  firedAt?: string;
  firedValue?: number;
  /** move: price the change is measured from. daily: yesterday's price. */
  ref?: number;
}

/** Market prices: metals in USD per gram, currencies as units per 1 USD. */
export interface Quotes {
  goldUsdG: number | null;
  silverUsdG: number | null;
  usd: Record<string, number>;
  asOf: string;
}

export const ALERT_DEFAULTS: AlertSettings = { alerts: [], dailyHour: 9, timezone: 'Asia/Kuala_Lumpur', ntfy: { on: false, topic: '' }, push: { on: false } };

export const UNIT_GRAMS: Record<MetalUnit, number> = { g: 1, '10g': 10, oz: TROY_OZ_G, kg: 1000 };
export const UNIT_LABEL: Record<MetalUnit, string> = { g: 'per gram', '10g': 'per 10 g', oz: 'per troy ounce', kg: 'per kg' };
export const PURITIES: ReadonlyArray<[number, string]> = [[0.999, '24K (999)'], [0.916, '22K (916)'], [0.75, '18K (750)']];

/** Units of `to` for one unit of `from`. */
export function fxRate(q: Quotes, from: string, to: string): number | null {
  const a = from === 'USD' ? 1 : q.usd[from];
  const b = to === 'USD' ? 1 : q.usd[to];
  return a && b ? b / a : null;
}

/** Current value of what an alert watches, or null if a price is missing. */
export function alertValue(a: Pick<PriceAlert, 'asset' | 'currency' | 'base' | 'unit' | 'purity'>, q: Quotes): number | null {
  if (a.asset === 'fx') return fxRate(q, a.base ?? 'MYR', a.currency);
  const usdG = a.asset === 'gold' ? q.goldUsdG : q.silverUsdG;
  const fx = fxRate(q, 'USD', a.currency);
  if (usdG == null || fx == null) return null;
  // Spot prices are for pure (999) metal; lower karats scale down from that.
  const purity = a.asset === 'gold' ? (a.purity ?? 0.999) / 0.999 : 1;
  return usdG * fx * UNIT_GRAMS[a.unit ?? 'g'] * purity;
}

/** Short name of what is watched, e.g. "Gold 22K per gram in MYR" or "1 MYR in INR". */
export function alertSubject(a: Pick<PriceAlert, 'asset' | 'currency' | 'base' | 'unit' | 'purity'>): string {
  if (a.asset === 'fx') return `1 ${a.base ?? 'MYR'} in ${a.currency}`;
  const name = a.asset === 'gold' ? `Gold ${PURITIES.find((p) => p[0] === (a.purity ?? 0.999))?.[1].split(' ')[0] ?? ''}`.trim() : 'Silver';
  return `${name} ${UNIT_LABEL[a.unit ?? 'g']} in ${a.currency}`;
}

/** Numbers formatted for messages. FX rates keep 4 decimals. */
export function formatPrice(v: number, a: Pick<PriceAlert, 'asset' | 'currency'>): string {
  const digits = a.asset === 'fx' ? 4 : 2;
  const locale = a.currency === 'INR' ? 'en-IN' : 'en-GB';
  try {
    const out = new Intl.NumberFormat(locale, { style: 'currency', currency: a.currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
    return out.replace(/^(-?[A-Za-z]+)(\d)/, '$1 $2'); // "RM543.11" → "RM 543.11"
  } catch {
    return `${a.currency} ${v.toFixed(digits)}`;
  }
}

export function describeRule(a: PriceAlert): string {
  const s = alertSubject(a);
  switch (a.kind) {
    case 'daily': return `${s}: daily update`;
    case 'above': return `${s} goes above ${formatPrice(a.value ?? 0, a)}`;
    case 'below': return `${s} goes below ${formatPrice(a.value ?? 0, a)}`;
    case 'move': return `${s} moves ${a.value ?? 0}% or more`;
  }
}

export interface Notice { title: string; body: string; priority: 'default' | 'high'; tags: string[] }

const pct = (v: number) => `${v >= 0 ? '▲' : '▼'}${Math.abs(v * 100).toFixed(2)}%`;
/** Re-arm above/below rules only after the price moves back by this much, so tiny wobbles don't spam. */
export const REARM_MARGIN = 0.003;

/** Local date (YYYY-MM-DD) and hour in a time zone. */
export function localClock(now: Date, tz: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
}

/**
 * One hourly check for one person: which notifications to send, and the state to save.
 * Rules whose price is unavailable are skipped (and keep their state).
 */
export function evaluate(s: AlertSettings, prev: AlertState | null, q: Quotes, now: Date): { notices: Notice[]; state: AlertState } {
  const state: AlertState = { rules: {}, lastDaily: prev?.lastDaily, lastRun: now.toISOString() };
  const notices: Notice[] = [];
  const clock = localClock(now, s.timezone || 'UTC');
  const dailyDue = clock.hour >= s.dailyHour && prev?.lastDaily !== clock.date;
  const dailyLines: string[] = [];

  for (const a of s.alerts) {
    const old = prev?.rules[a.id];
    const st: RuleState = old && old.rev === a.rev ? { ...old } : { rev: a.rev, armed: true };
    state.rules[a.id] = st;
    if (!a.active) continue;
    const v = alertValue(a, q);
    if (v == null) continue;

    if (a.kind === 'daily') {
      if (dailyDue) {
        dailyLines.push(`${alertSubject(a)}: ${formatPrice(v, a)}${st.ref ? ` (${pct(v / st.ref - 1)} since yesterday)` : ''}`);
        st.ref = v;
        st.firedAt = now.toISOString();
        st.firedValue = v;
      }
      continue;
    }
    if (st.done) continue;
    const target = a.value ?? 0;
    let fire = false;
    if (a.kind === 'above' || a.kind === 'below') {
      const hit = a.kind === 'above' ? v >= target : v <= target;
      const back = a.kind === 'above' ? v < target * (1 - REARM_MARGIN) : v > target * (1 + REARM_MARGIN);
      if (hit && st.armed !== false) fire = true;
      else if (back) st.armed = true;
      if (fire) {
        st.armed = false;
        notices.push({
          title: `${alertSubject(a)} ${a.kind === 'above' ? 'is above' : 'is below'} ${formatPrice(target, a)}`,
          body: `Now ${formatPrice(v, a)} (your target: ${a.kind} ${formatPrice(target, a)}).`,
          priority: 'high', tags: [a.kind === 'above' ? 'chart_with_upwards_trend' : 'chart_with_downwards_trend'],
        });
      }
    } else if (a.kind === 'move') {
      if (!st.ref) st.ref = v;
      else if (target > 0 && Math.abs(v / st.ref - 1) >= target / 100) {
        fire = true;
        notices.push({
          title: `${alertSubject(a)} moved ${pct(v / st.ref - 1)}`,
          body: `Now ${formatPrice(v, a)}, from ${formatPrice(st.ref, a)}.`,
          priority: 'high', tags: [v > st.ref ? 'chart_with_upwards_trend' : 'chart_with_downwards_trend'],
        });
        st.ref = v;
      }
    }
    if (fire) {
      st.firedAt = now.toISOString();
      st.firedValue = v;
      if (a.repeat !== 'every') st.done = true;
    }
  }

  if (dailyDue && dailyLines.length) {
    notices.unshift({ title: 'Prices today', body: dailyLines.join('\n'), priority: 'default', tags: ['coin'] });
  }
  if (dailyDue && s.alerts.some((a) => a.active && a.kind === 'daily')) state.lastDaily = clock.date;
  return { notices, state };
}

/** A random, hard-to-guess ntfy topic name. */
export function newTopic(random: () => number = Math.random): string {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  let t = 'ledgerline-';
  for (let i = 0; i < 20; i++) t += abc[Math.floor(random() * abc.length)];
  return t;
}

/** Parses the free price feeds into Quotes. Metals from xaus.com, currencies from open.er-api.com. */
export function quotesFrom(metals: unknown, fx: unknown, asOf = new Date().toISOString()): Quotes {
  const m = (metals ?? {}) as { spot_usd_oz?: number; per_gram_usd?: number; silver_usd_oz?: number };
  const f = (fx ?? {}) as { rates?: Record<string, number> };
  const goldOz = Number(m.spot_usd_oz);
  const goldG = Number(m.per_gram_usd) > 0 ? Number(m.per_gram_usd) : goldOz > 0 ? goldOz / TROY_OZ_G : null;
  const silverOz = Number(m.silver_usd_oz);
  return { goldUsdG: goldG, silverUsdG: silverOz > 0 ? silverOz / TROY_OZ_G : null, usd: { ...(f.rates ?? {}), USD: 1 }, asOf };
}

export const METALS_URL = 'https://xaus.com/api/v1/spot?compact=1';
export const FX_URL = 'https://open.er-api.com/v6/latest/USD';
