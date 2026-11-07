import { AccountType, Assumptions, CategoryKind, Plan, Settings, TxType } from './models';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const DEFAULT_CATEGORIES: ReadonlyArray<[string, CategoryKind, boolean?]> = [
  ['Salary', 'income'], ['Bonus', 'income'], ['Freelance & side income', 'income'], ['Interest & dividends', 'income'],
  ['Refunds & cashback', 'income'], ['Other income', 'income'],
  ['Rent & housing', 'expense', true], ['Utilities & bills', 'expense', true], ['Groceries', 'expense', true],
  ['Transport', 'expense', true], ['Insurance', 'expense', true], ['Health', 'expense', true], ['Education', 'expense', true],
  ['Family support', 'expense', true], ['Loan & card payments', 'expense', true], ['Phone & internet', 'expense', true],
  ['Dining out', 'expense'], ['Shopping', 'expense'], ['Entertainment', 'expense'], ['Subscriptions', 'expense'],
  ['Travel', 'expense'], ['Personal care', 'expense'], ['Gifts & donations', 'expense'], ['Fees & charges', 'expense'],
  ['Other spending', 'expense'],
  ['Emergency fund', 'savings'], ['Goal savings', 'savings'], ['General savings', 'savings'],
  ['Retirement', 'investment'], ['Index funds & ETFs', 'investment'], ['Mutual funds / unit trusts', 'investment'],
  ['Stocks', 'investment'], ['Fixed deposits & bonds', 'investment'], ['Gold', 'investment'], ['Other investment', 'investment'],
  ['Transfer', 'transfer'], ['Currency exchange', 'transfer'],
];

export const ACCOUNT_TYPES: ReadonlyArray<[AccountType, string]> = [
  ['bank', 'Bank account'], ['cash', 'Cash'], ['card', 'Credit card'], ['ewallet', 'E-wallet'],
  ['savings', 'Savings account'], ['investment', 'Investment account'],
];

export const TX_TYPES: ReadonlyArray<[TxType, string]> = [
  ['expense', 'Expense'], ['income', 'Income'], ['transfer', 'Transfer'], ['savings', 'Savings'], ['investment', 'Investment'],
];
export const typeLabel = (t: TxType) => TX_TYPES.find((x) => x[0] === t)?.[1] ?? t;
export const accountTypeLabel = (t: AccountType) => ACCOUNT_TYPES.find((x) => x[0] === t)?.[1] ?? t;

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  lookbackMonths: 3,
  emergencyMonths: 6,
  starterMonths: 1,
  highInterestApr: 8,
  expectedReturn: 6,
  inflation: 3,
  horizonYears: 10,
  fxShockPct: 5,
  emergencyGoalId: '',
};

export function defaultSettings(primary = 'MYR', currencies: string[] = [primary]): Settings {
  return {
    version: 1,
    primary,
    currencies: currencies.length ? currencies : [primary],
    manualRates: {},
    accounts: [],
    categories: DEFAULT_CATEGORIES.map(([name, kind, essential]) => ({ id: uid(), name, kind, essential: !!essential })),
    createdAt: new Date().toISOString(),
  };
}

export function defaultPlan(): Plan {
  return { version: 1, budgets: [], goals: [], recurring: [], debts: [], assumptions: { ...DEFAULT_ASSUMPTIONS } };
}

/** Fill in fields missing from older or partial documents. */
export function normalizePlan(p: Partial<Plan> | null | undefined): Plan {
  const d = defaultPlan();
  return {
    ...d,
    ...(p ?? {}),
    budgets: p?.budgets ?? [],
    goals: p?.goals ?? [],
    recurring: p?.recurring ?? [],
    debts: p?.debts ?? [],
    assumptions: { ...DEFAULT_ASSUMPTIONS, ...(p?.assumptions ?? {}) },
  };
}
