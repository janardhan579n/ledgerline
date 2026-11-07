import { addMonths, periodRange, todayISO } from './dates';
import { Finance, GoalPlan, Summary } from './finance';
import { Assumptions, Debt, Goal } from './models';

export interface DatedGoalNeed { goal: Goal; plan: GoalPlan; perMonthPrimary: number }
export interface DebtView extends Debt { balancePrimary: number }

export interface Allocation { starter: number; debt: number; full: number; goals: number; invest: number }

export interface Guidance {
  a: Assumptions;
  basis: 'complete' | 'current' | 'none';
  months: string[];
  avgIncome: number;
  avgSpend: number;
  avgEssential: number;
  surplus: number;
  topDiscretionary: { name: string; value: number }[];
  emergencyGoal: Goal | null;
  emergencySaved: number;
  emergencyTarget: number;
  starterTarget: number;
  starterGap: number;
  fullGap: number;
  debts: DebtView[];
  highDebts: DebtView[];
  highDebtTotal: number;
  datedGoals: DatedGoalNeed[];
  goalNeed: number;
  alloc: Allocation;
  /** Average monthly net spending per non-primary currency, in primary (negative = net income in that currency). */
  exposure: Record<string, number>;
}

/**
 * Orders priorities as a waterfall: each step's gap is filled from the monthly surplus before the next.
 * starter buffer → high-interest debt → full emergency fund → dated goals → long-term investing.
 */
export function computeGuidance(fin: Finance, a: Assumptions, today = todayISO()): Guidance {
  const P = fin.primary;
  const cm = today.slice(0, 7);
  const candidates: string[] = [];
  for (let i = 1; i <= a.lookbackMonths; i++) candidates.push(addMonths(cm, -i));
  let used: { m: string; s: Summary }[] = candidates.map((m) => ({ m, s: fin.monthSummary(m) })).filter((x) => x.s.count > 0);
  let basis: Guidance['basis'] = used.length ? 'complete' : 'none';
  if (!used.length) {
    const c = fin.monthSummary(cm);
    if (c.count) { used = [{ m: cm, s: c }]; basis = 'current'; }
  }
  const n = used.length || 1;
  const avg = (f: (s: Summary) => number) => used.reduce((acc, x) => acc + f(x.s), 0) / n;
  const essential = new Set(fin.ledger.settings.categories.filter((c) => c.kind === 'expense' && c.essential).map((c) => c.id));

  const avgIncome = avg((s) => s.income);
  const avgSpend = avg((s) => s.expense);
  const avgEssential = avg((s) => fin.catBreakdown(s, 'expense').filter((c) => essential.has(c.id)).reduce((x, c) => x + c.value, 0));
  const surplus = avgIncome - avgSpend;

  const disc: Record<string, number> = {};
  for (const x of used) for (const c of fin.catBreakdown(x.s, 'expense')) if (!essential.has(c.id)) disc[c.name] = (disc[c.name] ?? 0) + c.value / n;
  const topDiscretionary = Object.entries(disc).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([name, value]) => ({ name, value }));

  const goals = fin.ledger.plan.goals;
  const emergencyGoal = (a.emergencyGoalId && goals.find((g) => g.id === a.emergencyGoalId)) || goals.find((g) => g.emergency) || null;
  const emergencySaved = emergencyGoal ? fin.convert(fin.goalSaved(emergencyGoal), emergencyGoal.currency, P) ?? 0 : 0;
  const emergencyTarget = a.emergencyMonths * avgEssential;
  const starterTarget = a.starterMonths * avgEssential;

  const debts: DebtView[] = fin.ledger.plan.debts.map((d) => ({ ...d, balancePrimary: fin.convert(Number(d.balance) || 0, d.currency, P) ?? 0 }));
  const highDebts = debts.filter((d) => Number(d.apr) >= a.highInterestApr && d.balancePrimary > 0).sort((x, y) => y.apr - x.apr);
  const highDebtTotal = highDebts.reduce((x, d) => x + d.balancePrimary, 0);

  const datedGoals: DatedGoalNeed[] = goals
    .filter((g) => g !== emergencyGoal && g.targetDate)
    .map((g) => {
      const plan = fin.goalPlan(g, today);
      return { goal: g, plan, perMonthPrimary: plan.perMonth == null ? 0 : fin.convert(plan.perMonth, g.currency, P) ?? 0 };
    })
    .filter((x) => x.plan.remaining > 0);
  const goalNeed = datedGoals.reduce((x, g) => x + g.perMonthPrimary, 0);

  let remaining = Math.max(0, surplus);
  const take = (gap: number) => { const v = Math.min(remaining, Math.max(0, gap)); remaining -= v; return v; };
  const starterGap = Math.max(0, starterTarget - emergencySaved);
  const fullGap = Math.max(0, emergencyTarget - Math.max(emergencySaved, starterTarget));
  const alloc: Allocation = { starter: take(starterGap), debt: take(highDebtTotal), full: take(fullGap), goals: take(goalNeed), invest: 0 };
  alloc.invest = remaining;

  const exposure: Record<string, number> = {};
  for (const x of used) {
    for (const t of fin.txIn(...periodRange('month', x.m))) {
      if (t.currency === P || (t.type !== 'expense' && t.type !== 'income')) continue;
      const v = fin.txValue(t);
      if (v == null) continue;
      exposure[t.currency] = (exposure[t.currency] ?? 0) + (t.type === 'expense' ? v : -v) / n;
    }
  }

  return {
    a, basis, months: used.map((x) => x.m), avgIncome, avgSpend, avgEssential, surplus, topDiscretionary,
    emergencyGoal, emergencySaved, emergencyTarget, starterTarget, starterGap, fullGap,
    debts, highDebts, highDebtTotal, datedGoals, goalNeed, alloc, exposure,
  };
}

export interface Projection { labels: string[]; contributed: number[]; value: number[]; finalValue: number; realValue: number }

/** Monthly contributions compounded monthly at an assumed annual return. Illustration only. */
export function project(monthly: number, annualReturnPct: number, years: number, inflationPct: number): Projection {
  const yrs = Math.max(1, Math.min(40, Math.round(years)));
  const r = annualReturnPct / 100 / 12;
  const labels: string[] = [], contributed: number[] = [], value: number[] = [];
  let bal = 0;
  for (let y = 0; y <= yrs; y++) {
    labels.push(y === 0 ? 'Now' : `Yr ${y}`);
    contributed.push(monthly * 12 * y);
    value.push(bal);
    for (let k = 0; k < 12; k++) bal = bal * (1 + r) + monthly;
  }
  const finalValue = value[value.length - 1];
  return { labels, contributed, value, finalValue, realValue: finalValue / Math.pow(1 + inflationPct / 100, yrs) };
}
