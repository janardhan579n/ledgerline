import { CURRENCIES } from './currency';
import { addDays, todayISO, toISO } from './dates';
import { TX_TYPES, uid } from './defaults';
import { findDuplicate } from './receipt';
import { Goal, Settings, Transaction, TxType } from './models';
import { round2 } from './currency';

/** One column of the batch-upload template. Header text is what people see in the spreadsheet. */
export interface BatchColumn {
  key: BatchKey;
  header: string;
  required: 'always' | 'depends' | 'no';
  help: string;
  width: number;
}
export type BatchKey = 'date' | 'type' | 'amount' | 'currency' | 'category' | 'account' | 'toAccount' | 'toAmount' | 'goal' | 'direction' | 'rate' | 'notes';

export function batchColumns(primary: string): BatchColumn[] {
  return [
    { key: 'date', header: 'Date', required: 'always', help: 'Date of the transaction, e.g. 2026-11-05. Excel dates and 05/11/2026 (day first) also work.', width: 13 },
    { key: 'type', header: 'Type', required: 'always', help: 'Expense, Income, Transfer, Savings or Investment.', width: 13 },
    { key: 'amount', header: 'Amount', required: 'always', help: 'Positive number without currency symbol, e.g. 125.50.', width: 12 },
    { key: 'currency', header: 'Currency', required: 'no', help: '3-letter code such as MYR or INR. Leave blank to use the account\'s currency.', width: 10 },
    { key: 'category', header: 'Category', required: 'depends', help: 'Required except for Transfers. Must match one of your categories for that type (see the Lists sheet).', width: 24 },
    { key: 'account', header: 'Account', required: 'always', help: 'The account the money came from (or went into, for Income). Must match an account name.', width: 22 },
    { key: 'toAccount', header: 'To account', required: 'depends', help: 'Transfers: required, the account the money went to. Savings/Investment: optional.', width: 22 },
    { key: 'toAmount', header: 'Amount received', required: 'no', help: 'Transfers between currencies: what arrived in the To account\'s currency.', width: 15 },
    { key: 'goal', header: 'Goal', required: 'no', help: 'Savings only: name of the savings goal this money is for.', width: 18 },
    { key: 'direction', header: 'Direction', required: 'no', help: 'Savings/Investment only: In (default) to put money in, Out to take it out.', width: 10 },
    { key: 'rate', header: `Rate to ${primary}`, required: 'no', help: `Optional. The rate you actually got: 1 unit of the row's currency = this many ${primary}.`, width: 13 },
    { key: 'notes', header: 'Notes', required: 'no', help: 'Anything else, e.g. shop name. Up to 200 characters.', width: 32 },
  ];
}

export type RowValues = Record<BatchKey, string>;

export interface BatchRow {
  /** Row number in the uploaded sheet (header is row 1). */
  line: number;
  values: RowValues;
  errors: Partial<Record<BatchKey, string>>;
  duplicateOf?: string;
  include: boolean;
}

