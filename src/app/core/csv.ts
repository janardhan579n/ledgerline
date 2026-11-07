import { round2, toNumber } from './currency';
import { uid } from './defaults';
import { Category, Transaction } from './models';

export const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export const toCSV = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

/** RFC 4180-style parser; detects ';' as the separator when the header uses it more than ','. */
export function parseCSV(text: string): string[][] {
  text = text.replace(/^﻿/, '');
  const first = text.split('\n')[0] ?? '';
  const sep = (first.match(/;/g) ?? []).length > (first.match(/,/g) ?? []).length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

export type DateFormat = 'dmy' | 'mdy' | 'ymd';
const MONTHS = 'janfebmaraprmayjunjulaugsepoctnovdec';

export function parseDate(input: string, fmt: DateFormat): string | null {
  const s = String(input ?? '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/. ](\d{1,2}|[A-Za-z]{3,})[-/. ](\d{2,4})/);
  if (!m) return null;
  let [, a, b, y] = m;
  if (y.length === 2) y = '20' + y;
  if (/[A-Za-z]/.test(b)) {
    const i = MONTHS.indexOf(b.slice(0, 3).toLowerCase());
    if (i < 0) return null;
    b = String(i / 3 + 1);
  } else if (fmt === 'mdy') [a, b] = [b, a];
  if (+b < 1 || +b > 12 || +a < 1 || +a > 31) return null;
  return `${y}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
}

/** Bank-statement amounts: "(12.50)", "-12.50", "12.50 DR" are negative; "CR" positive. */
export function parseAmount(input: string): number {
  const s = String(input ?? '').trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /DR$/i.test(s);
  const n = toNumber(s.replace(/[()]/g, '').replace(/(CR|DR)$/i, ''));
  return neg ? -Math.abs(n) : n;
}

const KEYWORDS: [RegExp, string][] = [
  [/salary|payroll|gaji|wages/i, 'Salary'], [/bonus/i, 'Bonus'], [/interest|dividend/i, 'Interest & dividends'],
  [/refund|cashback|reversal/i, 'Refunds & cashback'], [/rent|landlord/i, 'Rent & housing'],
  [/tnb|electric|water|syabas|indah|bses|tneb|\bgas\b|bill/i, 'Utilities & bills'],
  [/tesco|lotus|aeon|giant|mydin|jaya grocer|village grocer|bigbasket|blinkit|zepto|dmart|grocer|supermarket/i, 'Groceries'],
  [/grab(?!food)|uber|\bola\b|rapido|petrol|shell|petronas|caltex|bhpetrol|toll|touch ?n ?go|\btng\b|parking|\bmrt\b|\blrt\b|rapidkl|irctc|fuel/i, 'Transport'],
  [/insurance|takaful|\blic\b|prudential|\baia\b|allianz|great eastern/i, 'Insurance'],
  [/pharmacy|clinic|hospital|guardian|watsons|apollo|medical|doctor/i, 'Health'],
  [/celcom|maxis|digi|unifi|umobile|airtel|\bjio\b|vodafone|broadband/i, 'Phone & internet'],
  [/netflix|spotify|youtube|prime video|disney|hotstar|icloud|google one|subscription/i, 'Subscriptions'],
  [/swiggy|zomato|foodpanda|grabfood|restaurant|cafe|coffee|starbucks|mcd|kfc|domino|pizza|mamak/i, 'Dining out'],
  [/shopee|lazada|amazon|flipkart|myntra|ikea|uniqlo|zalora/i, 'Shopping'],
  [/cinema|\bgsc\b|\btgv\b|\bpvr\b|movie|steam|playstation/i, 'Entertainment'],
  [/airasia|malaysia airlines|indigo|air india|booking\.com|agoda|hotel|airbnb|flight/i, 'Travel'],
  [/loan|credit card payment|\bemi\b|ptptn/i, 'Loan & card payments'], [/fee|charge|commission/i, 'Fees & charges'],
];

export function guessCategory(text: string, kind: 'income' | 'expense', categories: Category[]): string | null {
  for (const [re, name] of KEYWORDS) {
    if (re.test(text)) {
      const c = categories.find((x) => x.name === name && x.kind === kind);
      if (c) return c.id;
    }
  }
  const fallback = categories.find((x) => x.kind === kind && /^Other/.test(x.name)) ?? categories.find((x) => x.kind === kind);
  return fallback?.id ?? null;
}

export interface ImportMapping {
  date: number;
  description: number; // -1 none
  amount: number; // -1 when using debit/credit
  debit: number;
  credit: number;
  currencyCol: number;
  dateFormat: DateFormat;
  positiveIsOut: boolean;
  accountId: string;
  accountCurrency: string;
}

export interface ImportRow { tx?: Transaction; error?: string }

export function buildImport(rows: string[][], map: ImportMapping, categories: Category[]): ImportRow[] {
  return rows.slice(1).map((r) => {
    const date = parseDate(r[map.date], map.dateFormat);
    let amount = 0;
    if (map.debit >= 0 || map.credit >= 0) {
      amount = (map.credit >= 0 ? Math.abs(parseAmount(r[map.credit])) : 0) - (map.debit >= 0 ? Math.abs(parseAmount(r[map.debit])) : 0);
    } else if (map.amount >= 0) {
      amount = parseAmount(r[map.amount]);
      if (map.positiveIsOut) amount = -amount;
    }
    if (!date) return { error: 'date' };
    if (!amount) return { error: 'amount' };
    const desc = map.description >= 0 ? String(r[map.description] ?? '').trim() : '';
    const type = amount < 0 ? 'expense' : 'income';
    const curCell = map.currencyCol >= 0 ? String(r[map.currencyCol] ?? '').trim().toUpperCase() : '';
    return {
      tx: {
        id: uid(), type, amount: round2(Math.abs(amount)), currency: /^[A-Z]{3}$/.test(curCell) ? curCell : map.accountCurrency,
        date, categoryId: guessCategory(desc, type, categories), accountId: map.accountId, notes: desc.slice(0, 200), createdAt: new Date().toISOString(),
      },
    };
  });
}
