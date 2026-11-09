import { describe, expect, it } from 'vitest';
import { defaultPlan, defaultSettings } from './defaults';
import { Finance, nextOccurrence } from './finance';
import { computeGuidance, project } from './guidance';
import { Ledger, Transaction } from './models';
import { buildImport, parseAmount, parseCSV, parseDate, toCSV } from './csv';

function ledger(tx: Partial<Transaction>[] = [], mut?: (l: Ledger) => void): Ledger {
  const settings = defaultSettings('MYR', ['MYR', 'INR']);
  settings.accounts = [
    { id: 'myr', name: 'Salary', type: 'bank', currency: 'MYR', opening: 1000 },
    { id: 'inr', name: 'INR bank', type: 'bank', currency: 'INR', opening: 0 },
  ];
  const cat = (n: string) => settings.categories.find((c) => c.name === n)!.id;
  const l: Ledger = {
    settings,
    plan: defaultPlan(),
    market: { base: 'USD', asOf: '2026-11-03', fetchedAt: '', source: 'test', rates: { USD: 1, MYR: 4, INR: 92 } },
    transactions: tx.map((t, i) => ({ id: 't' + i, type: 'expense', amount: 0, currency: 'MYR', date: '2026-10-01', categoryId: cat('Groceries'), accountId: 'myr', createdAt: '', ...t } as Transaction)),
  };
  mut?.(l);
  return l;
}
const cat = (l: Ledger, n: string) => l.settings.categories.find((c) => c.name === n)!.id;

describe('exchange rates', () => {
  it('converts through market cross rates', () => {
    const f = new Finance(ledger());
    expect(f.convert(23, 'INR', 'MYR')).toBeCloseTo(1, 6);
    expect(f.convert(1, 'MYR', 'INR')).toBeCloseTo(23, 6);
    expect(f.rateSource('INR')).toBe('market');
  });
  it('lets a manual rate override the market', () => {
    const f = new Finance(ledger([], (l) => (l.settings.manualRates = { INR: { base: 'MYR', rate: 0.05 } })));
    expect(f.convert(100, 'INR', 'MYR')).toBeCloseTo(5, 6);
    expect(f.rateSource('INR')).toBe('manual');
  });
  it('honours a rate locked on a transaction', () => {
    const f = new Finance(ledger());
    const t = { id: 'x', type: 'expense', amount: 1000, currency: 'INR', date: '2026-10-01', categoryId: null, accountId: 'inr', createdAt: '', fx: { base: 'MYR', rate: 0.04 } } as Transaction;
    expect(f.txValue(t)).toBeCloseTo(40, 6);
  });
  it('reports a missing rate as null instead of guessing', () => {
    const f = new Finance(ledger());
    expect(f.convert(10, 'AED', 'MYR')).toBeNull();
  });
});

describe('summaries and balances', () => {
  it('summarises in the primary currency and skips transfers', () => {
    const l = ledger([
      { type: 'income', amount: 8000, categoryId: null },
      { type: 'expense', amount: 2300, currency: 'INR', accountId: 'inr' },
      { type: 'transfer', amount: 1000, toAccountId: 'inr', toAmount: 23200 },
      { type: 'savings', amount: 500 },
      { type: 'investment', amount: 300, out: true },
    ]);
    const s = new Finance(l).summarize(l.transactions);
    expect(s.income).toBe(8000);
    expect(s.expense).toBeCloseTo(100, 6);
    expect(s.savings).toBe(500);
    expect(s.investment).toBe(-300);
    expect(s.net).toBeCloseTo(8000 - 100 - 500 + 300, 6);
  });
  it('uses the received amount on cross-currency transfers', () => {
    const l = ledger([{ type: 'transfer', amount: 1000, toAccountId: 'inr', toAmount: 23200 }]);
    const f = new Finance(l);
    expect(f.accountBalance(l.settings.accounts[0])).toBe(0);
    expect(f.accountBalance(l.settings.accounts[1])).toBe(23200);
  });
  it('flags budgets near and over their limit', () => {
    const l = ledger([{ amount: 450 }]);
    const f = new Finance(l);
    const b = { id: 'b', categoryId: cat(l, 'Groceries'), limit: 500, currency: 'MYR', alertPct: 80 };
    expect(f.budgetUsage(b, '2026-10').status).toBe('near');
    expect(f.budgetUsage({ ...b, limit: 400 }, '2026-10').status).toBe('over');
    expect(f.budgetUsage({ ...b, limit: 1000 }, '2026-10').status).toBe('ok');
  });
});