export interface BatchContext {
  settings: Settings;
  goals: Goal[];
  existing: Transaction[];
  today?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const EMPTY: RowValues = { date: '', type: '', amount: '', currency: '', category: '', account: '', toAccount: '', toAmount: '', goal: '', direction: '', rate: '', notes: '' };

/** Maps the header row to column keys. Unknown headers are ignored; returns which required columns are missing. */
export function mapHeaders(headers: string[], primary: string): { map: Map<number, BatchKey>; missing: string[] } {
  const cols = batchColumns(primary);
  const aliases: Record<string, BatchKey> = { receivedamount: 'toAmount', amountreceived: 'toAmount', to: 'toAccount', from: 'account', fromaccount: 'account', description: 'notes', note: 'notes', memo: 'notes', ccy: 'currency' };
  const map = new Map<number, BatchKey>();
  headers.forEach((h, i) => {
    const n = norm(h ?? '');
    if (!n) return;
    const col = cols.find((c) => norm(c.header) === n) ?? (n.startsWith('rate') ? cols.find((c) => c.key === 'rate') : undefined);
    const key = col?.key ?? aliases[n];
    if (key && ![...map.values()].includes(key)) map.set(i, key);
  });
  const have = new Set(map.values());
  const missing = cols.filter((c) => c.required === 'always' && !have.has(c.key)).map((c) => c.header);
  return { map, missing };
}

/** Turns a cell (string, number, Date, Excel rich text) into the text shown in the editor. */
export function cellText(v: unknown, key: BatchKey): string {
  if (v == null) return '';
  if (v instanceof Date) return toISO(new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[]; error?: string };
    if (o.error) return '';
    if (o.richText) return o.richText.map((r) => r.text).join('').trim();
    if (o.result !== undefined) return cellText(o.result, key);
    if (o.text !== undefined) return String(o.text).trim();
  }
  if (typeof v === 'number' && key === 'date' && v > 20000 && v < 80000) {
    // Excel serial date (days since 1899-12-30)
    const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5);
    return toISO(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return String(v).trim();
}

export function rowsFromTable(table: unknown[][], primary: string): { rows: RowValues[]; lines: number[]; missing: string[]; tooMany: boolean } {
  const [head = [], ...body] = table;
  const { map, missing } = mapHeaders(head.map((h) => cellText(h, 'notes')), primary);
  const rows: RowValues[] = [], lines: number[] = [];
  body.forEach((r, i) => {
    const v: RowValues = { ...EMPTY };
    map.forEach((key, col) => (v[key] = cellText(r?.[col], key)));
    if (Object.values(v).every((x) => !x)) return; // skip blank rows
    rows.push(v);
    lines.push(i + 2);
  });
  return { rows: rows.slice(0, 2000), lines: lines.slice(0, 2000), missing, tooMany: rows.length > 2000 };
}

function parseDateText(s: string): string | null {
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) {
    const d = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (d) m = [d[0], d[3], d[2], d[1]] as unknown as RegExpMatchArray;
  }
  if (!m) return null;
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, da);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== da) return null;
  return toISO(dt);
}

