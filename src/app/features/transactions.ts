import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TX_TYPES, typeLabel } from '../core/defaults';
import { TxType } from '../core/models';
import { todayISO } from '../core/dates';
import { Actions } from '../shared/actions.service';
import { TxList } from '../shared/bits';
import { ExportService } from '../shared/export.service';
import { Icon } from '../shared/icon';
import { MoneyPipe } from '../shared/money.pipe';
import { LedgerStore } from '../state/ledger.store';
import { EMPTY_FILTERS, TxFilters, UiState } from '../state/ui.state';

@Component({
  selector: 'app-transactions',
  imports: [Icon, MoneyPipe, TxList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="toolbar card">
      <label class="search"><app-icon name="search" /><span class="sr">Search transactions</span>
        <input id="tx-q" type="search" placeholder="Search category, account, notes, amount" [value]="f().q" (input)="set('q', $any($event.target).value)" autocomplete="off"></label>
      <div class="filters">
        <label><span>Type</span><select id="f-type" (change)="set('type', $any($event.target).value)"><option value="" [selected]="!f().type">All types</option>@for (t of types; track t[0]) {<option [value]="t[0]" [selected]="f().type === t[0]">{{ t[1] }}</option>}</select></label>
        <label><span>Category</span><select id="f-cat" (change)="set('cat', $any($event.target).value)"><option value="" [selected]="!f().cat">All categories</option>@for (c of settings().categories; track c.id) {<option [value]="c.id" [selected]="f().cat === c.id">{{ c.name }}</option>}</select></label>
        <label><span>Account</span><select id="f-acc" (change)="set('acc', $any($event.target).value)"><option value="" [selected]="!f().acc">All accounts</option>@for (a of settings().accounts; track a.id) {<option [value]="a.id" [selected]="f().acc === a.id">{{ a.name }} ({{ a.currency }})</option>}</select></label>
        <label><span>Currency</span><select id="f-cur" (change)="set('cur', $any($event.target).value)"><option value="" [selected]="!f().cur">All</option>@for (c of currencies(); track c) {<option [value]="c" [selected]="f().cur === c">{{ c }}</option>}</select></label>
        <label><span>From</span><input id="f-from" type="date" [value]="f().from" (change)="set('from', $any($event.target).value)"></label>
        <label><span>To</span><input id="f-to" type="date" [value]="f().to" (change)="set('to', $any($event.target).value)"></label>
      </div>
      <div class="row-actions">
        @if (activeCount()) {<button class="btn sm ghost" (click)="clear()">Clear {{ activeCount() }} filter{{ activeCount() > 1 ? 's' : '' }}</button>}
        <button class="btn sm" (click)="exp.transactionsCSV(filtered(), 'transactions-' + today + '.csv')"><app-icon name="download" />Export CSV</button>
        <button class="btn sm" (click)="actions.scan()"><app-icon name="scan" />Scan receipts</button>
        <button class="btn sm" (click)="actions.importCsv()"><app-icon name="upload" />Import CSV</button>
      </div>
    </section>
    <section id="tx-results">
      <p class="result-sum"><b>{{ filtered().length }}</b> transaction{{ filtered().length === 1 ? '' : 's' }} · in {{ sum().income | money: P() }} · out {{ sum().expense | money: P() }}@if (sum().savings + sum().investment) { · set aside {{ sum().savings + sum().investment | money: P() }}}</p>
      <app-tx-list [list]="shown()" [empty]="store.transactions().length ? 'No transactions match these filters.' : 'No transactions yet. Use Add, or import a CSV from your bank.'" (edit)="actions.editTx($event)" />
      @if (filtered().length > shown().length) {<button class="btn block" (click)="ui.txLimit.update(n => n + 150)">Show more</button>}
    </section>`,
})
export default class Transactions {
  protected readonly store = inject(LedgerStore);
  protected readonly ui = inject(UiState);
  protected readonly actions = inject(Actions);
  protected readonly exp = inject(ExportService);
  protected readonly P = this.store.primary;
  protected readonly settings = this.store.settingsView;
  protected readonly types = TX_TYPES;
  protected readonly today = todayISO();
  protected readonly f = this.ui.filters;

  protected readonly currencies = computed(() => this.store.finance().usedCurrencies());
  protected readonly activeCount = computed(() => (['type', 'cat', 'acc', 'cur', 'from', 'to'] as const).filter((k) => this.f()[k]).length);
  protected readonly filtered = computed(() => {
    const f = this.f(), fin = this.store.finance();
    const q = f.q.trim().toLowerCase();
    return this.store.transactions().filter((t) => {
      if (f.type && t.type !== f.type) return false;
      if (f.cat && t.categoryId !== f.cat) return false;
      if (f.acc && t.accountId !== f.acc && t.toAccountId !== f.acc) return false;
      if (f.cur && t.currency !== f.cur) return false;
      if (f.from && t.date < f.from) return false;
      if (f.to && t.date > f.to) return false;
      if (q) {
        const hay = [fin.catName(t.categoryId), fin.accName(t.accountId), fin.accName(t.toAccountId), t.notes, t.currency, String(t.amount), typeLabel(t.type), fin.goal(t.goalId)?.name].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });
  protected readonly shown = computed(() => this.filtered().slice(0, this.ui.txLimit()));
  protected readonly sum = computed(() => this.store.finance().summarize(this.filtered()));

  protected set<K extends keyof TxFilters>(k: K, v: string) {
    this.ui.filters.update((f) => ({ ...f, [k]: k === 'type' ? (v as TxType | '') : v }));
    this.ui.txLimit.set(150);
  }
  protected clear() { this.ui.filters.set({ ...EMPTY_FILTERS }); }
}
