import { addMonths, currentMonth, daysInMonth, monthKey, monthsBetween, periodRange, toISO, todayISO } from './dates';
import { Account, Budget, Category, Goal, Ledger, Recurring, Transaction, TxType } from './models';

export interface Summary {
  income: number;
  expense: number;
  savings: number;
  investment: number;
  net: number;
  savingsRate: number | null;
  unconverted: number;
  count: number;
  byCat: Record<string, number>;
}

export interface CatValue { id: string; name: string; value: number }
export interface CatCompare { id: string; name: string; cur: number; prev: number }
export interface BudgetUsage { spent: number; pct: number; status: 'ok' | 'near' | 'over'; remaining: number }
export interface GoalPlan { saved: number; remaining: number; monthsLeft: number | null; perMonth: number | null; pace: number; pct: number }
export interface CurrencyFlow { cur: string; inn: number; out: number; xferIn: number; xferOut: number; set: number; net: number }
export interface Occurrence { r: Recurring; date: string }

export interface ReportData {
  kind: 'month' | 'year';
  key: string;
  prevKey: string;
  range: [string, string];
  list: Transaction[];
  cur: Summary;
  prev: Summary;
  expenseCats: CatCompare[];
  incomeCats: CatCompare[];
  savingCats: CatCompare[];
}

/**
 * Read-only calculations over one snapshot of the ledger.
 * Exchange rates: unitValue(code) is how many units of the primary currency one unit of `code` is worth.
 * A manual rate wins over the market rate; a rate locked on a transaction wins over both.
 */
export class Finance {
  readonly primary: string;
  private readonly accounts = new Map<string, Account>();
  private readonly categories = new Map<string, Category>();
  private readonly goals = new Map<string, Goal>();

  constructor(readonly ledger: Ledger) {
    this.primary = ledger.settings.primary;
    ledger.settings.accounts.forEach((a) => this.accounts.set(a.id, a));
    ledger.settings.categories.forEach((c) => this.categories.set(c.id, c));
    ledger.plan.goals.forEach((g) => this.goals.set(g.id, g));
  }

  get transactions() { return this.ledger.transactions; }
  account(id?: string | null) { return id ? this.accounts.get(id) : undefined; }
  category(id?: string | null) { return id ? this.categories.get(id) : undefined; }
  goal(id?: string | null) { return id ? this.goals.get(id) : undefined; }
  catName(id?: string | null) { return this.category(id)?.name ?? 'Uncategorized'; }
  accName(id?: string | null) { return this.account(id)?.name ?? '—'; }

  /* ---------- exchange rates ---------- */
  unitValue(code: string, primary = this.primary, depth = 0): number | null {
    if (!code || code === primary) return 1;
    const manual = this.ledger.settings.manualRates ?? {};
    const m = manual[code];
    if (m && m.rate > 0 && depth < 4) {
      const b = m.base === primary ? 1 : this.unitValue(m.base, primary, depth + 1);
      if (b != null) return m.rate * b;
    }
    const pm = manual[primary];
    if (pm && pm.base === code && pm.rate > 0) return 1 / pm.rate;
    return this.marketUnitValue(code, primary);
  }

  marketUnitValue(code: string, primary = this.primary): number | null {
    if (code === primary) return 1;
    const mk = this.ledger.market?.rates;
    if (mk && mk[code] > 0 && mk[primary] > 0) return mk[primary] / mk[code];
    return null;
  }

  rateSource(code: string): 'primary' | 'manual' | 'market' | 'missing' {
    if (code === this.primary) return 'primary';
    if (this.ledger.settings.manualRates?.[code]) return 'manual';
    return this.marketUnitValue(code) != null ? 'market' : 'missing';
  }

  convert(amount: number, from: string, to: string): number | null {
    if (from === to) return amount;
    const vf = this.unitValue(from), vt = this.unitValue(to);
    if (vf == null || vt == null) return null;
    return (amount * vf) / vt;
  }

  txValue(tx: Transaction, to = this.primary): number | null {
    if (tx.currency === to) return tx.amount;
    if (tx.fx && tx.fx.rate > 0 && tx.fx.base) {
      const inBase = tx.amount * tx.fx.rate;
      return tx.fx.base === to ? inBase : this.convert(inBase, tx.fx.base, to);
    }
    return this.convert(tx.amount, tx.currency, to);
  }

  rateText(from: string, to: string): string {
    const v = this.convert(1, from, to);
    if (v == null) return 'rate needed';
    const digits = v >= 100 ? 2 : v >= 1 ? 4 : 6;
    return `1 ${from} = ${v.toFixed(digits).replace(/\.?0+$/, '')} ${to}`;
  }