const num = (s: string) => {
  const t = s.replace(/[,\s]/g, '').replace(/^(RM|Rs\.?|₹|\$|S\$|€|£)/i, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
};

const findByName = <T extends { name: string }>(list: T[], name: string) => {
  const n = name.trim().toLowerCase();
  return list.find((x) => x.name.trim().toLowerCase() === n);
};

export function typeOf(v: string): TxType | null {
  const n = v.trim().toLowerCase();
  return (TX_TYPES.find(([t, l]) => t === n || l.toLowerCase() === n)?.[0] ?? null) as TxType | null;
}

/** Checks one row. Errors are per field, in plain language, so they can be shown next to the input. */
export function validateRow(v: RowValues, ctx: BatchContext): { errors: Partial<Record<BatchKey, string>>; duplicateOf?: string } {
  const e: Partial<Record<BatchKey, string>> = {};
  const s = ctx.settings;
  const today = ctx.today ?? todayISO();
  const type = typeOf(v.type);
  if (!v.type) e.type = 'Type is required.';
  else if (!type) e.type = `"${v.type}" isn't a type. Use Expense, Income, Transfer, Savings or Investment.`;

  const date = v.date ? parseDateText(v.date) : null;
  if (!v.date) e.date = 'Date is required.';
  else if (!date) e.date = `"${v.date}" isn't a valid date. Use YYYY-MM-DD.`;
  else if (date < '2000-01-01' || date > addDays(today, 366)) e.date = 'Date is out of range.';

  const amount = num(v.amount);
  if (!v.amount) e.amount = 'Amount is required.';
  else if (Number.isNaN(amount)) e.amount = `"${v.amount}" isn't a number.`;
  else if (amount <= 0) e.amount = 'Amount must be more than zero (use Type to say whether money came in or went out).';

  const account = v.account ? findByName(s.accounts, v.account) : undefined;
  if (!v.account) e.account = 'Account is required.';
  else if (!account) e.account = `No account named "${v.account}".`;

  const currency = (v.currency || account?.currency || '').toUpperCase();
  if (v.currency && !/^[A-Z]{3}$/.test(v.currency.toUpperCase())) e.currency = `"${v.currency}" isn't a 3-letter currency code.`;
  else if (v.currency && !CURRENCIES.some((c) => c[0] === currency) && !s.currencies.includes(currency)) e.currency = `Unknown currency "${v.currency}".`;

  if (type && type !== 'transfer') {
    const cat = v.category ? s.categories.find((c) => c.kind === type && c.name.toLowerCase() === v.category.trim().toLowerCase()) : undefined;
    if (!v.category) e.category = `Category is required for ${type}.`;
    else if (!cat) {
      const other = s.categories.find((c) => c.name.toLowerCase() === v.category.trim().toLowerCase());
      e.category = other ? `"${v.category}" is a ${other.kind} category, not ${type}.` : `No ${type} category named "${v.category}".`;
    }
  }

  const to = v.toAccount ? findByName(s.accounts, v.toAccount) : undefined;
  if (v.toAccount && !to) e.toAccount = `No account named "${v.toAccount}".`;
  if (type === 'transfer') {
    if (!v.toAccount) e.toAccount = 'Transfers need a To account.';
    else if (to && account && to.id === account.id) e.toAccount = 'To account must be different from Account.';
  } else if (v.toAccount && type !== 'savings' && type !== 'investment') e.toAccount = 'Only Transfers, Savings and Investments use a To account.';

  if (v.toAmount) {
    const ta = num(v.toAmount);
    if (Number.isNaN(ta) || ta <= 0) e.toAmount = 'Amount received must be a positive number.';
    else if (type !== 'transfer') e.toAmount = 'Only Transfers use Amount received.';
  }
  if (v.goal) {
    if (type !== 'savings') e.goal = 'Only Savings rows can have a Goal.';
    else if (!findByName(ctx.goals, v.goal)) e.goal = `No goal named "${v.goal}".`;
  }
  if (v.direction) {
    if (!/^(in|out)$/i.test(v.direction.trim())) e.direction = 'Direction must be In or Out.';
    else if (type !== 'savings' && type !== 'investment') e.direction = 'Only Savings and Investment rows use Direction.';
  }
  if (v.rate) {
    const r = num(v.rate);
    if (Number.isNaN(r) || r <= 0) e.rate = 'Rate must be a positive number.';
  }
  if (v.notes.length > 200) e.notes = 'Notes can be up to 200 characters.';

  let duplicateOf: string | undefined;
  if (!Object.keys(e).length && type && date && account) {
    if (type === 'income' || type === 'expense') duplicateOf = findDuplicate({ type, amount: round2(amount), currency, date }, ctx.existing)?.id;
    else {
      // Transfers, savings and investments: same account, amount and currency within two days.
      const lo = addDays(date, -2), hi = addDays(date, 2);
      duplicateOf = ctx.existing.find((t) => t.type === type && t.accountId === account.id && t.currency === currency && Math.abs(t.amount - amount) < 0.005 && t.date >= lo && t.date <= hi)?.id;
    }
  }
  return { errors: e, duplicateOf };
}

export function validateAll(rows: RowValues[], lines: number[], ctx: BatchContext): BatchRow[] {
  return rows.map((values, i) => {
    const { errors, duplicateOf } = validateRow(values, ctx);
    return { line: lines[i] ?? i + 2, values, errors, duplicateOf, include: !Object.keys(errors).length && !duplicateOf };
  });
}

/** Converts a row that has passed validation. */
export function rowToTransaction(v: RowValues, ctx: BatchContext, importId: string): Transaction {
  const s = ctx.settings;
  const type = typeOf(v.type)!;
  const account = findByName(s.accounts, v.account)!;
  const to = v.toAccount ? findByName(s.accounts, v.toAccount) : undefined;
  const currency = (v.currency || account.currency).toUpperCase();
  const tx: Transaction = {
    id: uid(), type, amount: round2(num(v.amount)), currency, date: parseDateText(v.date)!,
    categoryId: type === 'transfer' ? null : s.categories.find((c) => c.kind === type && c.name.toLowerCase() === v.category.trim().toLowerCase())?.id ?? null,
    accountId: account.id, notes: v.notes.trim(), importId, createdAt: new Date().toISOString(),
  };
  if (to) tx.toAccountId = to.id;
  if (v.toAmount) tx.toAmount = round2(num(v.toAmount));
  if (v.goal) tx.goalId = findByName(ctx.goals, v.goal)?.id;
  if (/^out$/i.test(v.direction.trim())) tx.out = true;
  if (v.rate && currency !== s.primary) tx.fx = { base: s.primary, rate: num(v.rate) };
  return tx;
}

/**
 * Rows that still have problems, in the template's own columns plus Row and Problems.
 * People can fix this file and upload it again (the extra columns are ignored on upload).
 */
export function errorReport(rows: BatchRow[], primary: string): string[][] {
  const cols = batchColumns(primary);
  const out = [['Row', ...cols.map((c) => c.header), 'Problems']];
  for (const r of rows) {
    const msgs = cols.filter((c) => r.errors[c.key]).map((c) => `${c.header}: ${r.errors[c.key]}`);
    if (msgs.length) out.push([String(r.line), ...cols.map((c) => r.values[c.key]), msgs.join(' | ')]);
  }
  return out;
}
