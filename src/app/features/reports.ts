import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { addMonths, monthLabel } from '../core/dates';
import { CatCompare } from '../core/finance';
import { BarChart, Legend } from '../shared/charts';
import { ExportService, periodName } from '../shared/export.service';
import { Icon } from '../shared/icon';
import { MoneyPipe } from '../shared/money.pipe';
import { LedgerStore } from '../state/ledger.store';
import { UiState } from '../state/ui.state';

@Component({
  selector: 'app-reports',
  imports: [BarChart, Legend, Icon, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="toolbar card report-bar">
      <div class="seg" role="tablist" aria-label="Report period">
        <button role="tab" [attr.aria-selected]="ui.reportKind() === 'month'" (click)="setKind('month')">Monthly</button>
        <button role="tab" [attr.aria-selected]="ui.reportKind() === 'year'" (click)="setKind('year')">Yearly</button>
      </div>
      <div class="period">
        <button class="btn sm ghost icon-only" (click)="step(-1)" aria-label="Previous period"><app-icon name="chevL" /></button>
        <b>{{ name() }}</b>
        <button class="btn sm ghost icon-only" (click)="step(1)" aria-label="Next period"><app-icon name="chevR" /></button>
      </div>
      <div class="row-actions">
        <button class="btn sm" (click)="exp.reportCSV(d())"><app-icon name="download" />CSV</button>
        <button class="btn sm primary" (click)="pdf()"><app-icon name="download" />PDF</button>
      </div>
    </section>
    <div class="grid-2">
      <section class="card">
        <div class="card-h"><h3>Summary</h3><span class="muted">vs {{ prevName() }}</span></div>
        <div class="table-wrap"><table class="data compare">
          <thead><tr><th></th><th class="num">{{ name() }}</th><th class="num">{{ prevName() }}</th><th class="num">Change</th></tr></thead>
          <tbody>
            @for (r of summary(); track r.label) {
              <tr><th scope="row">{{ r.label }}</th><td class="num"><b>{{ r.cur | money: P() }}</b></td><td class="num muted">{{ r.prev | money: P() }}</td>
                <td class="num" [class.good-t]="r.cls === 'good'" [class.bad-t]="r.cls === 'bad'">{{ r.change }}</td></tr>
            }
            <tr><th scope="row">Savings rate</th><td class="num"><b>{{ rate(d().cur.savingsRate) }}</b></td><td class="num muted">{{ rate(d().prev.savingsRate) }}</td><td></td></tr>
          </tbody></table></div>
        <p class="muted small">Savings rate is income minus spending, divided by income. {{ d().list.length }} transactions in this period.</p>
      </section>
      <section class="card">
        <div class="card-h"><h3>{{ ui.reportKind() === 'year' ? 'Month by month' : 'Last six months' }}</h3><span class="muted">in {{ P() }}</span></div>
        <app-legend [series]="trend().series" />
        <app-bar-chart [labels]="trend().labels" [tipLabels]="trend().tips" [series]="trend().series" [currency]="P()" [highlight]="ui.reportKind() === 'month' ? 5 : null" ariaLabel="Income and spending by month" />
      </section>
      @for (t of tables(); track t.title) {
        <section class="card" [class.span-2]="$first">
          <div class="card-h"><h3>{{ t.title }}</h3><span class="muted">total {{ t.total | money: P() }}</span></div>
          @if (t.rows.length) {
            <div class="table-wrap"><table class="data">
              <thead><tr><th>Category</th><th class="num">{{ shortName() }}</th><th class="num">{{ shortPrev() }}</th><th class="num">Change</th><th class="share">Share</th></tr></thead>
              <tbody>
                @for (c of t.rows; track c.id) {
                  <tr><td>{{ c.name }}</td><td class="num">{{ c.cur | money: P() }}</td><td class="num muted">{{ c.prev | money: P() }}</td>
                    <td class="num" [class.up]="c.cur - c.prev > 0.005" [class.down]="c.cur - c.prev < -0.005">{{ change(c) }}@if (changePct(c); as p) {<small>{{ p }}</small>}</td>
                    <td class="share"><span class="bar-cell"><i [style.width.%]="t.total ? max1(c.cur / t.total * 100) : 0" [style.background]="t.color"></i></span><small>{{ t.total ? round(c.cur / t.total * 100) : 0 }}%</small></td></tr>
                }
              </tbody></table></div>
          } @else {<p class="empty-sm">Nothing recorded.</p>}
        </section>
      }
    </div>`,
})
export default class Reports {
  protected readonly store = inject(LedgerStore);
  protected readonly ui = inject(UiState);
  protected readonly exp = inject(ExportService);
  protected readonly P = this.store.primary;
  protected readonly round = Math.round;
  protected readonly max1 = (v: number) => Math.max(1, v);

  private readonly key = computed(() => (this.ui.reportKind() === 'year' ? this.ui.reportYear() : this.ui.month()));
  protected readonly d = computed(() => this.store.finance().reportData(this.ui.reportKind(), this.key()));
  protected readonly name = computed(() => periodName(this.ui.reportKind(), this.key()));
  protected readonly prevName = computed(() => periodName(this.ui.reportKind(), this.d().prevKey));
  protected readonly shortName = computed(() => (this.ui.reportKind() === 'year' ? this.key() : monthLabel(this.key(), 'shortY')));
  protected readonly shortPrev = computed(() => (this.ui.reportKind() === 'year' ? this.d().prevKey : monthLabel(this.d().prevKey, 'shortY')));

  protected readonly summary = computed(() => {
    const d = this.d();
    return ([['Income', 'income', true], ['Spending', 'expense', false], ['Saved', 'savings', true], ['Invested', 'investment', true], ['Left over', 'net', true]] as const).map(([label, k, upGood]) => {
      const cur = d.cur[k], prev = d.prev[k], ch = cur - prev;
      const flat = Math.abs(ch) < 0.005;
      return { label, cur, prev, change: flat ? '—' : (ch > 0 ? '+' : '−') + this.fmt(Math.abs(ch)), cls: flat ? '' : (upGood ? ch >= 0 : ch <= 0) ? 'good' : 'bad' };
    });
  });
  protected readonly trend = computed(() => {
    const months = this.ui.reportKind() === 'year'
      ? Array.from({ length: 12 }, (_, i) => `${this.key()}-${String(i + 1).padStart(2, '0')}`)
      : [5, 4, 3, 2, 1, 0].map((i) => addMonths(this.key(), -i));
    const sums = months.map((m) => this.store.finance().monthSummary(m));
    return {
      labels: months.map((m) => monthLabel(m, 'short')), tips: months.map((m) => monthLabel(m)),
      series: [{ name: 'Income', color: 'var(--s1)', values: sums.map((s) => s.income) }, { name: 'Spending', color: 'var(--s2)', values: sums.map((s) => s.expense) }],
    };
  });
  protected readonly tables = computed(() => {
    const d = this.d();
    return [
      { title: 'Spending by category', rows: d.expenseCats, total: d.cur.expense, color: 'var(--s2)' },
      { title: 'Income by category', rows: d.incomeCats, total: d.cur.income, color: 'var(--s1)' },
      { title: 'Saved & invested', rows: d.savingCats, total: d.cur.savings + d.cur.investment, color: 'var(--s3)' },
    ];
  });

  private fmt(v: number) { return new Intl.NumberFormat(this.P() === 'INR' ? 'en-IN' : 'en-GB', { style: 'currency', currency: this.P(), currencyDisplay: 'narrowSymbol' }).format(v); }
  protected rate(r: number | null) { return r == null ? '—' : Math.round(r * 100) + '%'; }
  protected change(c: CatCompare) { const ch = c.cur - c.prev; return Math.abs(ch) < 0.005 ? '—' : (ch > 0 ? '+' : '−') + this.fmt(Math.abs(ch)); }
  protected changePct(c: CatCompare) { const ch = c.cur - c.prev; return c.prev && Math.abs(ch) >= 0.005 ? `${ch > 0 ? '+' : '−'}${Math.abs(Math.round((ch / c.prev) * 100))}%` : ''; }
  protected setKind(k: 'month' | 'year') {
    if (k === 'year') this.ui.reportYear.set(this.ui.month().slice(0, 4));
    this.ui.reportKind.set(k);
  }
  protected step(n: number) {
    if (this.ui.reportKind() === 'year') this.ui.reportYear.update((y) => String(Number(y) + n));
    else this.ui.month.update((m) => addMonths(m, n));
  }
  protected pdf() { void this.exp.reportPDF(this.d()); }
}