  /* ---------- periods & summaries ---------- */
  txIn(from: string, to: string): Transaction[] {
    return this.transactions.filter((t) => t.date >= from && t.date <= to);
  }

  summarize(list: Transaction[]): Summary {
    const r: Summary = { income: 0, expense: 0, savings: 0, investment: 0, net: 0, savingsRate: null, unconverted: 0, count: list.length, byCat: {} };
    for (const t of list) {
      if (t.type === 'transfer') continue;
      let v = this.txValue(t);
      if (v == null) { r.unconverted++; continue; }
      if (t.type === 'savings' || t.type === 'investment') v = t.out ? -v : v;
      r[t.type] += v;
      const k = `${t.type}:${t.categoryId ?? 'none'}`;
      r.byCat[k] = (r.byCat[k] ?? 0) + v;
    }
    r.net = r.income - r.expense - r.savings - r.investment;
    r.savingsRate = r.income > 0 ? (r.income - r.expense) / r.income : null;
    return r;
  }

  private monthCache = new Map<string, Summary>();
  monthSummary(key: string): Summary {
    let s = this.monthCache.get(key);
    if (!s) {
      const [a, b] = periodRange('month', key);
      s = this.summarize(this.txIn(a, b));
      this.monthCache.set(key, s);
    }
    return s;
  }

  catBreakdown(s: Summary, type: TxType): CatValue[] {
    const out: CatValue[] = [];
    for (const k in s.byCat) {
      const [t, id] = k.split(':');
      if (t !== type) continue;
      out.push({ id, name: this.catName(id), value: s.byCat[k] });
    }
    return out.sort((a, b) => b.value - a.value);
  }

  reportData(kind: 'month' | 'year', key: string): ReportData {
    const range = periodRange(kind, key);
    const prevKey = kind === 'year' ? String(Number(key) - 1) : addMonths(key, -1);
    const [pa, pb] = periodRange(kind, prevKey);
    const list = this.txIn(...range);
    const cur = this.summarize(list), prev = this.summarize(this.txIn(pa, pb));
    const merge = (type: TxType): CatCompare[] => {
      const m: Record<string, CatCompare> = {};
      for (const c of this.catBreakdown(cur, type)) m[c.id] = { id: c.id, name: c.name, cur: c.value, prev: 0 };
      for (const c of this.catBreakdown(prev, type)) (m[c.id] ??= { id: c.id, name: c.name, cur: 0, prev: 0 }).prev = c.value;
      return Object.values(m).sort((x, y) => y.cur - x.cur || y.prev - x.prev);
    };
    return { kind, key, prevKey, range, list, cur, prev, expenseCats: merge('expense'), incomeCats: merge('income'), savingCats: [...merge('savings'), ...merge('investment')] };
  }

  /* ---------- accounts, goals, budgets ---------- */
  accountBalance(acc: Account, upTo?: string): number {
    let bal = Number(acc.opening) || 0;
    const inAcc = (amount: number, fromCur: string, tx: Transaction) => {
      if (fromCur === acc.currency) return amount;
      if (tx.fx && tx.fx.base === acc.currency && tx.fx.rate > 0) return amount * tx.fx.rate;
      return this.convert(amount, fromCur, acc.currency) ?? 0;
    };
    for (const t of this.transactions) {
      if (upTo && t.date > upTo) continue;
      if (t.accountId === acc.id) {
        const v = inAcc(t.amount, t.currency, t);
        if (t.type === 'income') bal += v;
        else if (t.type === 'expense' || t.type === 'transfer') bal -= v;
        else bal += (t.out ? 1 : -1) * v;
      }
      if (t.toAccountId === acc.id && t.toAccountId !== t.accountId) {
        const recv = t.toAmount && t.toAmount > 0 ? t.toAmount : inAcc(t.amount, t.currency, t);
        if (t.type === 'transfer') bal += recv;
        else if (t.type === 'savings' || t.type === 'investment') bal += (t.out ? -1 : 1) * recv;
      }
    }
    return bal;
  }

  goalSaved(g: Goal): number {
    let saved = Number(g.startAmount) || 0;
    for (const t of this.transactions) {
      if (t.goalId !== g.id) continue;
      const v = t.currency === g.currency ? t.amount : this.txValue(t, g.currency);
      if (v != null) saved += t.out ? -v : v;
    }
    return saved;
  }

  goalPlan(g: Goal, today = todayISO()): GoalPlan {
    const saved = this.goalSaved(g);
    const remaining = Math.max(0, g.target - saved);
    let monthsLeft: number | null = null, perMonth: number | null = null;
    if (g.targetDate) {
      monthsLeft = Math.max(0, monthsBetween(today, g.targetDate));
      perMonth = monthsLeft > 0 ? remaining / monthsLeft : remaining;
    }
    const since = addMonths(today.slice(0, 7), -2) + '-01';
    let recent = 0;
    for (const t of this.transactions) {
      if (t.goalId !== g.id || t.date < since) continue;
      const v = this.txValue(t, g.currency);
      if (v != null) recent += t.out ? -v : v;
    }
    return { saved, remaining, monthsLeft, perMonth, pace: recent / 3, pct: g.target ? saved / g.target : 0 };
  }

