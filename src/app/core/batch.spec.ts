import { describe, expect, it } from 'vitest';
import { cellText, mapHeaders, rowToTransaction, rowsFromTable, validateAll, validateRow, RowValues, errorReport } from './batch';
import { defaultSettings } from './defaults';
import { Transaction } from './models';

const settings = defaultSettings('MYR', ['MYR', 'INR']);
settings.accounts = [
  { id: 'a1', name: 'Salary account', type: 'bank', currency: 'MYR', opening: 0 },
  { id: 'a2', name: 'INR bank account', type: 'bank', currency: 'INR', opening: 0 },
];
const goals = [{ id: 'g1', name: 'Emergency fund', target: 1000, currency: 'MYR', targetDate: '', startAmount: 0 }];
const ctx = (existing: Transaction[] = []) => ({ settings, goals, existing, today: '2026-11-09' });
const row = (v: Partial<RowValues>): RowValues => ({ date: '', type: '', amount: '', currency: '', category: '', account: '', toAccount: '', toAmount: '', goal: '', direction: '', rate: '', notes: '', ...v });

describe('headers', () => {
  it('maps template headers, aliases and reports missing required columns', () => {
    const { map, missing } = mapHeaders(['Date', 'TYPE', 'amount', 'Description', 'From account'], 'MYR');
    expect([...map.values()]).toEqual(['date', 'type', 'amount', 'notes', 'account']);
    expect(missing).toEqual([]);
    expect(mapHeaders(['Date', 'Amount'], 'MYR').missing).toEqual(['Type', 'Account']);
  });
  it('reads Excel dates, serial numbers and rich text', () => {
    expect(cellText(new Date(Date.UTC(2026, 10, 5)), 'date')).toBe('2026-11-05');
    expect(cellText(46331, 'date')).toBe('2026-11-05');
    expect(cellText({ richText: [{ text: 'Tes' }, { text: 'co' }] }, 'notes')).toBe('Tesco');
    expect(cellText({ formula: 'A1*2', result: 12 }, 'amount')).toBe('12');
    expect(cellText({ error: '#N/A' }, 'amount')).toBe('');
  });
  it('skips blank rows and keeps sheet line numbers', () => {
    const t = rowsFromTable([['Date', 'Type', 'Amount', 'Account'], ['2026-11-01', 'Expense', '10', 'Salary account'], [], [null, '', '', ''], ['2026-11-02', 'Income', '5', 'Salary account']], 'MYR');
    expect(t.rows.length).toBe(2);
    expect(t.lines).toEqual([2, 5]);
  });
});

describe('validation', () => {
  it('accepts a complete expense and converts it', () => {
    const v = row({ date: '05/11/2026', type: 'expense', amount: 'RM 1,250.50', category: 'groceries', account: 'salary account', notes: 'Tesco' });
    expect(validateRow(v, ctx()).errors).toEqual({});
    const tx = rowToTransaction(v, ctx(), 'imp1');
    expect(tx).toMatchObject({ type: 'expense', amount: 1250.5, currency: 'MYR', date: '2026-11-05', accountId: 'a1', importId: 'imp1' });
    expect(tx.categoryId).toBe(settings.categories.find((c) => c.name === 'Groceries')!.id);
  });
  it('explains each problem next to its field', () => {
    const { errors } = validateRow(row({ date: '31/02/2026', type: 'spend', amount: '-5', currency: 'RMX', account: 'Wallet' }), ctx());
    expect(Object.keys(errors).sort()).toEqual(['account', 'amount', 'currency', 'date', 'type']);
    expect(errors.account).toContain('Wallet');
  });
  it('checks category kind, transfer accounts and savings goals', () => {
    expect(validateRow(row({ date: '2026-11-01', type: 'Expense', amount: '10', category: 'Salary', account: 'Salary account' }), ctx()).errors.category).toContain('income category');
    expect(validateRow(row({ date: '2026-11-01', type: 'Transfer', amount: '10', account: 'Salary account' }), ctx()).errors.toAccount).toBeTruthy();
    const ok = row({ date: '2026-11-01', type: 'Transfer', amount: '2000', account: 'Salary account', toAccount: 'INR bank account', toAmount: '46100' });
    expect(validateRow(ok, ctx()).errors).toEqual({});
    expect(rowToTransaction(ok, ctx(), 'x')).toMatchObject({ toAccountId: 'a2', toAmount: 46100, categoryId: null });
    const sav = row({ date: '2026-11-01', type: 'Savings', amount: '500', category: 'Emergency fund', account: 'Salary account', goal: 'Emergency fund', direction: 'out' });
    expect(validateRow(sav, ctx()).errors).toEqual({});
    expect(rowToTransaction(sav, ctx(), 'x')).toMatchObject({ goalId: 'g1', out: true });
  });
  it('flags duplicates and leaves them unticked', () => {
    const existing = [{ id: 'old', type: 'expense', amount: 10, currency: 'MYR', date: '2026-11-01', categoryId: null, accountId: 'a1', createdAt: '' } as Transaction];
    const rows = validateAll([row({ date: '2026-11-02', type: 'Expense', amount: '10', category: 'Groceries', account: 'Salary account' })], [2], ctx(existing));
    expect(rows[0]).toMatchObject({ duplicateOf: 'old', include: false, line: 2 });
    const sav = [{ id: 's1', type: 'savings', amount: 300, currency: 'MYR', date: '2026-11-06', categoryId: null, accountId: 'a1', createdAt: '' } as Transaction];
    const v = row({ date: '2026-11-06', type: 'Savings', amount: '300', category: 'Emergency fund', account: 'Salary account' });
    expect(validateRow(v, ctx(sav)).duplicateOf).toBe('s1');
    expect(validateRow({ ...v, account: 'INR bank account', currency: 'MYR' }, ctx(sav)).duplicateOf).toBeUndefined();
  });
  it('builds an error report', () => {
    const rows = validateAll([row({ type: 'Expense' })], [7], ctx());
    const rep = errorReport(rows, 'MYR');
    expect(rep[0][0]).toBe('Row');
    expect(rep[0].at(-1)).toBe('Problems');
    expect(rep.length).toBe(2);
    expect(rep[1][0]).toBe('7');
    expect(rep[1].at(-1)).toContain('Date: Date is required.');
    // The report can be uploaded again: Row and Problems are ignored, the rest maps back.
    const again = rowsFromTable(rep, 'MYR');
    expect(again.missing).toEqual([]);
    expect(again.rows[0].type).toBe('Expense');
  });
});
