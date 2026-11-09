import { loanStatus } from '../core/loans';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { addMonths, dateLabel, monthLabel, periodRange, todayISO } from '../core/dates';
import { Actions } from '../shared/actions.service';
import { Delta, StatusPill, TxList } from '../shared/bits';
import { BarChart, HBars, Legend, Progress } from '../shared/charts';
import { MoneyPipe } from '../shared/money.pipe';
import { LedgerStore } from '../state/ledger.store';
import { EMPTY_FILTERS, UiState } from '../state/ui.state';
import { Alerts } from './alerts';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, Alerts, BarChart, HBars, Legend, Progress, MoneyPipe, Delta, StatusPill, TxList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!settings().accounts.length) {
      <div class="welcome card">
        <h2>Start with your accounts</h2>
        <p>Add the places your money sits, such as a {{ P() }} bank account for your salary and an account for spending in another currency. Each account has its own currency, and every transaction keeps its original amount.</p>
        <div class="row-actions"><button class="btn primary" (click)="actions.account()">Add an account</button><a class="btn" routerLink="/setup">Currencies & rates</a></div>
      </div>
    } @else {
      <app-alerts [month]="ui.month()" />
      <section class="tiles" aria-label="This month">
        @for (t of tiles(); track t.label) {
          <button class="tile" type="button" (click)="openType(t.type)">
            <span class="tile-k"><i [style.background]="t.color"></i>{{ t.label }}</span>
            <span class="tile-v">{{ t.now | money: P() }}</span>
            <app-delta [now]="t.now" [before]="t.before" [goodWhenUp]="t.up" />
          </button>
        }
        <div class="tile net" [class.neg]="s().net < 0">
          <span class="tile-k">Left over</span>
          <span class="tile-v">{{ s().net | money: P() }}</span>
          <span class="delta flat">{{ s().savingsRate == null ? 'Record income to see your savings rate' : 'You kept ' + pct(s().savingsRate!) + '% of income after spending' }}</span>
        </div>
      </section>
      @if (s().unconverted) {<p class="note warn-text">{{ s().unconverted }} transaction(s) have no exchange rate and are not in these totals.</p>}
      <div class="grid-2">
        <section class="card span-2">
          <div class="card-h"><h3>Six-month trend</h3><span class="muted">in {{ P() }}</span></div>
          <app-legend [series]="trend()" />
          <app-bar-chart [labels]="trendLabels().short" [tipLabels]="trendLabels().long" [series]="trend()" [currency]="P()" [highlight]="5" ariaLabel="Income, spending and money set aside over six months" />
        </section>
        <section class="card">
          <div class="card-h"><h3>Where it went</h3><a class="link" routerLink="/reports">Full report</a></div>
          <app-hbars [items]="cats()" [currency]="P()" color="var(--s2)" empty="No spending recorded this month." />
          @if (spendByCur().length > 1) {
            <div class="cur-split">@for (c of spendByCur(); track c.cur) {<span>{{ c.cur }} <b>{{ c.pct }}%</b></span>}<small>of spending, by original currency</small></div>
          }
        </section>
        <section class="card">
          <div class="card-h"><h3>Budgets</h3><a class="link" routerLink="/budgets">Manage</a></div>
          @if (budgets().length) {
            <ul class="mini-list">
              @for (b of budgets(); track b.b.id) {
                <li><div class="ml-top"><span>{{ b.name }}</span><app-status-pill [status]="b.u.status" /></div>
                  <app-progress [value]="b.u.pct" [status]="b.u.status" />
                  <small>{{ b.u.spent | money: b.b.currency }} of {{ b.b.limit | money: b.b.currency }}</small></li>
              }
            </ul>
          } @else {
            <p class="empty-sm">Set a monthly limit for a category to get alerts before you overspend.</p>
            <button class="btn sm" (click)="actions.budget()">Add a budget</button>
          }
        </section>
        <section class="card">
          <div class="card-h"><h3>Savings goals</h3><a class="link" routerLink="/goals">All goals</a></div>
          @if (goals().length) {
            <ul class="mini-list">
              @for (g of goals(); track g.g.id) {
                <li><div class="ml-top"><span>{{ g.g.name }}</span><b>{{ pct(g.pct) }}%</b></div>
                  <app-progress [value]="g.pct" [status]="g.pct >= 1 ? 'done' : 'goal'" />
                  <small>{{ g.saved | money: g.g.currency }} of {{ g.g.target | money: g.g.currency }}@if (g.g.targetDate) { · by {{ date(g.g.targetDate) }}}</small></li>
              }
            </ul>
          } @else {
            <p class="empty-sm">Name something you're saving for and track progress as you set money aside.</p>
            <button class="btn sm" (click)="actions.goal()">Add a goal</button>
          }
        </section>
        @if (loans().length) {
          <section class="card">
            <div class="card-h"><h3>Loans & EMIs</h3><a class="link" routerLink="/loans">Details</a></div>
            <ul class="mini-list">
              @for (l of loans(); track l.d.id) {
                <li><div class="ml-top"><span>{{ l.d.name }}</span><b>{{ l.s.payable | money: l.d.currency }}</b></div>
                  @if (l.s.life) {<app-progress [value]="l.s.life.progress" status="goal" />}
                  <small>{{ l.s.left }} EMI{{ l.s.left === 1 ? '' : 's' }} of {{ l.s.emi | money: l.d.currency }} left · next {{ date(l.s.nextDate!) }}</small></li>
              }
            </ul>
          </section>
        }
        <section class="card">
          <div class="card-h"><h3>Accounts</h3><span class="muted">{{ balances().missing ? 'partial total' : 'total' }} {{ balances().total | money: P() }}</span></div>
          @for (grp of balances().groups; track grp.cur) {
            <div class="acc-group"><h5>{{ grp.cur }}@if (grp.cur !== P()) {<small>{{ fin().rateText(grp.cur, P()) }}</small>}</h5>
              <ul class="acc-list">@for (x of grp.items; track x.id) {<li><span>{{ x.name }}</span><b [class.neg]="x.bal < 0">{{ x.bal | money: grp.cur }}</b></li>}</ul></div>
          }
        </section>
        <section class="card span-2">
          <div class="card-h"><h3>Recent transactions</h3><a class="link" routerLink="/transactions">See all</a></div>
          <app-tx-list [list]="recent()" [grouped]="false" empty="Nothing recorded yet. Use Add to record your first transaction." (edit)="actions.editTx($event)" />
        </section>
      </div>
    }`,
})
export default class Dashboard {
  protected readonly store = inject(LedgerStore);
  protected readonly ui = inject(UiState);
  protected readonly actions = inject(Actions);
  private readonly router = inject(Router);
  protected readonly P = this.store.primary;
  protected readonly fin = this.store.finance;
  protected readonly settings = this.store.settingsView;
  protected readonly pct = (v: number) => Math.round(v * 100);
  protected readonly date = (d: string) => dateLabel(d, true);

  protected readonly s = computed(() => this.fin().monthSummary(this.ui.month()));
  protected readonly loans = computed(() => {
    const today = todayISO();
    return this.store.planView().debts.filter((d) => d.emi).map((d) => ({ d, s: loanStatus(d, today)! })).filter((x) => !x.s.done).slice(0, 4);
  });
  private readonly prev = computed(() => this.fin().monthSummary(addMonths(this.ui.month(), -1)));
  protected readonly tiles = computed(() => {
    const s = this.s(), p = this.prev();
    return [
      { label: 'Income', type: 'income' as const, now: s.income, before: p.income, up: true, color: 'var(--s1)' },
      { label: 'Spending', type: 'expense' as const, now: s.expense, before: p.expense, up: false, color: 'var(--s2)' },
      { label: 'Saved', type: 'savings' as const, now: s.savings, before: p.savings, up: true, color: 'var(--s3)' },
      { label: 'Invested', type: 'investment' as const, now: s.investment, before: p.investment, up: true, color: 'var(--s4)' },
    ];
  });
  private readonly months = computed(() => [5, 4, 3, 2, 1, 0].map((i) => addMonths(this.ui.month(), -i)));
  protected readonly trendLabels = computed(() => ({ short: this.months().map((m) => monthLabel(m, 'short')), long: this.months().map((m) => monthLabel(m)) }));
  protected readonly trend = computed(() => {
    const sums = this.months().map((m) => this.fin().monthSummary(m));
    return [
      { name: 'Income', color: 'var(--s1)', values: sums.map((x) => x.income) },
      { name: 'Spending', color: 'var(--s2)', values: sums.map((x) => x.expense) },
      { name: 'Saved & invested', color: 'var(--s3)', values: sums.map((x) => Math.max(0, x.savings + x.investment)) },
    ];
  });
  protected readonly cats = computed(() => {
    const s = this.s();
    return this.fin().catBreakdown(s, 'expense').slice(0, 6).map((c) => ({ label: c.name, value: c.value, sub: s.expense ? this.pct(c.value / s.expense) + '%' : '' }));
  });
  protected readonly spendByCur = computed(() => {
    const f = this.fin();
    const m: Record<string, number> = {};
    for (const t of f.txIn(...periodRange('month', this.ui.month()))) if (t.type === 'expense') { const v = f.txValue(t); if (v != null) m[t.currency] = (m[t.currency] ?? 0) + v; }
    const total = Object.values(m).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(m).map(([cur, v]) => ({ cur, pct: this.pct(v / total) }));
  });
  protected readonly budgets = computed(() =>
    this.store.planView().budgets.map((b) => ({ b, u: this.fin().budgetUsage(b, this.ui.month()), name: b.categoryId === '__all' ? 'Total spending' : this.fin().catName(b.categoryId) }))
      .sort((a, b) => b.u.pct - a.u.pct).slice(0, 4));
  protected readonly goals = computed(() => this.store.planView().goals.slice(0, 3).map((g) => { const saved = this.fin().goalSaved(g); return { g, saved, pct: g.target ? saved / g.target : 0 }; }));
  protected readonly balances = computed(() => {
    const f = this.fin();
    const groups: Record<string, { id: string; name: string; bal: number }[]> = {};
    let total = 0, missing = false;
    for (const a of this.settings().accounts.filter((x) => !x.archived)) {
      const bal = f.accountBalance(a);
      (groups[a.currency] ??= []).push({ id: a.id, name: a.name, bal });
      const v = f.convert(bal, a.currency, f.primary);
      if (v == null) missing = true; else total += v;
    }
    return { total, missing, groups: Object.entries(groups).map(([cur, items]) => ({ cur, items })) };
  });
  protected readonly recent = computed(() => this.store.transactions().slice(0, 6));

  protected openType(type: 'income' | 'expense' | 'savings' | 'investment') {
    const [from, to] = periodRange('month', this.ui.month());
    this.ui.filters.set({ ...EMPTY_FILTERS, type, from, to });
    this.router.navigate(['/transactions']);
  }
}
