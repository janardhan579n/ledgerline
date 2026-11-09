import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BatchContext, BatchKey, BatchRow, batchColumns, rowToTransaction, rowsFromTable, typeOf, validateAll, validateRow } from '../core/batch';
import { formatMoney } from '../core/currency';
import { dateLabel } from '../core/dates';
import { TX_TYPES, uid } from '../core/defaults';
import { BatchService } from '../shared/batch.service';
import { DialogService } from '../shared/dialog.service';
import { Icon } from '../shared/icon';
import { Modal } from '../shared/modal';
import { ToastService } from '../shared/toast.service';
import { LedgerStore } from '../state/ledger.store';
import { currencyChoices, ensureCurrency } from './form-helpers';

type Filter = 'all' | 'problems' | 'ready';
interface Bulk { line: number; key: BatchKey; from: string; to: string; count: number }

@Component({
  selector: 'app-batch-upload',
  imports: [Modal, FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal heading="Batch upload transactions" [wide]="true" [locked]="busy()">
      <form (submit)="$event.preventDefault(); importRows()">
        <div class="modal-body">
          @switch (stage()) {
            @case ('start') {
              <ol class="batch-steps">
                <li>
                  <b>Download the template</b>
                  <span class="muted small">An Excel file with dropdowns for your own accounts, categories and goals, plus instructions and examples.</span>
                  <button type="button" class="btn" (click)="template()" [disabled]="busy()"><app-icon name="download" />Download template (.xlsx)</button>
                </li>
                <li>
                  <b>Fill in one transaction per row</b>
                  <span class="muted small">Works in Excel, Numbers, Google Sheets or LibreOffice. Keep the header row. CSV with the same headers works too.</span>
                </li>
                <li>
                  <b>Upload it here</b>
                  <span class="muted small">Every row is checked before anything is saved. You can fix problems on the next screen.</span>
                  <label class="dropzone small-drop" [class.over]="dragging()" (dragover)="$event.preventDefault(); dragging.set(true)" (dragleave)="dragging.set(false)" (drop)="onDrop($event)">
                    <input id="batch-file" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" (change)="onPick($event)" class="sr">
                    <app-icon name="upload" />
                    <b>{{ busy() ? 'Reading…' : 'Choose the filled-in file' }}</b>
                    <span class="muted small">.xlsx or .csv, up to 5 MB and 2,000 rows. Read on your device.</span>
                  </label>
                </li>
              </ol>
            }
            @case ('review') {
              <div class="batch-summary">
                <div><b>{{ fileName() }}</b><span class="muted small"> · {{ rows().length }} row{{ rows().length === 1 ? '' : 's' }}</span></div>
                <div class="batch-counts">
                  <span class="pill good"><app-icon name="check" />{{ counts().ready }} ready</span>
                  @if (counts().problems) {<span class="pill critical"><app-icon name="alert" />{{ counts().problems }} need fixing</span>}
                  @if (counts().dupes) {<span class="pill warning">{{ counts().dupes }} possible duplicate{{ counts().dupes === 1 ? '' : 's' }}</span>}
                </div>
              </div>
              <div class="batch-tools">
                <div class="seg small" role="tablist" aria-label="Show rows">
                  <button type="button" role="tab" [attr.aria-selected]="filter() === 'all'" (click)="setFilter('all')">All</button>
                  <button type="button" role="tab" [attr.aria-selected]="filter() === 'problems'" (click)="setFilter('problems')">Need fixing ({{ counts().problems }})</button>
                  <button type="button" role="tab" [attr.aria-selected]="filter() === 'ready'" (click)="setFilter('ready')">Ready</button>
                </div>
                <span class="spacer"></span>
                @if (counts().problems) {<button type="button" class="btn sm" (click)="batch.downloadErrors(rows())"><app-icon name="download" />Download rows to fix</button>}
              </div>
              @if (missing().length) {
                <p class="banner warning small"><app-icon name="alert" />Missing column{{ missing().length === 1 ? '' : 's' }}: {{ missing().join(', ') }}. Use the template's header row, or fix each row below.</p>
              }
              @if (!shown().length) {<p class="muted small batch-empty">No rows to show here.</p>}
              <ul class="batch-rows">
                @for (r of shown(); track r.line) {
                  <li class="batch-row" [class.bad]="hasErrors(r)" [class.off]="!r.include" [class.open]="editing() === r.line">
                    <div class="br-head">
                      <label class="check"><input type="checkbox" [name]="'inc' + r.line" [ngModel]="r.include" (ngModelChange)="setInclude(r, $event)" [disabled]="hasErrors(r)" [attr.aria-label]="'Import row ' + r.line"></label>
                      <span class="br-line">Row {{ r.line }}</span>
                      <span class="br-sum">{{ summaryOf(r) }}</span>
                      @if (hasErrors(r)) {<span class="pill critical">{{ errorCount(r) }} problem{{ errorCount(r) === 1 ? '' : 's' }}</span>}
                      @else if (r.duplicateOf) {<span class="pill warning">Duplicate?</span>}
                      @else if (!r.include) {<span class="pill neutral">Skipped</span>}
                      @else {<span class="pill good"><app-icon name="check" />Ready</span>}
                      <button type="button" class="btn sm ghost" (click)="toggleEdit(r)" [attr.aria-expanded]="editing() === r.line"><app-icon name="edit" />{{ editing() === r.line ? 'Done' : 'Edit' }}</button>
                    </div>
                    @if (editing() !== r.line) {
                      @for (m of messages(r); track m) {<p class="small br-msg">{{ m }}</p>}
                      @if (r.duplicateOf && !hasErrors(r)) {<p class="small warn-text br-msg">Looks like {{ dupText(r) }}, already recorded. Tick the box to import it anyway.</p>}
                    } @else {
                      <div class="br-grid">
                        @for (c of cols(); track c.key) {
                          @if (visible(r, c.key)) {
                            <div class="field" [class.has-error]="r.errors[c.key]">
                              <label [for]="'b' + r.line + c.key">{{ c.header }}@if (c.required === 'always') {<span aria-hidden="true"> *</span>}</label>
                              @if (options(r, c.key); as opts) {
                                <select [id]="'b' + r.line + c.key" [name]="'b' + r.line + c.key" [ngModel]="r.values[c.key]" (ngModelChange)="setValue(r, c.key, $event)">
                                  @if (c.required !== 'always') {<option value="">—</option>}
                                  @if (r.values[c.key] && !opts.includes(r.values[c.key])) {<option [value]="r.values[c.key]">{{ r.values[c.key] }} (not found)</option>}
                                  @for (o of opts; track o) {<option [value]="o">{{ o }}</option>}
                                </select>
                              } @else {
                                <input [id]="'b' + r.line + c.key" [name]="'b' + r.line + c.key" [type]="inputType(r, c.key)" [attr.inputmode]="isNumber(c.key) ? 'decimal' : null" [attr.maxlength]="c.key === 'notes' ? 200 : null" [ngModel]="r.values[c.key]" (ngModelChange)="setValue(r, c.key, $event)" [placeholder]="c.key === 'date' ? 'YYYY-MM-DD' : ''">
                              }
                              @if (r.errors[c.key]) {<small class="field-err" role="alert">{{ r.errors[c.key] }}</small>}
                            </div>
                          }
                        }
                      </div>
                      @if (bulk(); as b) {
                        @if (b.line === r.line) {
                          <p class="small br-bulk"><app-icon name="refresh" />{{ b.count }} other row{{ b.count === 1 ? ' has' : 's have' }} "{{ b.from }}" in {{ header(b.key) }}.
                            <button type="button" class="btn sm" (click)="applyBulk(b)">Change {{ b.count === 1 ? 'it' : 'all ' + b.count }} to "{{ b.to }}"</button></p>
                        }
                      }
                      @if (r.duplicateOf && !hasErrors(r)) {<p class="small warn-text br-msg">Looks like {{ dupText(r) }}, already recorded. Tick the box to import it anyway.</p>}
                    }
                  </li>
                }
              </ul>
              @if (filtered().length > limit()) {<button type="button" class="btn ghost sm" (click)="limit.set(limit() + 200)">Show more ({{ filtered().length - limit() }} left)</button>}
            }
            @case ('done') {
              <div class="batch-done">
                <app-icon name="check" />
                <b>Imported {{ imported() }} transaction{{ imported() === 1 ? '' : 's' }}.</b>
                @if (leftOver().length) {
                  <p class="muted small">{{ leftOver().length }} row{{ leftOver().length === 1 ? ' was' : 's were' }} not imported because of problems. Download them, fix and upload again.</p>
                  <button type="button" class="btn" (click)="batch.downloadErrors(leftOver())"><app-icon name="download" />Download rows to fix</button>
                }
                <button type="button" class="btn ghost" (click)="undo()" [disabled]="busy()"><app-icon name="refresh" />Undo this import</button>
              </div>
            }
          }
        </div>
        @if (error()) {<p class="form-error" role="alert">{{ error() }}</p>}
        <footer>
          @if (stage() === 'review') {<button type="button" class="btn ghost" (click)="restart()" [disabled]="busy()">Choose another file</button>}
          <span class="spacer"></span>
          @if (stage() === 'review') {<span class="small muted scan-total">{{ total() }}</span>}
          @if (stage() === 'done') {<button type="button" class="btn primary" (click)="dialog.close(imported())">Close</button>}
          @else {
            <button type="button" class="btn ghost" (click)="dialog.close()" [disabled]="busy()">Cancel</button>
            @if (stage() === 'review') {<button type="submit" class="btn primary" [disabled]="busy() || !counts().selected">Import {{ counts().selected || '' }}</button>}
          }
        </footer>
      </form>
    </app-modal>`,
})
export class BatchUpload {
  protected readonly dialog = inject(DialogService);
  protected readonly batch = inject(BatchService);
  private readonly store = inject(LedgerStore);
  private readonly toast = inject(ToastService);

  protected readonly stage = signal<'start' | 'review' | 'done'>('start');
  protected readonly rows = signal<BatchRow[]>([]);
  protected readonly fileName = signal('');
  protected readonly missing = signal<string[]>([]);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly dragging = signal(false);
  protected readonly filter = signal<Filter>('all');
  protected readonly editing = signal<number | null>(null);
  protected readonly bulk = signal<Bulk | null>(null);
  protected readonly limit = signal(200);
  protected readonly imported = signal(0);
  protected readonly leftOver = signal<BatchRow[]>([]);
  private importId = '';

  protected readonly cols = computed(() => batchColumns(this.store.primary()));
  private readonly ctx = computed<BatchContext>(() => ({ settings: this.store.settingsView(), goals: this.store.planView().goals, existing: this.store.transactions() }));
  private readonly accountNames = computed(() => this.store.settingsView().accounts.filter((a) => !a.archived).map((a) => a.name));
  private readonly currencyCodes = computed(() => currencyChoices(this.store.settingsView()).map((c) => c.code));

  protected readonly counts = computed(() => {
    let ready = 0, problems = 0, dupes = 0, selected = 0;
    for (const r of this.rows()) {
      if (this.hasErrors(r)) problems++;
      else { ready++; if (r.duplicateOf) dupes++; if (r.include) selected++; }
    }
    return { ready, problems, dupes, selected };
  });
  protected readonly filtered = computed(() => {
    const f = this.filter(), open = this.editing();
    // The row being edited stays in view even after it's fixed, so it doesn't jump away mid-edit.
    return this.rows().filter((r) => f === 'all' || r.line === open || (f === 'problems' ? this.hasErrors(r) : !this.hasErrors(r)));
  });
  protected readonly shown = computed(() => this.filtered().slice(0, this.limit()));
  protected readonly total = computed(() => {
    const f = this.store.finance(), ctx = this.ctx();
    let inn = 0, out = 0;
    for (const r of this.rows()) {
      if (!r.include || this.hasErrors(r)) continue;
      const t = typeOf(r.values.type);
      if (t !== 'income' && t !== 'expense') continue;
      const tx = rowToTransaction(r.values, ctx, 'preview');
      const v = f.txValue(tx) ?? 0;
      if (t === 'income') inn += v; else out += v;
    }
    return `+${formatMoney(inn, f.primary)} / −${formatMoney(out, f.primary)}`;
  });

  protected hasErrors(r: BatchRow) { return Object.keys(r.errors).length > 0; }
  protected errorCount(r: BatchRow) { return Object.keys(r.errors).length; }
  protected header(k: BatchKey) { return this.cols().find((c) => c.key === k)?.header ?? k; }
  protected messages(r: BatchRow) { return this.cols().filter((c) => r.errors[c.key]).map((c) => `${c.header}: ${r.errors[c.key]}`); }
  protected isNumber(k: BatchKey) { return k === 'amount' || k === 'toAmount' || k === 'rate'; }
  protected inputType(r: BatchRow, k: BatchKey) { return k === 'date' && (!r.values.date || /^\d{4}-\d{2}-\d{2}$/.test(r.values.date)) ? 'date' : 'text'; }
  protected summaryOf(r: BatchRow) {
    const v = r.values;
    const amt = v.amount ? `${v.amount} ${v.currency || ''}`.trim() : '';
    const where = typeOf(v.type) === 'transfer' ? [v.account, v.toAccount].filter(Boolean).join(' → ') : [v.category, v.account].filter(Boolean).join(' · ');
    return [v.date, v.type, amt, where, v.notes].filter(Boolean).join(' · ') || 'Empty row';
  }
  protected dupText(r: BatchRow) {
    const t = this.store.transactions().find((x) => x.id === r.duplicateOf);
    return t ? `${formatMoney(t.amount, t.currency)} on ${dateLabel(t.date, true)} (${this.store.finance().catName(t.categoryId)})` : 'a matching transaction';
  }

  /** Which fields make sense for the row's type. Fields that hold a value or an error always show. */
  protected visible(r: BatchRow, k: BatchKey) {
    if (r.values[k] || r.errors[k]) return true;
    const t = typeOf(r.values.type);
    switch (k) {
      case 'category': return t !== 'transfer';
      case 'toAccount': return t === 'transfer' || t === 'savings' || t === 'investment';
      case 'toAmount': return t === 'transfer';
      case 'goal': return t === 'savings';
      case 'direction': return t === 'savings' || t === 'investment';
      case 'rate': {
        const acc = this.store.settingsView().accounts.find((a) => a.name.toLowerCase() === r.values.account.trim().toLowerCase());
        const ccy = (r.values.currency || acc?.currency || '').toUpperCase();
        return !!ccy && ccy !== this.store.primary();
      }
      default: return true;
    }
  }
  protected options(r: BatchRow, k: BatchKey): string[] | null {
    const s = this.store.settingsView();
    switch (k) {
      case 'type': return TX_TYPES.map((t) => t[1]);
      case 'currency': return this.currencyCodes();
      case 'account': case 'toAccount': return this.accountNames();
      case 'goal': return this.store.planView().goals.map((g) => g.name);
      case 'direction': return ['In', 'Out'];
      case 'category': {
        const t = typeOf(r.values.type);
        return s.categories.filter((c) => (t && t !== 'transfer' ? c.kind === t : c.kind !== 'transfer')).map((c) => c.name);
      }
      default: return null;
    }
  }

  protected setFilter(f: Filter) { this.filter.set(f); this.limit.set(200); }
  protected toggleEdit(r: BatchRow) { this.bulk.set(null); this.editing.set(this.editing() === r.line ? null : r.line); }
  protected setInclude(r: BatchRow, on: boolean) { this.replace({ ...r, include: on }); }

  protected setValue(r: BatchRow, k: BatchKey, value: string) {
    const before = r.values[k];
    const hadError = !!r.errors[k];
    const next = this.recheck({ ...r, values: { ...r.values, [k]: String(value ?? '') } }, r);
    this.replace(next);
    // Offer to fix the same mistake everywhere it appears.
    const others = hadError && before && !next.errors[k] ? this.rows().filter((x) => x.line !== r.line && x.values[k] === before && x.errors[k]).length : 0;
    this.bulk.set(others ? { line: r.line, key: k, from: before, to: next.values[k], count: others } : null);
  }
  protected applyBulk(b: Bulk) {
    this.rows.update((list) => list.map((x) => (x.line !== b.line && x.values[b.key] === b.from && x.errors[b.key] ? this.recheck({ ...x, values: { ...x.values, [b.key]: b.to } }, x) : x)));
    this.toast.show(`Updated ${b.count} row${b.count === 1 ? '' : 's'}.`);
    this.bulk.set(null);
  }
  private recheck(r: BatchRow, prev: BatchRow): BatchRow {
    const { errors, duplicateOf } = validateRow(r.values, this.ctx());
    const ok = !Object.keys(errors).length;
    const wasOk = !this.hasErrors(prev);
    // A row that just became valid is ticked (unless it looks like a duplicate); a broken row is unticked.
    const include = !ok ? false : wasOk ? prev.include && (!duplicateOf || !!prev.duplicateOf) : !duplicateOf;
    return { ...r, errors, duplicateOf, include };
  }
  private replace(r: BatchRow) { this.rows.update((list) => list.map((x) => (x.line === r.line ? r : x))); }

  protected async template() {
    this.busy.set(true);
    this.error.set('');
    try { await this.batch.downloadTemplate(); }
    catch (e) { console.error(e); this.error.set("Couldn't create the template. Check your connection and try again."); }
    finally { this.busy.set(false); }
  }
  protected onPick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) void this.load(f);
  }
  protected onDrop(ev: DragEvent) {
    ev.preventDefault();
    this.dragging.set(false);
    const f = ev.dataTransfer?.files?.[0];
    if (f) void this.load(f);
  }
  private async load(file: File) {
    this.error.set('');
    if (file.size > 5_000_000) return this.error.set('That file is over 5 MB. Split it into smaller files.');
    this.busy.set(true);
    try {
      const table = await this.batch.readFile(file);
      const { rows, lines, missing, tooMany } = rowsFromTable(table, this.store.primary());
      if (!rows.length) return this.error.set('No transactions found. Fill rows under the header row on the Transactions sheet.');
      if (missing.length >= 3) return this.error.set(`This doesn't look like the Ledgerline template (missing ${missing.join(', ')} columns). Download the template and copy your rows into it.`);
      const checked = validateAll(rows, lines, this.ctx());
      this.rows.set(checked);
      this.missing.set(missing);
      this.fileName.set(file.name);
      const bad = checked.filter((r) => this.hasErrors(r));
      this.filter.set(bad.length ? 'problems' : 'all');
      this.editing.set(bad.length === 1 ? bad[0].line : null);
      this.limit.set(200);
      this.stage.set('review');
      if (tooMany) this.toast.show('Only the first 2,000 rows were read. Upload the rest in another file.');
      // Keep a log in the browser console too, for anyone checking later.
      if (bad.length) console.table(bad.flatMap((r) => this.messages(r).map((m) => ({ row: r.line, problem: m }))));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : "That file couldn't be read.");
    } finally {
      this.busy.set(false);
    }
  }

  protected restart() {
    this.stage.set('start');
    this.rows.set([]);
    this.bulk.set(null);
    this.editing.set(null);
    this.error.set('');
  }

  protected async importRows() {
    const ctx = this.ctx();
    const ready = this.rows().filter((r) => r.include && !this.hasErrors(r));
    if (!ready.length) return;
    this.importId = 'batch-' + uid();
    const list = ready.map((r) => rowToTransaction(r.values, ctx, this.importId));
    const missingCcy = [...new Set(list.map((t) => t.currency))].filter((c) => !ctx.settings.currencies.includes(c));
    this.busy.set(true);
    try {
      if (missingCcy.length) await this.store.saveSettings((s) => missingCcy.forEach((c) => ensureCurrency(s, c)));
      await this.store.saveManyTx(list);
      this.imported.set(list.length);
      this.leftOver.set(this.rows().filter((r) => this.hasErrors(r)));
      this.stage.set('done');
      this.toast.show(`Imported ${list.length} transaction${list.length === 1 ? '' : 's'}.`);
    } catch {
      this.error.set("Couldn't save. Check your connection and try again.");
    } finally {
      this.busy.set(false);
    }
  }

  protected async undo() {
    this.busy.set(true);
    try {
      const n = await this.store.deleteImport(this.importId);
      this.toast.show(`Removed ${n} imported transaction${n === 1 ? '' : 's'}.`);
      this.imported.set(0);
      this.stage.set('review');
    } catch {
      this.error.set("Couldn't undo. Check your connection and try again.");
    } finally {
      this.busy.set(false);
    }
  }
}

