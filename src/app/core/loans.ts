import { daysInMonth, todayISO, toISO } from './dates';
import { round2 } from './currency';
import { Debt, EmiInfo } from './models';

/**
 * EMI loan maths (reducing balance, fixed rate, monthly EMIs).
 * Everything here is pure so it can be unit-tested and reused by the page, the form and guidance.
 */

export const LOAN_KINDS: ReadonlyArray<[NonNullable<EmiInfo['kind']>, string]> = [
  ['home', 'Home loan'], ['car', 'Car / vehicle loan'], ['personal', 'Personal loan'], ['education', 'Education loan'],
  ['card-emi', 'Credit card EMI'], ['gold', 'Gold loan'], ['other', 'Other loan'],
];
export const loanKindLabel = (k?: EmiInfo['kind']) => LOAN_KINDS.find((x) => x[0] === k)?.[1] ?? 'Loan';

const monthly = (apr: number) => apr / 1200;

/** Present value of `n` EMIs: what's still owed (principal) when n EMIs remain. */
export function presentValue(emi: number, n: number, apr: number): number {
  if (n <= 0) return 0;
  const r = monthly(apr);
  return r === 0 ? emi * n : (emi * (1 - Math.pow(1 + r, -n))) / r;
}

/** EMI for a principal, rate and number of months. */
export function emiFor(principal: number, apr: number, n: number): number {
  if (n <= 0) return principal;
  const r = monthly(apr);
  if (r === 0) return principal / n;
  const f = Math.pow(1 + r, n);
  return (principal * r * f) / (f - 1);
}

/**
 * Interest rate (% a year) that makes `n` EMIs of `emi` repay `principal`.
 * Returns null when the numbers can't belong to a normal loan.
 */
export function solveRate(principal: number, emi: number, n: number): number | null {
  if (!(principal > 0) || !(emi > 0) || !(n > 0)) return null;
  if (emi * n < principal - 0.5) return null; // pays back less than borrowed
  if (emi * n <= principal + 0.5) return 0;
  let lo = 0, hi = 120; // % a year
  if (presentValue(emi, n, hi) > principal) return null; // above 120% a year: not a loan we can model
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (presentValue(emi, n, mid) > principal) lo = mid; else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 1000) / 1000;
}

/** Next date on or after `from` that falls on `day` of the month (clamped to month length). */
export function nextDueDate(day: number, from = todayISO()): string {
  const [y, m, d] = from.split('-').map(Number);
  const dd = Math.min(day, daysInMonth(y, m));
  if (d <= dd) return toISO(new Date(y, m - 1, dd));
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return toISO(new Date(ny, nm - 1, Math.min(day, daysInMonth(ny, nm))));
}

/** Same day-of-month `k` months later (clamped). */
export function addMonthsToDate(iso: string, k: number, day?: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y, m - 1 + k, 1);
  const want = day ?? d;
  return toISO(new Date(t.getFullYear(), t.getMonth(), Math.min(want, daysInMonth(t.getFullYear(), t.getMonth() + 1))));
}

/** How many EMIs fall due from `first` up to and including `today`. */
export function emisDueSince(first: string, today: string, day?: number): number {
  if (first > today) return 0;
  let k = 0;
  while (k < 1200 && addMonthsToDate(first, k, day) <= today) k++;
  return k;
}

export interface LoanStatus {
  emi: number;
  /** EMIs already paid since the loan was last updated (assumed paid on their dates). */
  paidSinceUpdate: number;
  left: number;
  done: boolean;
  nextDate: string | null;
  lastDate: string | null;
  /** EMI × EMIs left: the total you will still hand over. */
  payable: number;
  /** Principal still owed (null when the rate isn't known). */
  outstanding: number | null;
  /** Interest still to pay over the rest of the loan. */
  interestLeft: number | null;
  apr: number | null;
  nextInterest: number | null;
  nextPrincipal: number | null;
  /** Share of the remaining payments that is interest (0..1). */
  interestShare: number | null;
  life: LoanLife | null;
}
export interface LoanLife {
  original: number;
  tenure: number;
  emisPaid: number;
  progress: number;
  totalPaid: number;
  principalRepaid: number;
  interestPaid: number;
  totalInterest: number;
}

