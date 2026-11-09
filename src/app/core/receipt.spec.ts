import { describe, expect, it } from 'vitest';
import { defaultSettings } from './defaults';
import { Transaction } from './models';
import { buildPrompt, normalizeCurrency, normalizeDate, toDrafts } from './receipt';

const settings = defaultSettings('MYR', ['MYR', 'INR']);
const cats = settings.categories;
const cat = (n: string) => cats.find((c) => c.name === n)!.id;
const ctx = (existing: Transaction[] = []) => ({ primary: 'MYR', defaultCurrency: 'MYR', accountId: 'acc1', categories: cats, existing, today: '2026-11-09', fileIndex: 0 });

describe('normalizers', () => {
  it('maps currency symbols to ISO codes', () => {
    expect(normalizeCurrency('RM', 'USD')).toBe('MYR');
    expect(normalizeCurrency('₹', 'USD')).toBe('INR');
    expect(normalizeCurrency('inr', 'USD')).toBe('INR');
    expect(normalizeCurrency('', 'MYR')).toBe('MYR');
  });
  it('reads ISO and day-first dates and rejects far-future misreads', () => {
    expect(normalizeDate('2026-11-03', '2026-11-09')).toBe('2026-11-03');
    expect(normalizeDate('03/11/2026', '2026-11-09')).toBe('2026-11-03');
    expect(normalizeDate('2027-11-03', '2026-11-09')).toBeNull();
    expect(normalizeDate('', '2026-11-09')).toBeNull();
  });
});

describe('toDrafts', () => {
  it('turns a receipt into one expense with a matched category', () => {
    const d = toDrafts({ documentType: 'receipt', issuer: 'Tesco Extra', currency: 'RM', transactions: [{ direction: 'out', amount: 86.4, date: '2026-11-08', description: 'Weekly groceries', category: 'Groceries' }] }, ctx());
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ type: 'expense', amount: 86.4, currency: 'MYR', date: '2026-11-08', categoryId: cat('Groceries'), include: true, accountId: 'acc1' });
    expect(d[0].notes).toContain('Tesco');
  });

  it('records a payslip as net pay in Salary, with deductions in the notes', () => {
    const d = toDrafts({
      documentType: 'payslip', currency: 'MYR', transactions: [],
      payslip: { employer: 'Acme Sdn Bhd', payPeriod: 'October 2026', payDate: '2026-10-25', grossPay: 10000, netPay: 8312.5, deductions: [{ name: 'EPF', amount: 1100 }, { name: 'PCB', amount: 540 }, { name: 'SOCSO', amount: 47.5 }] },
    }, ctx());
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ type: 'income', amount: 8312.5, date: '2026-10-25', categoryId: cat('Salary') });
    expect(d[0].notes).toContain('Acme');
    expect(d[0].notes).toContain('EPF 1100');
  });

  it('keeps every line of a statement and flags likely duplicates', () => {
    const existing = [{ id: 'old', type: 'expense', amount: 12, currency: 'MYR', date: '2026-11-01', categoryId: null, accountId: 'acc1', createdAt: '' } as Transaction];
    const d = toDrafts({ documentType: 'bank_statement', currency: 'MYR', transactions: [
      { direction: 'out', amount: '12.00', date: '2026-11-02', description: 'GRAB RIDE' },
      { direction: 'in', amount: 250, date: '2026-11-03', description: 'Refund' },
    ] }, ctx(existing));
    expect(d).toHaveLength(2);
    expect(d[0].duplicateOf).toBe('old');
    expect(d[0].include).toBe(false);
    expect(d[0].categoryId).toBe(cat('Transport'));
    expect(d[1].type).toBe('income');
  });

  it('marks missing amounts and dates as problems instead of guessing', () => {
    const d = toDrafts({ documentType: 'receipt', transactions: [{ direction: 'out', description: 'Blurry' }] }, ctx());
    expect(d[0].include).toBe(false);
    expect(d[0].date).toBe('2026-11-09');
    expect(d[0].problems.length).toBe(2);
  });

  it('returns nothing for an unreadable document', () => {
    expect(toDrafts({ documentType: 'other', transactions: [], warnings: ['Not a receipt'] }, ctx())).toEqual([]);
    expect(toDrafts(null, ctx())).toEqual([]);
  });
});

describe('prompt', () => {
  it('lists the user\'s categories and currencies', () => {
    const p = buildPrompt({ today: '2026-11-09', primary: 'MYR', currencies: ['MYR', 'INR'], incomeCategories: ['Salary'], expenseCategories: ['Groceries'] });
    expect(p).toContain('MYR');
    expect(p).toContain('Groceries');
    expect(p).toContain('netPay');
  });
});
