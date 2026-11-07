import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CURRENCIES, currencyName } from '../core/currency';
import { accountTypeLabel } from '../core/defaults';
import { CategoryKind } from '../core/models';
import { Backend } from '../data/backend';
import { RatesService } from '../data/rates.service';
import { Actions } from '../shared/actions.service';
import { confirmAction } from '../shared/confirm-dialog';
import { DialogService } from '../shared/dialog.service';
import { ExportService } from '../shared/export.service';
import { Icon } from '../shared/icon';
import { MoneyPipe } from '../shared/money.pipe';
import { ToastService } from '../shared/toast.service';
import { LedgerStore } from '../state/ledger.store';

@Component({
  selector: 'app-setup',
  imports: [Icon, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid-2">
      <section class="card span-2">
        <div class="card-h"><h3>Currencies & exchange rates</h3>
          <button class="btn sm" (click)="refresh()" [disabled]="rates.refreshing()"><app-icon name="refresh" />{{ rates.refreshing() ? 'Updating…' : 'Update rates now' }}</button></div>
        <div class="field inline"><label for="primary-cur">Primary display currency</label>
          <select id="primary-cur" (change)="setPrimary($any($event.target).value)">
            @for (c of primaryChoices(); track c.code) {<option [value]="c.code" [selected]="c.code === P()">{{ c.code }} · {{ c.name }}</option>}
          </select>
          <small>Totals, reports and guidance are shown in this currency. Every transaction keeps its original amount.</small></div>
        <p class="muted small">
          @if (market(); as m) {Reference rates for <b>{{ m.asOf }}</b> from {{ m.source }}, checked automatically twice a day. A rate you type in replaces the reference rate for that currency until you reset it.}
          @else {No reference rates loaded yet. They're fetched automatically when you're online, or type in a rate for each currency.}
        </p>
        @if (rates.lastError()) {<p class="small warn-text">{{ rates.lastError() }}</p>}
        <div class="table-wrap"><table class="data rates">
          <thead><tr><th>Currency</th><th>Rate used (1 unit in {{ P() }})</th><th>Source</th><th class="num">Reference rate</th><th></th></tr></thead>
          <tbody>
            @for (r of rateRows(); track r.code) {
              <tr><th scope="row">{{ r.code }}<small>{{ r.name }}</small></th>
                @if (r.primary) {<td colspan="3" class="muted">Primary currency</td><td></td>}
                @else {
                  <td><div class="input-unit rate-in"><span>1 {{ r.code }} =</span>
                    <input [id]="'rate-' + r.code" type="number" inputmode="decimal" step="any" min="0" [value]="r.value ?? ''" placeholder="enter rate" (change)="setRate(r.code, $any($event.target).value)"><span>{{ P() }}</span></div>
                    @if (r.inverse) {<small class="muted">{{ r.inverse }}</small>}</td>
                  <td>@switch (r.source) { @case ('manual') {<span class="pill accent">Manual</span>} @case ('market') {<span class="pill neutral">Market</span>} @default {<span class="pill warning">Missing</span>} }</td>
                  <td class="num muted">{{ r.ref ?? '—' }}</td>
                  <td class="row-actions">@if (r.source === 'manual' && r.ref) {<button class="btn sm ghost" (click)="resetRate(r.code)">Use market</button>}<button class="btn sm ghost" (click)="removeCurrency(r.code)">Remove</button></td>
                }
              </tr>
            }
          </tbody></table></div>
        <div class="field inline"><label for="add-cur">Add a currency</label>
          <div class="row-actions"><select id="add-cur" #addCur><option value="">Choose…</option>@for (c of addable(); track c[0]) {<option [value]="c[0]">{{ c[0] }} · {{ c[1] }}</option>}</select>
            <button class="btn sm" (click)="addCurrency(addCur.value)">Add</button></div></div>
      </section>
      <section class="card span-2">
        <div class="card-h"><h3>Accounts</h3><button class="btn sm primary" (click)="actions.account()"><app-icon name="plus" />Add account</button></div>
        @if (accounts().length) {
          <div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Type</th><th>Currency</th><th class="num">Opening balance</th><th class="num">Balance now</th><th></th></tr></thead>
            <tbody>@for (a of accounts(); track a.id) {
              <tr [class.muted]="a.archived"><th scope="row">{{ a.name }}@if (a.archived) { <small>archived</small>}</th><td>{{ a.typeLabel }}</td><td>{{ a.currency }}</td>
                <td class="num">{{ a.opening | money: a.currency }}</td><td class="num">{{ a.bal | money: a.currency }}</td>
                <td><button class="btn sm ghost icon-only" (click)="actions.account(a.raw)" [attr.aria-label]="'Edit ' + a.name"><app-icon name="edit" /></button></td></tr>
            }</tbody></table></div>
        } @else {<p class="empty-sm">No accounts yet.</p>}
      </section>
      <section class="card span-2">
        <div class="card-h"><h3>Categories</h3><button class="btn sm" (click)="actions.category()"><app-icon name="plus" />Add category</button></div>
        <div class="cat-cols">
          @for (k of kinds; track k[0]) {
            <div><h5>{{ k[1] }}</h5><ul class="cat-list">
              @for (c of catsOf(k[0]); track c.id) {
                <li><span>{{ c.name }}@if (k[0] === 'expense' && c.essential) { <span class="pill neutral">Essential</span>}</span>
                  <button class="btn sm ghost icon-only" (click)="actions.category(c)" [attr.aria-label]="'Edit ' + c.name"><app-icon name="edit" /></button></li>
              }</ul></div>
          }
        </div>
      </section>
      <section class="card">
        <div class="card-h"><h3>Import & export</h3></div>
        <div class="stack">
          <button class="btn" (click)="actions.importCsv()"><app-icon name="upload" />Import transactions from CSV</button>
          <button class="btn" (click)="exp.transactionsCSV(store.transactions(), 'all-transactions.csv')"><app-icon name="download" />Export all transactions (CSV)</button>
          <button class="btn" (click)="exp.backupJSON()"><app-icon name="download" />Download full backup (JSON)</button>
        </div>
      </section>
      <section class="card">
        <div class="card-h"><h3>Account & privacy</h3></div>
        @if (backend.mode === 'demo') {
          <p class="small">Demo mode: nothing is saved. Add your Firebase project details to <code>src/environments/firebase.config.ts</code> and deploy to keep your data (see README).</p>
        } @else {
          <p class="small">Signed in as <b>{{ backend.user()?.email }}</b>. Your records are stored in your own Firestore folder, which the security rules let only your sign-in read or change. A copy is cached on this device so the app works offline.</p>
        }
        <div class="row-actions">
          <button class="btn" (click)="backend.signOut()"><app-icon name="logout" />Sign out</button>
          <button class="btn danger" (click)="deleteAll()">Delete all my data</button>
        </div>
      </section>
    </div>`,
})
export default class Setup {
  protected readonly store = inject(LedgerStore);
  protected readonly actions = inject(Actions);
  protected readonly exp = inject(ExportService);
  protected readonly rates = inject(RatesService);
  protected readonly backend = inject(Backend);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  protected readonly P = this.store.primary;
  protected readonly market = this.store.market;
  protected readonly kinds: [CategoryKind, string][] = [['income', 'Income'], ['expense', 'Spending'], ['savings', 'Savings'], ['investment', 'Investment'], ['transfer', 'Transfers']];
  protected readonly settings = this.store.settingsView;

  protected readonly primaryChoices = computed(() => {
    const used = this.settings().currencies;
    return [...used, ...CURRENCIES.map((c) => c[0]).filter((c) => !used.includes(c))].map((code) => ({ code, name: currencyName(code) }));
  });
  protected readonly addable = computed(() => CURRENCIES.filter((c) => !this.settings().currencies.includes(c[0])));
  protected readonly rateRows = computed(() => {
    const f = this.store.finance();
    return this.settings().currencies.map((code) => {
      if (code === f.primary) return { code, name: currencyName(code), primary: true, value: null, inverse: '', source: 'primary', ref: null };
      const v = f.unitValue(code), ref = f.marketUnitValue(code);
      const digits = v && v < 1 ? 6 : 4;
      return {
        code, name: currencyName(code), primary: false, value: v ? +v.toFixed(digits) : null, source: f.rateSource(code), ref: ref ? ref.toFixed(digits) : null,
        inverse: v ? `1 ${f.primary} = ${(1 / v).toFixed(v < 1 ? 4 : 6).replace(/\.?0+$/, '')} ${code}` : '',
      };
    });
  });
  protected readonly accounts = computed(() => {
    const f = this.store.finance();
    return this.settings().accounts.map((a) => ({ ...a, raw: a, bal: f.accountBalance(a), typeLabel: accountTypeLabel(a.type) }));
  });
  protected catsOf(kind: CategoryKind) { return this.settings().categories.filter((c) => c.kind === kind); }

  protected async refresh() {
    if (await this.rates.refresh()) this.toast.show('Exchange rates updated.');
  }
  protected setPrimary(c: string) {
    this.store.saveSettings((s) => { s.primary = c; if (!s.currencies.includes(c)) s.currencies.push(c); });
    this.toast.show(`Totals now shown in ${c}.`);
  }
  protected setRate(code: string, raw: string) {
    const v = Number(raw);
    this.store.saveSettings((s) => { if (raw === '' || !(v > 0)) delete s.manualRates[code]; else s.manualRates[code] = { base: s.primary, rate: v }; });
    this.toast.show(raw === '' ? `${code} now uses the market rate.` : `Saved: 1 ${code} = ${v} ${this.P()}`);
  }
  protected resetRate(code: string) { this.store.saveSettings((s) => { delete s.manualRates[code]; }); }
  protected addCurrency(code: string) { if (code) this.store.saveSettings((s) => { if (!s.currencies.includes(code)) s.currencies.push(code); }); }
  protected removeCurrency(code: string) {
    if (this.settings().accounts.some((a) => a.currency === code) || this.store.transactions().some((t) => t.currency === code))
      return this.toast.show(`${code} is used by an account or transaction, so it stays.`);
    this.store.saveSettings((s) => { s.currencies = s.currencies.filter((x) => x !== code); delete s.manualRates[code]; });
  }
  protected async deleteAll() {
    const ok = await confirmAction(this.dialog, "Delete every transaction, account, budget, goal and setting you've stored? This can't be undone. Download a backup first if you might need it.", 'Delete everything');
    if (!ok) return;
    await this.store.deleteEverything();
    this.toast.show('All data deleted.');
  }
}
