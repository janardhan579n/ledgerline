/** Domain types for Ledgerline. Every amount is stored in its original currency. */

export type TxType = 'expense' | 'income' | 'transfer' | 'savings' | 'investment';
export type CategoryKind = TxType;
export type AccountType = 'bank' | 'cash' | 'card' | 'ewallet' | 'savings' | 'investment';
export type Frequency = 'monthly' | 'biweekly' | 'weekly' | 'yearly';

/** 1 unit of the transaction's currency = `rate` units of `base`. */
export interface LockedRate {
  base: string;
  rate: number;
}

export interface Transaction {
  id: string;
  type: TxType;
  amount: number;
  currency: string;
  /** ISO date, YYYY-MM-DD */
  date: string;
  categoryId: string | null;
  accountId: string;
  toAccountId?: string | null;
  /** Amount that arrived in the destination account's currency (cross-currency transfers). */
  toAmount?: number;
  /** Savings / investment withdrawal. */
  out?: boolean;
  goalId?: string;
  notes?: string;
  fx?: LockedRate;
  recurringId?: string;
  importId?: string;
  /** Stored copy of the scanned receipt or payslip this came from. */
  receiptId?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  opening: number;
  archived?: boolean;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  essential?: boolean;
}

export interface Settings {
  version: number;
  primary: string;
  currencies: string[];
  /** Manual overrides: 1 code = rate base. */
  manualRates: Record<string, LockedRate>;
  accounts: Account[];
  categories: Category[];
  /** Receipt scanning preferences. */
  scan?: { keepCopies: boolean; accountId?: string };
  createdAt: string;
  updatedAt?: string;
}

export interface Budget {
  id: string;
  categoryId: string; // '__all' for total spending
  limit: number;
  currency: string;
  alertPct: number;
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  currency: string;
  targetDate: string;
  startAmount: number;
  emergency?: boolean;
}

export interface Recurring {
  id: string;
  name: string;
  type: 'income' | 'expense';
  amount: number;
  currency: string;
  accountId: string;
  categoryId: string | null;
  freq: Frequency;
  day: number;
  nextDate: string;
  isSalary?: boolean;
  autoPost?: boolean;
  active?: boolean;
  /** Last date this can occur (e.g. the final EMI of a loan). */
  endDate?: string;
  /** Set when this schedule was created for an EMI loan. */
  debtId?: string;
}

export interface Debt {
  id: string;
  name: string;
  balance: number;
  currency: string;
  apr: number;
  minPayment: number;
  /** Present for EMI loans. `balance` and `apr` are then a snapshot as of `emi.nextDate`. */
  emi?: EmiInfo;
}

export interface EmiInfo {
  amount: number;
  /** EMIs left, counting the one due on `nextDate`. */
  monthsLeft: number;
  /** Date of the next EMI when the loan was last saved. Later EMIs are assumed paid on time. */
  nextDate: string;
  /** Day of the month the EMI is debited. */
  day: number;
  /** What the rate was worked out from. */
  basis: 'rate' | 'outstanding' | 'original' | 'none';
  kind?: 'home' | 'car' | 'personal' | 'education' | 'card-emi' | 'gold' | 'other';
  lender?: string;
  original?: number;
  tenure?: number;
  /**
   * Flat-rate loan (car hire purchase, many card instalment plans): the same interest every month,
   * worked out on the original amount. Needs `original` and `tenure`. `Debt.apr` then holds the
   * equivalent reducing-balance rate so loans can be compared.
   */
  flat?: boolean;
  /** Flat rate as quoted by the lender, % a year (worked out when not given). */
  flatRate?: number;
  accountId?: string;
  recurringId?: string;
}

export interface Assumptions {
  lookbackMonths: number;
  emergencyMonths: number;
  starterMonths: number;
  highInterestApr: number;
  expectedReturn: number;
  inflation: number;
  horizonYears: number;
  fxShockPct: number;
  emergencyGoalId: string;
}

export interface Plan {
  version: number;
  budgets: Budget[];
  goals: Goal[];
  recurring: Recurring[];
  debts: Debt[];
  assumptions: Assumptions;
  updatedAt?: string;
}

/** Market reference rates: units of each currency per 1 `base`. */
export interface MarketRates {
  base: string;
  asOf: string;
  fetchedAt: string;
  source: string;
  rates: Record<string, number>;
}

/** Everything the pure finance functions need. */
export interface Ledger {
  settings: Settings;
  plan: Plan;
  transactions: Transaction[]; // newest first
  market: MarketRates | null;
}