describe('recurring schedules', () => {
  it('keeps the pay day and clips to short months', () => {
    expect(nextOccurrence({ freq: 'monthly', day: 31 }, '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence({ freq: 'monthly', day: 31 }, '2026-02-28')).toBe('2026-03-31');
    expect(nextOccurrence({ freq: 'biweekly', day: 1 }, '2026-12-25')).toBe('2027-01-08');
  });
  it('lists every missed occurrence as due', () => {
    const l = ledger([], (x) => x.plan.recurring.push({ id: 'r', name: 'Salary', type: 'income', amount: 8000, currency: 'MYR', accountId: 'myr', categoryId: null, freq: 'monthly', day: 25, nextDate: '2026-09-25', isSalary: true }));
    const due = new Finance(l).dueRecurring('2026-11-03');
    expect(due.map((d) => d.date)).toEqual(['2026-09-25', '2026-10-25']);
  });
});

describe('guidance', () => {
  it('fills the waterfall in order', () => {
    const l = ledger(
      [
        { type: 'income', amount: 10000, date: '2026-10-25' },
        { type: 'expense', amount: 3000, date: '2026-10-01', categoryId: null },
      ],
      (x) => {
        x.transactions[1].categoryId = cat(x, 'Rent & housing');
        x.plan.debts.push({ id: 'd', name: 'Card', balance: 2000, currency: 'MYR', apr: 18, minPayment: 100 });
      },
    );
    const g = computeGuidance(new Finance(l), l.plan.assumptions, '2026-11-03');
    expect(g.basis).toBe('complete');
    expect(g.surplus).toBe(7000);
    expect(g.alloc.starter).toBe(3000); // 1 month of essential spending, nothing saved yet
    expect(g.alloc.debt).toBe(2000);
    expect(g.alloc.full).toBe(2000); // remaining surplus goes to the 6-month fund
    expect(g.alloc.invest).toBe(0);
  });
  it('projects contributions without returns at 0%', () => {
    const p = project(100, 0, 2, 0);
    expect(p.finalValue).toBeCloseTo(2400, 6);
    expect(p.labels.length).toBe(3);
  });
});

describe('csv', () => {
  it('round-trips quoted cells', () => {
    const rows = [['a', 'b,c', 'say "hi"'], ['1', '2', '3']];
    expect(parseCSV(toCSV(rows))).toEqual(rows);
  });
  it('neutralizes spreadsheet formulas but keeps numbers', () => {
    const csv = toCSV([['=HYPERLINK("http://evil","x")', '+cmd', '@SUM(A1)', '-12.50', '-x', 'Tesco', 1200]]);
    expect(csv).toBe(`"'=HYPERLINK(""http://evil"",""x"")",'+cmd,'@SUM(A1),-12.50,'-x,Tesco,1200`);
  });
  it('reads common bank date and amount formats', () => {
    expect(parseDate('03/11/2026', 'dmy')).toBe('2026-11-03');
    expect(parseDate('11/03/2026', 'mdy')).toBe('2026-11-03');
    expect(parseDate('3 Nov 2026', 'dmy')).toBe('2026-11-03');
    expect(parseDate('2026-11-03', 'dmy')).toBe('2026-11-03');
    expect(parseAmount('(12.50)')).toBe(-12.5);
    expect(parseAmount('1,250.00 DR')).toBe(-1250);
  });
  it('builds transactions with guessed categories', () => {
    const l = ledger();
    const rows = parseCSV('Date,Description,Debit,Credit\n01/10/2026,GRAB RIDE,12.00,\n25/10/2026,SALARY OCT,,8000.00\nbad,row,,');
    const out = buildImport(rows, { date: 0, description: 1, amount: -1, debit: 2, credit: 3, currencyCol: -1, dateFormat: 'dmy', positiveIsOut: false, accountId: 'myr', accountCurrency: 'MYR' }, l.settings.categories);
    expect(out[0].tx?.type).toBe('expense');
    expect(out[0].tx?.categoryId).toBe(cat(l, 'Transport'));
    expect(out[1].tx?.categoryId).toBe(cat(l, 'Salary'));
    expect(out[2].error).toBeTruthy();
  });
});