/** Where an EMI loan stands on `today`, rolling forward from the snapshot saved with it. */
export function loanStatus(d: Debt, today = todayISO()): LoanStatus | null {
  const e = d.emi;
  if (!e) return null;
  const emi = Number(e.amount) || 0;
  const paidSinceUpdate = Math.min(e.monthsLeft, emisDueSince(e.nextDate, today, e.day));
  const left = Math.max(0, e.monthsLeft - paidSinceUpdate);
  const apr = e.basis === 'none' || d.apr == null || Number.isNaN(Number(d.apr)) ? null : Number(d.apr);
  const outstanding = apr == null ? null : round2(presentValue(emi, left, apr));
  const payable = round2(emi * left);
  const interestLeft = outstanding == null ? null : round2(Math.max(0, payable - outstanding));
  const nextInterest = outstanding == null || !left ? null : round2(outstanding * monthly(apr!));
  let life: LoanLife | null = null;
  if (e.original && e.tenure && outstanding != null && e.tenure >= left) {
    const emisPaid = e.tenure - left;
    const totalPaid = round2(emi * emisPaid);
    const principalRepaid = round2(Math.max(0, e.original - outstanding));
    const interestPaid = round2(totalPaid - principalRepaid);
    if (interestPaid >= -1) {
      life = {
        original: e.original, tenure: e.tenure, emisPaid, progress: e.tenure ? emisPaid / e.tenure : 0, totalPaid, principalRepaid,
        interestPaid: Math.max(0, interestPaid), totalInterest: round2(Math.max(0, interestPaid) + (interestLeft ?? 0)),
      };
    }
  }
  return {
    emi, paidSinceUpdate, left, done: left === 0,
    nextDate: left ? addMonthsToDate(e.nextDate, paidSinceUpdate, e.day) : null,
    lastDate: left ? addMonthsToDate(e.nextDate, e.monthsLeft - 1, e.day) : null,
    payable, outstanding, interestLeft, apr,
    nextInterest, nextPrincipal: nextInterest == null ? null : round2(Math.min(emi, outstanding!) - nextInterest),
    interestShare: interestLeft == null || !payable ? null : interestLeft / payable,
    life,
  };
}

/** What a debt counts as today, in its own currency: principal for loans when known, otherwise what's left to pay. */
export function debtBalanceNow(d: Debt, today = todayISO()): number {
  const s = loanStatus(d, today);
  if (!s) return Number(d.balance) || 0;
  return s.outstanding ?? s.payable;
}

export interface ScheduleRow { n: number; date: string; emi: number; interest: number; principal: number; balance: number }
/** Month-by-month split of the remaining EMIs. */
export function schedule(principal: number, apr: number, emi: number, firstDate: string, day?: number, maxRows = 600): ScheduleRow[] {
  const r = monthly(apr);
  const rows: ScheduleRow[] = [];
  let bal = principal;
  for (let n = 1; bal > 0.005 && n <= maxRows; n++) {
    const interest = bal * r;
    let principalPart = Math.min(emi, bal + interest) - interest;
    if (principalPart <= 0) break; // EMI doesn't cover interest
    if (bal - principalPart < 0.5) principalPart = bal; // absorb rounding pennies into the last EMI
    const pay = principalPart + interest;
    bal -= principalPart;
    rows.push({ n, date: addMonthsToDate(firstDate, n - 1, day), emi: round2(pay), interest: round2(interest), principal: round2(principalPart), balance: round2(Math.max(0, bal)) });
  }
  return rows;
}

