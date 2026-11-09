import { Injectable, inject } from '@angular/core';
import { todayISO } from '../core/dates';
import { uid } from '../core/defaults';
import { RawExtraction, DraftTx, buildPrompt, toDrafts } from '../core/receipt';
import { ReceiptDoc } from '../data/backend';
import { ReadError, ReceiptReader } from '../data/receipt-reader';
import { LedgerStore } from '../state/ledger.store';
import { SUPPORTED, blobToBase64, isImage, isPdf, shrinkImage, shrinkToBudget } from './files';

export const MAX_UPLOAD = 15 * 1024 * 1024;
/** Kept copies stay well under Firestore's 1 MiB document limit after base64. */
const COPY_BUDGET = 300 * 1024;

export interface ScannedFile {
  index: number;
  name: string;
  status: 'waiting' | 'reading' | 'done' | 'failed';
  error?: string;
  retryable?: boolean;
  docType?: string;
  issuer?: string;
  warnings: string[];
  drafts: DraftTx[];
  /** Copy to keep with the transactions, if one fits. */
  copy?: { blob: Blob; mime: string } | null;
  copyNote?: string;
  previewUrl?: string;
}

/** Runs each uploaded file through the reader and turns the result into draft transactions. */
@Injectable({ providedIn: 'root' })
export class ScanService {
  private readonly store = inject(LedgerStore);
  readonly reader = inject(ReceiptReader);

  check(file: File): string | null {
    const mime = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : '');
    if (!SUPPORTED.test(mime)) return 'Only photos (JPG, PNG, HEIC, WebP) and PDFs can be scanned.';
    if (file.size > MAX_UPLOAD) return 'This file is over 15 MB. Use a smaller photo or export fewer pages.';
    return null;
  }

  async scan(file: File, item: ScannedFile, opts: { accountId: string; keepCopy: boolean }, changed: () => void = () => undefined): Promise<void> {
    const problem = this.check(file);
    if (problem) { Object.assign(item, { status: 'failed', error: problem }); return; }
    item.status = 'reading';
    changed();
    const mime = file.type || 'application/pdf';
    try {
      // Smaller images read just as well and upload much faster on mobile data.
      let payload: Blob = file, payloadMime = mime;
      if (isImage(mime)) {
        const small = await shrinkImage(file, 2000, 0.85);
        if (small) { payload = small; payloadMime = 'image/jpeg'; }
        item.previewUrl = URL.createObjectURL(small ?? file);
        changed();
      }
      if (opts.keepCopy) {
        if (isImage(mime)) {
          const b = await shrinkToBudget(file, COPY_BUDGET);
          item.copy = b ? { blob: b, mime: 'image/jpeg' } : null;
          if (!b) item.copyNote = "This photo format can't be shrunk in this browser, so no copy will be kept.";
        } else if (isPdf(mime) && file.size <= COPY_BUDGET * 1.5) {
          item.copy = { blob: file, mime };
        } else {
          item.copy = null;
          item.copyNote = 'PDF is too large to keep a copy (limit 450 KB). The numbers are still saved.';
        }
      }
      const s = this.store.settingsView();
      const prompt = buildPrompt({
        today: todayISO(), primary: s.primary, currencies: s.currencies,
        incomeCategories: s.categories.filter((c) => c.kind === 'income').map((c) => c.name),
        expenseCategories: s.categories.filter((c) => c.kind === 'expense').map((c) => c.name),
      });
      const raw: RawExtraction = await this.reader.read({ data: await blobToBase64(payload), mime: payloadMime, prompt });
      const account = this.store.finance().account(opts.accountId);
      item.docType = raw.documentType;
      item.issuer = raw.issuer;
      item.warnings = raw.warnings ?? [];
      item.drafts = toDrafts(raw, {
        primary: s.primary, defaultCurrency: account?.currency ?? s.primary, accountId: opts.accountId,
        categories: s.categories, existing: this.store.transactions(), fileIndex: item.index,
      });
      if (!item.drafts.length && !item.warnings.length) item.warnings.push('No amounts were found in this file.');
      item.status = 'done';
    } catch (e) {
      item.status = 'failed';
      item.error = e instanceof ReadError ? e.message : "Couldn't read this file. Try again or enter it manually.";
      item.retryable = e instanceof ReadError ? e.retryable : true;
    }
  }

  /** Saves the included drafts and, for files that have one, the kept copy. Returns how many were recorded. */
  async save(files: ScannedFile[]): Promise<number> {
    const txs = [];
    for (const f of files) {
      const chosen = f.drafts.filter((d) => d.include && d.amount > 0);
      if (!chosen.length) continue;
      let receiptId: string | undefined;
      if (f.copy) {
        receiptId = uid();
        const doc: ReceiptDoc = { id: receiptId, name: f.name.slice(0, 120), mime: f.copy.mime, data: await blobToBase64(f.copy.blob), size: f.copy.blob.size, createdAt: new Date().toISOString() };
        void this.store.saveReceipt(doc);
      }
      for (const d of chosen) {
        txs.push({
          id: uid(), type: d.type, amount: d.amount, currency: d.currency, date: d.date, categoryId: d.categoryId, accountId: d.accountId,
          notes: d.notes, createdAt: new Date().toISOString(), ...(receiptId ? { receiptId } : {}),
        });
      }
    }
    if (txs.length) {
      const s = this.store.settingsView();
      for (const t of txs) if (!s.currencies.includes(t.currency)) { await this.store.saveSettings((x) => { if (!x.currencies.includes(t.currency)) x.currencies.push(t.currency); }); break; }
      await this.store.saveManyTx(txs);
    }
    return txs.length;
  }
}
