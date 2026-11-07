import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { currencyName } from '../core/currency';
import { accountTypeLabel } from '../core/defaults';
import { dateLabel, monthLabel, periodRange } from '../core/dates';
import { HBars } from '../shared/charts';
import { MoneyPipe } from '../shared/money.pipe';
import { LedgerStore } from '../state/ledger.store';
import { UiState } from '../state/ui.state';

@Component({
  selector: 'app-cashflow',
  imports: [HBars, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="toolbar card report-bar">
      <div class="seg" role="tablist" aria-label="Cash flow period">
        <button role="tab" [attr.aria-selected]="ui.cashflowKind() === 'month'" (click)="ui.cashflowKind.set('month')">{{ monthName() }}</button>
        <button role="tab" [attr.aria-selected]="ui.cashflowKind() === 'year'" (click)="ui.cashflowKind.set('year')">Year {{ ui.month().slice(0, 4) }}</button>
      </div>
      <p class="muted small">Amounts stay in their original currency. The {{ P() }} column converts each net figure at today's rate.</p>
    </section>
    <section class="card">
      <div class="card-h"><h3>Money in and out, by currency</h3></div>
      @if (flows().length) {
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Currency</th><th class="num">Income</th><th class="num">Spending</th><th class="num">Converted in</th><th class="num">Converted out</th><th class="num">Saved & invested</th><th class="num">Net</th><th class="num">Net in {{ P() }}</th></tr></thead>
          <tbody>@for (r of flows(); track r.cur) {
            <tr><th scope="row">{{ r.cur }}<small>{{ cname(r.cur) }}</small></th>
              <td class="num">{{ r.inn | money: r.cur }}</td><td class="num">{{ r.out | money: r.cur }}</td><td class="num">{{ r.xferIn | money: r.cur }}</td><td class="num">{{ r.xferOut | money: r.cur }}</td>
              <td class="num">{{ r.set | money: r.cur }}</td><td class="num"><b [class.neg]="r.net < 0" [class.pos]="r.net >= 0">{{ r.net | money: r.cur }}</b></td>
              <td class="num">@if (r.netP != null) {<span>{{ r.netP | money: P() }}</span>} @else {<span class="warn-text">rate needed</span>}</td></tr>
          }</tbody></table></div>
      } @else {<p class="empty-sm">No transactions in this period.</p>}
    </section>
    <div class="grid-2">
      <section class="card">
        <div class="card-h"><h3>Currency conversions</h3><span class="muted">transfers between currencies</span></div>
        @if (conversions().length) {
          <ul class="fx-list">@for (c of conversions(); track c.id) {
            <li><div><b>{{ c.amount | money: c.from }} → @if (c.recv) {<span>{{ c.recv | money: c.to }}</span>} @else {amount received not entered}</b><small>{{ c.date }} · {{ c.fromName }} to {{ c.toName }}</small></div>
              <div class="num">@if (c.got) {<span>1 {{ c.from }} = {{ c.got.toFixed(4) }} {{ c.to }}</span>}@if (c.diff != null) {<small [class.warn-text]="c.diff < -0.01" [class.muted]="c.diff >= -0.01">{{ c.diff >= 0 ? '+' : '−' }}{{ abs(c.diff * 100).toFixed(1) }}% vs today's rate</small>}</div></li>
          }</ul>
        } @else {<p class="empty-sm">When you move money from a {{ P() }} account to an account in another currency, record it as a Transfer with the amount received. You'll see the rate you actually got here.</p>}
      </section>
      <section class="card">
        <div class="card-h"><h3>Spending by currency</h3></div>
        <app-hbars [items]="spend()" [currency]="P()" empty="No spending in this period." />
        <p class="muted small">Values in {{ P() }}. If your income is in one currency and spending in another, rate changes affect how far your income goes. The Guidance page estimates that effect.</p>
      </section>
      <section class="card span-2">
        <div class="card-h"><h3>Account balances</h3><span class="muted">as of today</span></div>
        <div class="table-wrap"><table class="data"><thead><tr><th>Account</th><th>Type</th><th class="num">Balance</th><th class="num">In {{ P() }}</th><th class="num">Rate</th></tr></thead>
          <tbody>@for (a of accounts(); track a.id) {
            <tr><th scope="row">{{ a.name }}</th><td>{{ a.typeLabel }}</td><td class="num">{{ a.bal | money: a.currency }}</td>
              <td class="num">@if (a.balP != null) {<span>{{ a.balP | money: P() }}</span>} @else {<span class="warn-text">rate needed</span>}</td><td class="num muted">{{ a.rate }}</td></tr>
          }</tbody></table></div>
      </section>
    </div>`,
})
export default class Cashflow {
  protected readonly store = inject(LedgerStore);
  protected readonly ui = inject(UiState);
  protected readonly P = this.store.primary;
  protected readonly cname = currencyName;
  protected readonly abs = Math.abs;
  protected readonly monthName = computed(() => monthLabel(this.ui.month()));
  private readonly list = computed(() => {
    const kind = this.ui.cashflowKind();
    return this.store.finance().txIn(...periodRange(kind, kind === 'year' ? this.ui.month().slice(0, 4) : this.ui.month()));
  });
  protected readonly flows = computed(() => {
    const f = this.store.finance(), P = this.P();
    return f.currencyFlows(this.list()).sort((a, b) => (a.cur === P ? -1 : b.cur === P ? 1 : a.cur.localeCompare(b.cur))).map((r) => ({ ...r, netP: f.convert(r.net, r.cur, P) }));
  });
  protected readonly conversions = computed(() => {
    const f = this.store.finance();
    return this.list().flatMap((t) => {
      const from = f.account(t.accountId), to = f.account(t.toAccountId);
      if (t.type !== 'transfer' || !from || !to || from.currency === to.currency) return [];
      const recv = t.toAmount && t.toAmount > 0 ? t.toAmount : null;
      const got = recv ? recv / t.amount : null;
      const ref = f.convert(1, t.currency, to.currency);
      return [{ id: t.id, amount: t.amount, from: t.currency, to: to.currency, recv, got, diff: got && ref ? (got - ref) / ref : null, date: dateLabel(t.date, true), fromName: from.name, toName: to.name }];
    });
  });
  protected readonly spend = computed(() => {
    const f = this.store.finance();
    const m: Record<string, number> = {};
    for (const t of this.list()) if (t.type === 'expense') { const v = f.txValue(t); if (v != null) m[t.currency] = (m[t.currency] ?? 0) + v; }
    const total = Object.values(m).reduce((a, b) => a + b, 0) || 1;
    const colors = ['var(--s2)', 'var(--s1)', 'var(--s3)', 'var(--s4)'];
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([c, v], i) => ({ label: `${c} · ${currencyName(c)}`, value: v, sub: Math.round((v / total) * 100) + '%', color: colors[i % 4] }));
  });
  protected readonly accounts = computed(() => {
    const f = this.store.finance();
    return this.store.settingsView().accounts.filter((a) => !a.archived).map((a) => {
      const bal = f.accountBalance(a);
      return { ...a, bal, balP: f.convert(bal, a.currency, f.primary), typeLabel: accountTypeLabel(a.type), rate: a.currency === f.primary ? '—' : f.rateText(a.currency, f.primary) };
    });
  });
}
