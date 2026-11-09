import { addDays, todayISO } from './dates';
import { guessCategory } from './csv';
import { round2 } from './currency';
import { uid } from './defaults';
import { Category, Transaction } from './models';

/** What the reader returns for one uploaded file (shape enforced by the AI response schema). */
export interface RawExtraction {
  documentType?: string;
  issuer?: string;
  currency?: string;
  transactions?: RawTx[];
  payslip?: { employer?: string; payPeriod?: string; payDate?: string; grossPay?: number; netPay?: number; deductions?: { name?: string; amount?: number }[] };
  warnings?: string[];
}
export interface RawTx { direction?: string; amount?: number | string; currency?: string; date?: string; description?: string; category?: string }

export type DocKind = 'receipt' | 'invoice' | 'bill' | 'payslip' | 'bank_statement' | 'other';

/** A transaction proposed from a document, editable before saving. */
export interface DraftTx {
  key: string;
  include: boolean;
  type: 'income' | 'expense';
  amount: number;
  currency: string;
  date: string;
  categoryId: string | null;
  accountId: string;
  notes: string;
  fileIndex: number;
  duplicateOf?: string;
  problems: string[];
}

export interface DraftContext {
  primary: string;
  defaultCurrency: string;
  accountId: string;
  categories: Category[];
  existing: Transaction[];
  today?: string;
  fileIndex: number;
}

const SYMBOLS: Record<string, string> = { RM: 'MYR', 'MYR': 'MYR', '₹': 'INR', RS: 'INR', 'RS.': 'INR', INR: 'INR', $: 'USD', US$: 'USD', 'S$': 'SGD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', AED: 'AED', 'DH': 'AED' };

export function normalizeCurrency(v: string | undefined, fallback: string): string {
  const s = String(v ?? '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(s)) return s;
  return SYMBOLS[s] ?? SYMBOLS[s.replace(/\s/g, '')] ?? fallback;
}

export function normalizeDate(v: string | undefined, today = todayISO()): string | null {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) {
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // day-first, as on Malaysian and Indian documents
    if (m) m = [m[0], m[3], m[2], m[1]] as unknown as RegExpMatchArray;
  }
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000) return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // A date far in the future is almost always a misread.
  return iso > addDays(today, 31) ? null : iso;
}

function toAmount(v: unknown): number {
  if (typeof v === 'number') return Math.abs(v);
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function categoryFor(name: string | undefined, text: string, kind: 'income' | 'expense', cats: Category[]): string | null {
  const n = String(name ?? '').trim().toLowerCase();
  if (n) {
    const exact = cats.find((c) => c.kind === kind && c.name.toLowerCase() === n);
    if (exact) return exact.id;
    const partial = cats.find((c) => c.kind === kind && (c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase())));
    if (partial) return partial.id;
  }
  return guessCategory(`${name ?? ''} ${text}`, kind, cats);
}

/** Same amount and currency within two days counts as a likely duplicate. */
export function findDuplicate(d: Pick<DraftTx, 'amount' | 'currency' | 'date' | 'type'>, existing: Transaction[]): Transaction | undefined {
  const lo = addDays(d.date, -2), hi = addDays(d.date, 2);
  return existing.find((t) => t.type === d.type && t.currency === d.currency && Math.abs(t.amount - d.amount) < 0.005 && t.date >= lo && t.date <= hi);
}

