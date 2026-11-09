import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { addMonths, dateLabel, daysUntil, monthKey, monthLabel, periodRange } from '../core/dates';
import { Recurring } from '../core/models';
import { Actions } from '../shared/actions.service';
import { TxList } from '../shared/bits';
import { BarChart, Legend } from '../shared/charts';
import { Icon } from '../shared/icon';
import { MoneyPipe } from '../shared/money.pipe';
import { ToastService } from '../shared/toast.service';
import { LedgerStore } from '../state/ledger.store';
import { UiState } from '../state/ui.state';

const ord = (d: number) => d + (d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th');
export const freqText = (r: Recurring) =>
  r.freq === 'weekly' ? 'Weekly' : r.freq === 'biweekly' ? 'Every 2 weeks' : r.freq === 'yearly' ? 'Yearly' : `Monthly on the ${ord(r.day || Number(r.nextDate.slice(8)))}`;

@Component({
  selector: 'app-income',
  imports: [Icon, MoneyPipe, BarChart, Legend, TxList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tiles three">
      <div class="tile"><span class="tile-k">Next pay date</span>
        @if (nextPay(); as n) {
          <span class="tile-v">{{ date(n.date) }}</span>
          <span class="delta flat">{{ n.r.name }} · {{ n.r.amount | money: n.r.currency }} · {{ n.days === 0 ? 'today' : 'in ' + n.days + ' day' + (n.days === 1 ? '' : 's') }}</span>
        } @else {
          <span class="tile-v">Not set</span><span class="delta flat">Add your salary as recurring income</span>
        }
      </div>
      <div class="tile"><span class="tile-k">Salary in {{ year() }}</span><span class="tile-v">{{ stats().ytd | money: P() }}</span><span class="delta flat">{{ stats().ytdCount }} payments recorded</span></div>
      <div class="tile"><span class="tile-k">Average pay month</span><span class="tile-v">{{ stats().avg | money: P() }}</span><span class="delta flat">across {{ stats().paid }} paid month{{ stats().paid === 1 ? '' : 's' }} of the last 12</span></div>
    </section>
    @if (due().length) {
      <section class="card"><div class="card-h"><h3>Due to record</h3></div>
        <ul class="sched">
          @for (d of due(); track d.r.id + d.date) {
            <li><span class="tx-ico" [class]="'tx-ico t-' + d.r.type"><app-icon [name]="d.r.type" /></span>
              <span class="tx-main"><b>{{ d.r.name }}</b><small>{{ date(d.date) }} · {{ fin().accName(d.r.accountId) }}</small></span>
              <b>{{ d.r.amount | money: d.r.currency }}</b>
              <span class="row-actions"><button class="btn sm primary" (click)="post(d.r.id, d.date)">Record</button><button class="btn sm ghost" (click)="store.advanceRecurring(d.r.id, d.date)">Skip</button></span></li>
          }
        </ul></section>
    }
    <div class="grid-2">
      <section class="card span-2">
        <div class="card-h"><h3>Income over 12 months</h3><span class="muted">in {{ P() }}, ending {{ endLabel() }}</span></div>
        <app-legend [series]="chart().series" />
        <app-bar-chart [labels]="chart().labels" [tipLabels]="chart().tips" [series]="chart().series" [currency]="P()" ariaLabel="Salary and other income over 12 months" />
      </section>
      <section class="card span-2">
        <div class="card-h"><h3>Recurring income & bills</h3><button class="btn sm primary" (click)="actions.recurring()"><app-icon name="plus" />Add recurring</button></div>
        @if (recurring().length) {
          <ul class="sched">
            @for (r of recurring(); track r.r.id) {
              <li [class.paused]="r.r.active === false">
                <span class="tx-ico" [class]="'tx-ico t-' + r.r.type"><app-icon [name]="r.r.type" /></span>
                <span class="tx-main"><b>{{ r.r.name }}@if (r.r.isSalary) { <span class="pill neutral">Salary</span>}@if (r.r.autoPost) { <span class="pill neutral">Auto-record</span>}</b>
                  <small>{{ freq(r.r) }} · {{ fin().accName(r.r.accountId) }} · {{ r.r.active === false ? 'Paused' : r.r.endDate && r.next > r.r.endDate ? 'Ended ' + date(r.r.endDate) : 'next ' + date(r.next) }}@if (r.r.endDate && r.next <= r.r.endDate) { · until {{ date(r.r.endDate) }}}</small></span>
                <b>{{ r.r.amount | money: r.r.currency }}@if (r.r.currency !== P()) {<small>≈ {{ fin().convert(r.r.amount, r.r.currency, P()) | money: P() }}</small>}</b>
                <button class="btn sm ghost icon-only" (click)="actions.recurring(r.r)" [attr.aria-label]="'Edit ' + r.r.name"><app-icon name="edit" /></button>
              </li>
            }
          </ul>
        } @else {
          <p class="empty-sm">Set up your salary with its pay day (for example, the 25th of each month in {{ P() }}). You'll get a reminder to record it, or it can be recorded automatically.</p>
        }
      </section>
      <section class="card span-2">
        <div class="card-h"><h3>Salary history</h3><span class="muted">original amount and {{ P() }} value</span></div>
        <app-tx-list [list]="salaryTx().slice(0, 24)" [grouped]="false" empty="No salary recorded yet. Record income in the Salary category, or add recurring salary above." (edit)="actions.editTx($event)" />
      </section>
    </div>`,
})
export default class Income {
  protected readonly store = inject(LedgerStore);
  protected readonly ui = inject(UiState);
  protected readonly actions = inject(Actions);
  private readonly toast = inject(ToastService);
  protected readonly P = this.store.primary;
  protected readonly fin = this.store.finance;
  protected readonly freq = freqText;
  protected readonly date = (d: string) => dateLabel(d, true);

  protected readonly year = computed(() => this.ui.month().slice(0, 4));
  protected readonly endLabel = computed(() => monthLabel(this.ui.month()));
  protected readonly due = computed(() => this.fin().dueRecurring());
  private readonly upcoming = computed(() => this.fin().upcomingRecurring(62));
  protected readonly nextPay = computed(() => {
    const u = this.upcoming();
    const n = u.find((x) => x.r.isSalary && x.r.type === 'income') ?? u.find((x) => x.r.type === 'income');
    return n ? { ...n, days: daysUntil(n.date) } : null;
  });
  protected readonly recurring = computed(() => this.store.planView().recurring.map((r) => ({ r, next: this.upcoming().find((u) => u.r.id === r.id)?.date ?? r.nextDate })));
  protected readonly salaryTx = computed(() => this.store.transactions().filter((t) => this.fin().isSalary(t)));
  private readonly months = computed(() => Array.from({ length: 12 }, (_, i) => addMonths(this.ui.month(), i - 11)));
  protected readonly chart = computed(() => {
    const f = this.fin(), months = this.months();
    const salary = months.map((m) => this.salaryTx().filter((t) => monthKey(t.date) === m).reduce((a, t) => a + (f.txValue(t) ?? 0), 0));
    const other = months.map((m) => f.txIn(...periodRange('month', m)).filter((t) => t.type === 'income' && !f.isSalary(t)).reduce((a, t) => a + (f.txValue(t) ?? 0), 0));
    return {
      labels: months.map((m) => monthLabel(m, 'short')), tips: months.map((m) => monthLabel(m)),
      series: [{ name: 'Salary', color: 'var(--s1)', values: salary }, { name: 'Other income', color: 'var(--s3)', values: other }],
    };
  });
  protected readonly stats = computed(() => {
    const f = this.fin(), y = this.year();
    const ytdList = this.salaryTx().filter((t) => t.date.startsWith(y));
    const per = this.chart().series[0].values.filter((v) => v > 0);
    return { ytd: ytdList.reduce((a, t) => a + (f.txValue(t) ?? 0), 0), ytdCount: ytdList.length, paid: per.length, avg: per.length ? per.reduce((a, b) => a + b, 0) / per.length : 0 };
  });

  protected post(id: string, date: string) {
    this.store.postRecurring(id, date);
    this.toast.show('Recorded.');
  }
}