export interface YearRow { year: string; emis: number; paid: number; interest: number; principal: number; balance: number }
export function scheduleByYear(rows: ScheduleRow[]): YearRow[] {
  const out: YearRow[] = [];
  for (const r of rows) {
    const y = r.date.slice(0, 4);
    let cur = out.at(-1);
    if (!cur || cur.year !== y) out.push((cur = { year: y, emis: 0, paid: 0, interest: 0, principal: 0, balance: 0 }));
    cur.emis++;
    cur.paid = round2(cur.paid + r.emi);
    cur.interest = round2(cur.interest + r.interest);
    cur.principal = round2(cur.principal + r.principal);
    cur.balance = r.balance;
  }
  return out;
}

export interface PrepayResult {
  /** Interest saved compared with carrying on as now. */
  saved: number;
  months: number;
  monthsSaved: number;
  newEmi: number;
  lastDate: string | null;
  closes: boolean;
}

/**
 * What-if: pay `lump` now and/or `extra` on top of every EMI.
 * mode 'tenure' keeps the EMI and finishes sooner; 'emi' keeps the end date and lowers the EMI.
 */
export function prepay(s: LoanStatus, lump: number, extra: number, mode: 'tenure' | 'emi', day?: number): PrepayResult | null {
  if (s.outstanding == null || s.apr == null || !s.left || !s.nextDate) return null;
  const base = schedule(s.outstanding, s.apr, s.emi, s.nextDate, day);
  const baseInterest = base.reduce((a, r) => a + r.interest, 0);
  const p = s.outstanding - Math.max(0, lump);
  if (p <= 0.005) return { saved: round2(baseInterest), months: 0, monthsSaved: s.left, newEmi: 0, lastDate: null, closes: true };
  const emi = mode === 'emi' ? emiFor(p, s.apr, s.left) : s.emi;
  const rows = schedule(p, s.apr, emi + Math.max(0, extra), s.nextDate, day);
  const interest = rows.reduce((a, r) => a + r.interest, 0);
  return {
    saved: round2(Math.max(0, baseInterest - interest)), months: rows.length, monthsSaved: Math.max(0, base.length - rows.length),
    newEmi: round2(emi), lastDate: rows.at(-1)?.date ?? null, closes: false,
  };
}

export type LoanBasis = EmiInfo['basis'];
export interface LoanInput {
  emi: number;
  monthsLeft: number;
  basis: LoanBasis;
  apr?: number;
  outstanding?: number;
  original?: number;
  tenure?: number;
}
/** Works out the interest rate from whatever the person knows. Returns a message when the numbers don't fit. */
export function resolveRate(i: LoanInput): { apr: number | null; error?: string } {
  if (!(i.emi > 0)) return { apr: null, error: 'Enter the monthly EMI.' };
  if (!(i.monthsLeft > 0)) return { apr: null, error: 'Enter how many EMIs are left.' };
  switch (i.basis) {
    case 'rate':
      if (i.apr == null || !(i.apr >= 0) || i.apr > 120) return { apr: null, error: 'Enter the interest rate, e.g. 8.5.' };
      return { apr: i.apr };
    case 'outstanding': {
      if (!(i.outstanding! > 0)) return { apr: null, error: 'Enter the outstanding principal from your loan statement.' };
      const apr = solveRate(i.outstanding!, i.emi, i.monthsLeft);
      return apr == null
        ? { apr: null, error: `${i.monthsLeft} EMIs of ${i.emi} don't fit an outstanding amount of ${i.outstanding}. Check the numbers.` }
        : { apr };
    }
    case 'original': {
      if (!(i.original! > 0) || !(i.tenure! > 0)) return { apr: null, error: 'Enter the original loan amount and the total number of EMIs.' };
      if (i.monthsLeft > i.tenure!) return { apr: null, error: "EMIs left can't be more than the total number of EMIs." };
      const apr = solveRate(i.original!, i.emi, i.tenure!);
      return apr == null ? { apr: null, error: `${i.tenure} EMIs of ${i.emi} don't fit a loan of ${i.original}. Check the numbers.` } : { apr };
    }
    default:
      return { apr: null };
  }
}