/** Turns one document's extraction into draft transactions. Never throws; problems are attached to each draft. */
export function toDrafts(raw: RawExtraction | null | undefined, ctx: DraftContext): DraftTx[] {
  const today = ctx.today ?? todayISO();
  const docCurrency = normalizeCurrency(raw?.currency, ctx.defaultCurrency);
  const kind = (raw?.documentType ?? 'other') as DocKind;
  const issuer = (raw?.issuer ?? '').trim();
  const out: DraftTx[] = [];

  const push = (type: 'income' | 'expense', amount: number, currency: string, date: string | null, notes: string, catHint?: string) => {
    const problems: string[] = [];
    if (!(amount > 0)) problems.push('Amount not found');
    if (!date) problems.push('Date not found; set to today');
    const d: DraftTx = {
      key: uid(), include: amount > 0, type, amount: round2(amount), currency, date: date ?? today,
      categoryId: categoryFor(catHint, notes, type, ctx.categories), accountId: ctx.accountId, notes: notes.slice(0, 200), fileIndex: ctx.fileIndex, problems,
    };
    const dup = amount > 0 ? findDuplicate(d, ctx.existing) : undefined;
    if (dup) { d.duplicateOf = dup.id; d.include = false; }
    out.push(d);
  };

  if (kind === 'payslip' && raw?.payslip && toAmount(raw.payslip.netPay) > 0) {
    const p = raw.payslip;
    const parts = [p.employer || issuer, p.payPeriod ? `pay for ${p.payPeriod}` : ''].filter(Boolean).join(', ');
    const detail = [
      toAmount(p.grossPay) ? `gross ${round2(toAmount(p.grossPay))}` : '',
      ...(p.deductions ?? []).filter((x) => toAmount(x.amount) > 0).map((x) => `${x.name ?? 'deduction'} ${round2(toAmount(x.amount))}`),
    ].filter(Boolean).join('; ');
    const date = normalizeDate(p.payDate, today) ?? normalizeDate(raw.transactions?.[0]?.date, today);
    push('income', toAmount(p.netPay), docCurrency, date, [parts || 'Salary', detail].filter(Boolean).join(' — '), 'Salary');
    return out;
  }

  for (const t of raw?.transactions ?? []) {
    const type = /^in/i.test(String(t.direction ?? '')) ? 'income' : 'expense';
    const notes = [t.description, issuer && !String(t.description ?? '').toLowerCase().includes(issuer.toLowerCase()) ? issuer : ''].filter(Boolean).join(' · ') || issuer || 'Scanned document';
    push(type, toAmount(t.amount), normalizeCurrency(t.currency, docCurrency), normalizeDate(t.date, today), notes, t.category);
  }
  return out;
}

/** Instructions sent alongside the file. Kept here so they're versioned and testable. */
export function buildPrompt(opts: { today: string; primary: string; currencies: string[]; incomeCategories: string[]; expenseCategories: string[] }): string {
  return [
    'You read financial documents for a personal finance app and return JSON only.',
    `Today is ${opts.today}. The user's main currency is ${opts.primary}; they also use ${opts.currencies.join(', ')}.`,
    'Identify documentType: receipt, invoice, bill, payslip, bank_statement or other.',
    'Rules:',
    '- Receipts, bills and invoices the user paid: ONE transaction, direction "out", amount = final total actually paid (after tax, discounts and rounding; include service charge and tips).',
    '- An invoice the user issued to someone else (user is the seller or freelancer): direction "in".',
    '- Refunds and cashback: direction "in".',
    '- Payslips: fill the payslip object (employer, payPeriod, payDate, grossPay, netPay = take-home pay, deductions such as EPF/KWSP, SOCSO/PERKESO, EIS, PCB/income tax, PF, professional tax, TDS). Also add one transaction: direction "in", amount = netPay, date = pay date.',
    '- Bank or card statements: one transaction per line item; debits/withdrawals are "out", credits/deposits are "in". Skip opening/closing balance lines.',
    '- Amounts are positive numbers without symbols or thousands separators.',
    '- currency is a 3-letter ISO code: RM means MYR, ₹ or Rs means INR, S$ means SGD.',
    '- Dates as YYYY-MM-DD. Dates like 03/11/2026 are day-first (3 November). If no date is visible, omit it.',
    `- category: choose the closest name from these. Spending: ${opts.expenseCategories.join(', ')}. Income: ${opts.incomeCategories.join(', ')}.`,
    '- description: short, e.g. merchant or employer name plus what was bought (max 80 characters).',
    '- If the image is not a financial document or is unreadable, return an empty transactions list and explain in warnings.',
    '- Never invent numbers that are not on the document.',
  ].join('\n');
}
