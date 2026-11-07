import { Injectable, inject } from '@angular/core';
import { moneyPlain } from '../core/currency';
import { toCSV } from '../core/csv';
import { dateLabel, monthLabel, todayISO } from '../core/dates';
import { typeLabel } from '../core/defaults';
import { Finance, ReportData, txSign } from '../core/finance';
import { Transaction } from '../core/models';
import { LedgerStore } from '../state/ledger.store';
import { ToastService } from './toast.service';

export const periodName = (kind: 'month' | 'year', key: string) => (kind === 'year' ? key : monthLabel(key));

@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly store = inject(LedgerStore);
  private readonly toast = inject(ToastService);

  download(filename: string, data: BlobPart, type: string) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    this.toast.show('Downloaded ' + filename);
  }

  private header(f: Finance) {
    return ['Date', 'Type', 'Category', 'Account', 'To account', 'Amount', 'Currency', `Amount (${f.primary})`, 'Rate used', 'Received amount', 'Goal', 'Direction', 'Notes'];
  }
  private row(f: Finance, t: Transaction) {
    const v = f.txValue(t);
    const to = f.account(t.toAccountId);
    const rate = t.currency === f.primary ? 1 : t.fx?.base === f.primary ? t.fx.rate : f.unitValue(t.currency);
    return [
      t.date, typeLabel(t.type), t.type === 'transfer' ? '' : f.catName(t.categoryId), f.accName(t.accountId), to?.name ?? '',
      t.amount.toFixed(2), t.currency, v == null ? '' : v.toFixed(2), rate == null ? '' : +rate.toFixed(6),
      t.toAmount ? `${t.toAmount.toFixed(2)} ${to?.currency ?? ''}` : '', f.goal(t.goalId)?.name ?? '',
      t.type === 'savings' || t.type === 'investment' ? (t.out ? 'out' : 'in') : '', t.notes ?? '',
    ];
  }

  transactionsCSV(list: Transaction[], filename: string) {
    const f = this.store.finance();
    this.download(filename, '﻿' + toCSV([this.header(f), ...list.map((t) => this.row(f, t))]), 'text/csv;charset=utf-8');
  }

  reportCSV(d: ReportData) {
    const f = this.store.finance();
    const pn = periodName(d.kind, d.key), pp = periodName(d.kind, d.prevKey);
    const r: unknown[][] = [[`Finance report: ${pn}`], [`Amounts in ${f.primary}`, `Generated ${todayISO()}`], [], ['Summary', pn, pp, 'Change']];
    for (const [l, k] of [['Income', 'income'], ['Spending', 'expense'], ['Saved', 'savings'], ['Invested', 'investment'], ['Left over', 'net']] as const)
      r.push([l, d.cur[k].toFixed(2), d.prev[k].toFixed(2), (d.cur[k] - d.prev[k]).toFixed(2)]);
    const sec = (title: string, cats: ReportData['expenseCats']) => { r.push([], [title, pn, pp, 'Change']); cats.forEach((c) => r.push([c.name, c.cur.toFixed(2), c.prev.toFixed(2), (c.cur - c.prev).toFixed(2)])); };
    sec('Spending by category', d.expenseCats); sec('Income by category', d.incomeCats); sec('Saved & invested', d.savingCats);
    r.push([], ['Transactions'], this.header(f), ...d.list.map((t) => this.row(f, t)));
    this.download(`report-${d.key}.csv`, '﻿' + toCSV(r), 'text/csv;charset=utf-8');
  }

  async reportPDF(d: ReportData) {
    // Loaded on demand so the PDF library isn't part of the startup bundle.
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const f = this.store.finance();
    const cur = f.primary, pn = periodName(d.kind, d.key), pp = periodName(d.kind, d.prevKey);
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const ink: [number, number, number] = [22, 33, 48], accent: [number, number, number] = [15, 92, 110];
    const m = (v: number) => moneyPlain(v, cur);
    const chg = (a: number, b: number) => (Math.abs(a - b) < 0.005 ? '-' : (a - b > 0 ? '+' : '-') + moneyPlain(Math.abs(a - b), cur));
    const last = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    const base = {
      theme: 'grid' as const, margin: { left: 40, right: 40 },
      styles: { fontSize: 9, cellPadding: 5, textColor: ink, lineColor: [220, 226, 232] as [number, number, number] },
      headStyles: { fillColor: accent, textColor: 255 },
      columnStyles: { 1: { halign: 'right' as const }, 2: { halign: 'right' as const }, 3: { halign: 'right' as const }, 4: { halign: 'right' as const } },
    };
    doc.setTextColor(...ink); doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text(`Finance report: ${pn}`, 40, 56);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90, 100, 115);
    doc.text(`All amounts in ${cur}, converted from original currencies. Generated ${dateLabel(todayISO(), true)}.`, 40, 74);
    const tiles: [string, number][] = [['Income', d.cur.income], ['Spending', d.cur.expense], ['Saved + invested', d.cur.savings + d.cur.investment], ['Left over', d.cur.net]];
    const tw = (W - 80 - 30) / 4;
    tiles.forEach(([label, v], i) => {
      const x = 40 + i * (tw + 10);
      doc.setDrawColor(220, 226, 232); doc.setFillColor(246, 248, 250); doc.roundedRect(x, 90, tw, 50, 4, 4, 'FD');
      doc.setFontSize(8); doc.setTextColor(90, 100, 115); doc.text(label.toUpperCase(), x + 8, 106);
      doc.setFontSize(12); doc.setTextColor(...ink); doc.setFont('helvetica', 'bold'); doc.text(m(v), x + 8, 126); doc.setFont('helvetica', 'normal');
    });
    autoTable(doc, { ...base, startY: 160, head: [['Summary', pn, pp, 'Change']],
      body: [
        ...([['Income', 'income'], ['Spending', 'expense'], ['Saved', 'savings'], ['Invested', 'investment'], ['Left over', 'net']] as const).map(([l, k]) => [l, m(d.cur[k]), m(d.prev[k]), chg(d.cur[k], d.prev[k])]),
        ['Savings rate', d.cur.savingsRate == null ? '-' : Math.round(d.cur.savingsRate * 100) + '%', d.prev.savingsRate == null ? '-' : Math.round(d.prev.savingsRate * 100) + '%', ''],
      ] });
    const catT = (title: string, cats: ReportData['expenseCats'], total: number) => {
      if (!cats.length) return;
      autoTable(doc, { ...base, startY: last() + 18, head: [[title, pn, pp, 'Change', 'Share']], body: cats.map((c) => [c.name, m(c.cur), m(c.prev), chg(c.cur, c.prev), total ? Math.round((c.cur / total) * 100) + '%' : '']) });
    };
    catT('Spending by category', d.expenseCats, d.cur.expense);
    catT('Income by category', d.incomeCats, d.cur.income);
    catT('Saved & invested', d.savingCats, d.cur.savings + d.cur.investment);
    const flows = f.currencyFlows(d.list);
    if (flows.some((x) => x.cur !== cur)) {
      autoTable(doc, { ...base, startY: last() + 18, head: [['Currency', 'Income', 'Spending', 'Net (original)', `Net in ${cur}`]],
        body: flows.map((r) => { const v = f.convert(r.net, r.cur, cur); return [r.cur, moneyPlain(r.inn, r.cur), moneyPlain(r.out, r.cur), moneyPlain(r.net, r.cur), v == null ? 'rate needed' : m(v)]; }) });
    }
    doc.addPage();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...ink); doc.text(`Transactions: ${pn}`, 40, 50);
    autoTable(doc, { ...base, startY: 64, styles: { ...base.styles, fontSize: 8 }, head: [['Date', 'Type', 'Category / accounts', 'Original', cur, 'Notes']],
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { cellWidth: 120 } },
      body: [...d.list].reverse().map((t) => {
        const v = f.txValue(t), s = txSign(t) < 0 ? '-' : '';
        return [t.date, typeLabel(t.type), t.type === 'transfer' ? `${f.accName(t.accountId)} to ${f.accName(t.toAccountId)}` : f.catName(t.categoryId), s + moneyPlain(t.amount, t.currency), v == null ? '-' : s + m(v), (t.notes ?? '').replace(/[^\x20-\x7E]/g, '')];
      }) });
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i); doc.setFontSize(8); doc.setTextColor(130, 138, 150);
      doc.text(`Ledgerline report · ${pn} · page ${i} of ${pages}`, 40, doc.internal.pageSize.getHeight() - 24);
    }
    this.download(`report-${d.key}.pdf`, doc.output('arraybuffer'), 'application/pdf');
  }

  backupJSON() {
    const s = this.store;
    this.download(`ledgerline-backup-${todayISO()}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), settings: s.settings(), plan: s.plan(), transactions: s.transactions() }, null, 2), 'application/json');
  }
}
