import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DateFormat, ImportMapping, buildImport, parseCSV } from '../core/csv';
import { uid } from '../core/defaults';
import { DialogService } from '../shared/dialog.service';
import { Modal } from '../shared/modal';
import { MoneyPipe } from '../shared/money.pipe';
import { ToastService } from '../shared/toast.service';
import { LedgerStore } from '../state/ledger.store';
import { activeAccounts } from './form-helpers';
import { typeLabel } from '../core/defaults';

@Component({
  selector: 'app-import-csv',
  imports: [Modal, FormsModule, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal heading="Import transactions from CSV" [wide]="true">
      <form (submit)="$event.preventDefault(); importRows()">
        <div class="modal-body">
          <div class="field"><label for="ci-file">CSV file from your bank or app</label>
            <input id="ci-file" type="file" accept=".csv,text/csv,text/plain" (change)="onFile($event)">
            <small>The file is read on your device. Only the transactions you import are saved to your account.</small></div>
          @if (rows().length) {
            <div class="field-row three">
              <div class="field"><label for="ci-date">Date column</label><select id="ci-date" name="date" [(ngModel)]="map.date" (ngModelChange)="bump()">@for (h of headers(); track $index) {<option [ngValue]="$index">{{ h }}</option>}</select></div>
              <div class="field"><label for="ci-fmt">Date format</label><select id="ci-fmt" name="fmt" [(ngModel)]="map.dateFormat" (ngModelChange)="bump()"><option value="dmy">Day/Month/Year</option><option value="mdy">Month/Day/Year</option><option value="ymd">Year-Month-Day</option></select></div>
              <div class="field"><label for="ci-desc">Description column</label><select id="ci-desc" name="desc" [(ngModel)]="map.description" (ngModelChange)="bump()"><option [ngValue]="-1">None</option>@for (h of headers(); track $index) {<option [ngValue]="$index">{{ h }}</option>}</select></div>
            </div>
            <div class="field-row three">
              <div class="field"><label for="ci-amount">Amount column</label><select id="ci-amount" name="amount" [(ngModel)]="map.amount" (ngModelChange)="bump()"><option [ngValue]="-1">None (use money in/out)</option>@for (h of headers(); track $index) {<option [ngValue]="$index">{{ h }}</option>}</select></div>
              <div class="field"><label for="ci-debit">Money out column</label><select id="ci-debit" name="debit" [(ngModel)]="map.debit" (ngModelChange)="bump()"><option [ngValue]="-1">None</option>@for (h of headers(); track $index) {<option [ngValue]="$index">{{ h }}</option>}</select></div>
              <div class="field"><label for="ci-credit">Money in column</label><select id="ci-credit" name="credit" [(ngModel)]="map.credit" (ngModelChange)="bump()"><option [ngValue]="-1">None</option>@for (h of headers(); track $index) {<option [ngValue]="$index">{{ h }}</option>}</select></div>
            </div>
            <div class="field-row three">
              <div class="field"><label for="ci-acc">Import into account</label><select id="ci-acc" name="acc" [(ngModel)]="map.accountId" (ngModelChange)="onAccount()">@for (a of accounts(); track a.id) {<option [value]="a.id">{{ a.name }} ({{ a.currency }})</option>}</select></div>
              <div class="field"><label for="ci-sign">In a single amount column</label><select id="ci-sign" name="sign" [(ngModel)]="map.positiveIsOut" (ngModelChange)="bump()"><option [ngValue]="false">Negative = money out</option><option [ngValue]="true">Positive = money out</option></select></div>
              <div class="field"><label for="ci-cur">Currency column</label><select id="ci-cur" name="cur" [(ngModel)]="map.currencyCol" (ngModelChange)="bump()"><option [ngValue]="-1">None (use account currency)</option>@for (h of headers(); track $index) {<option [ngValue]="$index">{{ h }}</option>}</select></div>
            </div>
            <p class="muted small">Categories are guessed from the description (for example "GRAB" becomes Transport). You can change any of them afterwards.</p>
            <p><b>{{ ok().length }}</b> of {{ rows().length - 1 }} rows ready@if (skipped()) {, {{ skipped() }} skipped (no valid date or amount)}.</p>
            <div class="table-wrap"><table class="data">
              <thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Category</th><th class="num">Amount</th></tr></thead>
              <tbody>@for (t of ok().slice(0, 8); track t.id) {<tr><td>{{ t.date }}</td><td>{{ t.notes }}</td><td>{{ label(t.type) }}</td><td>{{ fin().catName(t.categoryId) }}</td><td class="num">{{ t.amount | money: t.currency }}</td></tr>}</tbody>
            </table></div>
          }
        </div>
        @if (error()) {<p class="form-error" role="alert">{{ error() }}</p>}
        <footer><span class="spacer"></span><button type="button" class="btn ghost" (click)="dialog.close()">Cancel</button><button type="submit" class="btn primary" [disabled]="!ok().length">Import {{ ok().length || '' }}</button></footer>
      </form>
    </app-modal>`,
})
export class ImportCsv {
  protected readonly dialog = inject(DialogService);
  private readonly store = inject(LedgerStore);
  private readonly toast = inject(ToastService);
  protected readonly fin = this.store.finance;
  protected readonly accounts = computed(() => activeAccounts(this.store.settingsView()));
  protected readonly rows = signal<string[][]>([]);
  protected readonly headers = computed(() => (this.rows()[0] ?? []).map((h, i) => h.trim() || `Column ${i + 1}`));
  protected readonly error = signal('');
  private readonly version = signal(0);
  protected label = typeLabel;
  protected map: ImportMapping = { date: 0, description: -1, amount: -1, debit: -1, credit: -1, currencyCol: -1, dateFormat: 'dmy', positiveIsOut: false, accountId: this.accounts()[0]?.id ?? '', accountCurrency: this.accounts()[0]?.currency ?? 'MYR' };

  private readonly built = computed(() => { this.version(); return this.rows().length ? buildImport(this.rows(), this.map, this.store.settingsView().categories) : []; });
  protected readonly ok = computed(() => this.built().filter((r) => r.tx).map((r) => r.tx!));
  protected readonly skipped = computed(() => this.built().length - this.ok().length);

  protected bump() { this.version.update((v) => v + 1); }
  protected onAccount() {
    this.map.accountCurrency = this.store.finance().account(this.map.accountId)?.currency ?? this.map.accountCurrency;
    this.bump();
  }
  protected onFile(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 5_000_000) return this.error.set('That file is over 5 MB. Export a shorter date range from your bank.');
    file.text().then((text) => {
      const rows = parseCSV(text);
      if (rows.length < 2) return this.error.set('That file has no data rows.');
      this.error.set('');
      const h = rows[0].map((x) => x.trim());
      const find = (re: RegExp) => h.findIndex((x) => re.test(x));
      const di = find(/date/i), de = find(/desc|narr|detail|particular|merchant|payee|memo|remark/i);
      const am = find(/^amount|amount$|amt/i), db = find(/debit|withdraw|money out|paid out/i), cr = find(/credit|deposit|money in|paid in/i), cc = find(/curr/i);
      const sample = rows.slice(1, 6).map((r) => r[di >= 0 ? di : 0]).join(' ');
      this.map = {
        ...this.map, date: Math.max(0, di), description: de,
        amount: db >= 0 && cr >= 0 ? -1 : am, debit: db >= 0 && cr >= 0 ? db : -1, credit: db >= 0 && cr >= 0 ? cr : -1,
        currencyCol: cc, dateFormat: (/\d{4}-\d{2}-\d{2}/.test(sample) ? 'ymd' : 'dmy') as DateFormat,
      };
      this.rows.set(rows);
      this.bump();
    });
  }
  protected importRows() {
    const list = this.ok();
    if (!list.length) return this.error.set('No rows could be read. Check the date and amount columns.');
    const importId = uid();
    this.store.saveManyTx(list.map((t) => ({ ...t, importId })));
    this.toast.show(`Imported ${list.length} transactions.`);
    this.dialog.close(list.length);
  }
}
