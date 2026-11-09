import { Injectable, inject } from '@angular/core';
import type { DataValidation, Workbook, Worksheet } from 'exceljs';
import { BatchColumn, batchColumns, errorReport, BatchRow } from '../core/batch';
import { parseCSV, toCSV } from '../core/csv';
import { CURRENCIES } from '../core/currency';
import { todayISO } from '../core/dates';
import { TX_TYPES } from '../core/defaults';
import { LedgerStore } from '../state/ledger.store';
import { ExportService } from './export.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Rows in the template that get dropdowns and formats. */
const TEMPLATE_ROWS = 1000;

const loadExcel = async () => {
  const m = await import('exceljs');
  return (m as unknown as { default?: typeof m }).default ?? m;
};

/** Builds the batch-upload template and reads uploaded sheets. ExcelJS is only downloaded when needed. */
@Injectable({ providedIn: 'root' })
export class BatchService {
  private readonly store = inject(LedgerStore);
  private readonly exp = inject(ExportService);

  async downloadTemplate() {
    const s = this.store.settingsView();
    const goals = this.store.planView().goals;
    const cols = batchColumns(s.primary);
    const Excel = await loadExcel();
    const wb: Workbook = new Excel.Workbook();
    wb.creator = 'Ledgerline';
    wb.created = new Date();

    // Lists sheet: the allowed values, one column each. Dropdowns point here.
    const accounts = s.accounts.filter((a) => !a.archived);
    const kinds = ['expense', 'income', 'savings', 'investment'] as const;
    const catsOf = (k: string) => s.categories.filter((c) => c.kind === k).map((c) => c.name);
    const allCats = [...new Set(kinds.flatMap((k) => catsOf(k)))];
    const currencies = [...new Set([...s.currencies, ...CURRENCIES.map((c) => c[0])])];
    const lists: [string, string[]][] = [
      ['Types', TX_TYPES.map((t) => t[1])],
      ['Accounts', accounts.map((a) => a.name)],
      ['Account currency', accounts.map((a) => a.currency)],
      ['Currencies', currencies],
      ['All categories', allCats],
      ['Expense categories', catsOf('expense')],
      ['Income categories', catsOf('income')],
      ['Savings categories', catsOf('savings')],
      ['Investment categories', catsOf('investment')],
      ['Goals', goals.map((g) => g.name)],
      ['Direction', ['In', 'Out']],
    ];

    const ws = wb.addWorksheet('Transactions', { views: [{ state: 'frozen', ySplit: 1 }] });
    const ls = wb.addWorksheet('Lists');
    const ins = wb.addWorksheet('Instructions');

    ls.columns = lists.map(([h]) => ({ header: h, width: Math.max(14, h.length + 4) }));
    lists.forEach(([, vals], c) => vals.forEach((v, r) => (ls.getCell(r + 2, c + 1).value = v)));
    styleHeader(ls);
    ls.state = 'visible';
    const range = (name: string) => {
      const i = lists.findIndex(([h]) => h === name);
      const letter = ls.getColumn(i + 1).letter;
      const n = Math.max(1, lists[i][1].length);
      return `Lists!$${letter}$2:$${letter}$${n + 1}`;
    };

    ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width }));
    styleHeader(ws);
    cols.forEach((c, i) => {
      const cell = ws.getRow(1).getCell(i + 1);
      cell.note = { texts: [{ text: `${c.required === 'always' ? 'Required. ' : c.required === 'depends' ? 'Sometimes required. ' : 'Optional. '}${c.help}` }] };
      if (c.required !== 'always') {
        cell.font = { bold: true, color: { argb: 'FF1F2A27' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.required === 'depends' ? 'FFCFE3DC' : 'FFE8ECEA' } };
      }
    });

    const dropdown: Partial<Record<BatchColumn['key'], string>> = {
      type: range('Types'), currency: range('Currencies'), category: range('All categories'), account: range('Accounts'),
      toAccount: range('Accounts'), goal: range('Goals'), direction: range('Direction'),
    };
    // One validation per column range (per-cell validations make ExcelJS write overlapping ranges Excel rejects).
    // Range-level add() exists at runtime but is missing from ExcelJS's type definitions.
    const validations = (ws as unknown as { dataValidations: { add(address: string, v: DataValidation): void } }).dataValidations;
    cols.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      const area = `${col.letter}2:${col.letter}${TEMPLATE_ROWS + 1}`;
      const list = dropdown[c.key];
      if (list && (c.key !== 'goal' || goals.length)) {
        validations.add(area, { type: 'list', allowBlank: true, formulae: [list], showErrorMessage: c.key !== 'currency', errorStyle: 'warning', errorTitle: c.header, error: 'Pick a value from the list (see the Lists sheet).' });
      } else if (c.key === 'date') {
        for (let r = 2; r <= TEMPLATE_ROWS + 1; r++) ws.getCell(r, i + 1).numFmt = 'yyyy-mm-dd';
        validations.add(area, { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(2000, 0, 1))], showErrorMessage: true, errorStyle: 'warning', errorTitle: 'Date', error: 'Enter a date, for example 2026-11-05.' });
      } else if (c.key === 'amount' || c.key === 'toAmount' || c.key === 'rate') {
        const fmt = c.key === 'rate' ? '0.######' : '#,##0.00';
        for (let r = 2; r <= TEMPLATE_ROWS + 1; r++) ws.getCell(r, i + 1).numFmt = fmt;
        validations.add(area, { type: 'decimal', operator: 'greaterThan', allowBlank: true, formulae: [0], showErrorMessage: true, errorStyle: 'warning', errorTitle: c.header, error: 'Enter a number greater than zero, without a currency symbol.' });
      }
    });

    // Instructions: what each column means, plus worked examples.
    ins.columns = [{ width: 18 }, { width: 18 }, { width: 90 }];
    ins.addRow(['How to use this template']).font = { bold: true, size: 14 };
    ins.addRow(['1. Fill one transaction per row on the Transactions sheet. Dropdowns list your own accounts, categories and goals.']);
    ins.addRow(['2. Save the file and upload it in Ledgerline: Transactions → Batch upload. You can also save as CSV with the same headers.']);
    ins.addRow(['3. Ledgerline checks every row first. Rows with problems are shown with the reason and can be fixed on screen before anything is saved.']);
    ins.addRow([`Amounts are always positive: the Type says whether money came in or went out. Your main currency is ${s.primary}.`]);
    ins.addRow(['If you add accounts or categories in Ledgerline later, download a fresh template so the dropdowns include them.']);
    ins.addRow([]);
    const h = ins.addRow(['Column', 'Required?', 'What to enter']);
    h.font = { bold: true };
    for (const c of cols) ins.addRow([c.header, c.required === 'always' ? 'Yes' : c.required === 'depends' ? 'Sometimes' : 'No', c.help]);
    ins.addRow([]);
    ins.addRow(['Examples']).font = { bold: true, size: 12 };
    const ex = ins.addRow(cols.map((c) => c.header));
    ex.font = { bold: true };
    const a0 = accounts[0]?.name ?? 'Your account', a1 = accounts.find((a) => a.currency !== accounts[0]?.currency)?.name ?? accounts[1]?.name ?? 'Other account';
    const pick = (k: string, re: RegExp) => catsOf(k).find((n) => re.test(n)) ?? catsOf(k)[0] ?? '';
    const t = todayISO();
    const examples: Partial<Record<BatchColumn['key'], string | number>>[] = [
      { date: t, type: 'Expense', amount: 42.9, category: pick('expense', /grocer/i), account: a0, notes: 'Weekly groceries' },
      { date: t, type: 'Income', amount: 6500, category: pick('income', /salary/i), account: a0, notes: 'November salary' },
      { date: t, type: 'Transfer', amount: 1000, account: a0, toAccount: a1, toAmount: 23050, notes: 'Send home' },
      { date: t, type: 'Savings', amount: 300, category: pick('savings', /goal|emerg/i), account: a0, goal: goals[0]?.name ?? '', direction: 'In' },
    ];
    for (const e of examples) ins.addRow(cols.map((c) => e[c.key] ?? '')).font = { color: { argb: 'FF555555' }, italic: true };
    ins.getColumn(1).alignment = { wrapText: false };
    ins.getColumn(3).alignment = { wrapText: true, vertical: 'top' };

    wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 0, visibility: 'visible' }];
    const buf = await wb.xlsx.writeBuffer();
    this.exp.download('ledgerline-batch-template.xlsx', buf as ArrayBuffer, XLSX);
  }

  /** Reads an uploaded .xlsx or .csv into a grid of raw cell values (first row = headers). */
  async readFile(file: File): Promise<unknown[][]> {
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv') || file.type === 'text/csv' || name.endsWith('.txt')) return parseCSV(await file.text());
    if (!name.endsWith('.xlsx') && file.type !== XLSX) throw new Error('Upload the template as .xlsx (Excel) or .csv. Older .xls files need to be saved as .xlsx first.');
    // Read with a small values-only reader: ExcelJS fails on some files (for example ones with comments).
    const { readXlsx } = await import('../core/xlsx-read');
    return readXlsx(new Uint8Array(await file.arrayBuffer()));
  }

  downloadErrors(rows: BatchRow[]) {
    const s = this.store.settingsView();
    this.exp.download(`ledgerline-rows-to-fix-${todayISO()}.csv`, '﻿' + toCSV(errorReport(rows, s.primary)), 'text/csv;charset=utf-8');
  }
}

function styleHeader(ws: Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5D50' } };
  row.alignment = { vertical: 'middle' };
  row.height = 20;
}