  budgetUsage(b: Budget, key: string): BudgetUsage {
    const [a, z] = periodRange('month', key);
    let spent = 0;
    for (const t of this.txIn(a, z)) {
      if (t.type !== 'expense') continue;
      if (b.categoryId !== '__all' && t.categoryId !== b.categoryId) continue;
      const v = t.currency === b.currency ? t.amount : this.txValue(t, b.currency);
      if (v != null) spent += v;
    }
    const pct = b.limit > 0 ? spent / b.limit : 0;
    const alert = (b.alertPct || 80) / 100;
    return { spent, pct, status: pct > 1.0001 ? 'over' : pct >= alert ? 'near' : 'ok', remaining: b.limit - spent };
  }

  /* ---------- recurring ---------- */
  dueRecurring(today = todayISO()): Occurrence[] {
    const out: Occurrence[] = [];
    for (const r of this.ledger.plan.recurring) {
      if (r.active === false || !r.nextDate) continue;
      let d = r.nextDate, guard = 0;
      while (d <= today && guard++ < 24) { out.push({ r, date: d }); d = nextOccurrence(r, d); }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  upcomingRecurring(days = 45, today = todayISO()): Occurrence[] {
    const [y, m, d0] = today.split('-').map(Number);
    const lim = toISO(new Date(y, m - 1, d0 + days));
    const out: Occurrence[] = [];
    for (const r of this.ledger.plan.recurring) {
      if (r.active === false || !r.nextDate) continue;
      let d = r.nextDate, guard = 0;
      while (d <= today && guard++ < 24) d = nextOccurrence(r, d);
      if (d <= lim) out.push({ r, date: d });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  isSalary(t: Transaction): boolean {
    if (t.type !== 'income') return false;
    if (this.catName(t.categoryId) === 'Salary') return true;
    return !!t.recurringId && !!this.ledger.plan.recurring.find((r) => r.id === t.recurringId)?.isSalary;
  }

  /* ---------- currencies ---------- */
  currencyFlows(list: Transaction[]): CurrencyFlow[] {
    const m: Record<string, CurrencyFlow> = {};
    const row = (c: string) => (m[c] ??= { cur: c, inn: 0, out: 0, xferIn: 0, xferOut: 0, set: 0, net: 0 });
    for (const t of list) {
      const r = row(t.currency);
      if (t.type === 'income') r.inn += t.amount;
      else if (t.type === 'expense') r.out += t.amount;
      else if (t.type === 'transfer') {
        const from = this.account(t.accountId), to = this.account(t.toAccountId);
        if (from && to && from.currency !== to.currency) {
          r.xferOut += t.amount;
          row(to.currency).xferIn += t.toAmount && t.toAmount > 0 ? t.toAmount : this.convert(t.amount, t.currency, to.currency) ?? 0;
        }
      } else r.set += t.out ? -t.amount : t.amount;
    }
    return Object.values(m).map((r) => ({ ...r, net: r.inn + r.xferIn - r.out - r.xferOut - r.set }));
  }

  /** Currencies seen in accounts, settings and transactions. */
  usedCurrencies(): string[] {
    const s = new Set(this.ledger.settings.currencies);
    this.ledger.settings.accounts.forEach((a) => s.add(a.currency));
    this.transactions.forEach((t) => s.add(t.currency));
    return [...s];
  }
}

export function nextOccurrence(r: Pick<Recurring, 'freq' | 'day'>, fromISO: string): string {
  const [y, m, d] = fromISO.split('-').map(Number);
  let dt: Date;
  if (r.freq === 'weekly') dt = new Date(y, m - 1, d + 7);
  else if (r.freq === 'biweekly') dt = new Date(y, m - 1, d + 14);
  else if (r.freq === 'yearly') dt = new Date(y + 1, m - 1, Math.min(r.day || d, daysInMonth(y + 1, m)));
  else {
    let ny = y, nm = m + 1;
    if (nm > 12) { nm = 1; ny++; }
    dt = new Date(ny, nm - 1, Math.min(r.day || d, daysInMonth(ny, nm)));
  }
  return toISO(dt);
}

/** Sign of a transaction from the point of view of spendable money. */
export const txSign = (t: Transaction) =>
  t.type === 'income' ? 1 : t.type === 'expense' ? -1 : t.type === 'transfer' ? 0 : t.out ? 1 : -1;

export { monthKey, currentMonth };
