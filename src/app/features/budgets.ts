import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { currentMonth, daysInMonth, monthLabel } from '../core/dates';
import { Actions } from '../shared/actions.service';
import { StatusPill } from '../shared/bits';
import { Progress } from '../shared/charts';
import { Icon } from '../shared/icon';
import { MoneyPipe } from '../shared/money.pipe';
import { LedgerStore } from '../state/ledger.store';
import { UiState } from '../state/ui.state';
import { Alerts } from './alerts';

@Component({
  selector: 'app-budgets',
  imports: [Alerts, Icon, MoneyPipe, Progress, StatusPill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-alerts [month]="ui.month()" [includeDue]="false" />
    <section class="card">
      <div class="card-h"><h3>Monthly budgets · {{ label() }}</h3><button class="btn sm primary" (click)="actions.budget()"><app-icon name="plus" />Add budget</button></div>
      @if (isCurrent()) {<p class="muted small">{{ round(dayFrac() * 100) }}% of the month has passed. The dark tick on each bar marks where spending would be if it were even across the month; the yellow tick is your alert level.</p>}
      @if (rows().length) {
        <ul class="budget-list">
          @for (r of rows(); track r.b.id) {
            <li>
              <div class="bl-top"><b>{{ r.name }}</b><app-status-pill [status]="r.u.status" />
                <button class="btn sm ghost icon-only" (click)="actions.budget(r.b)" aria-label="Edit budget"><app-icon name="edit" /></button></div>
              <div class="prog-wrap"><app-progress [value]="r.u.pct" [status]="r.u.status" />
                @if (isCurrent()) {<i class="pace" [style.left.%]="dayFrac() * 100"></i>}
                <i class="threshold" [style.left.%]="r.b.alertPct || 80"></i></div>
              <div class="bl-nums"><span>{{ r.u.spent | money: r.b.currency }} spent of {{ r.b.limit | money: r.b.currency }}</span>
                @if (r.u.remaining >= 0) {<span>{{ r.u.remaining | money: r.b.currency }} left</span>} @else {<span class="neg">{{ -r.u.remaining | money: r.b.currency }} over</span>}</div>
              <small class="muted">Alert at {{ r.b.alertPct || 80 }}%@if (r.b.currency !== P()) { · tracked in {{ r.b.currency }}}</small>
            </li>
          }
        </ul>
      } @else {
        <p class="empty-sm">No budgets yet. Pick a category (or total spending), set a monthly limit, and choose when to be warned.</p>
      }
    </section>
    <section class="card">
      <div class="card-h"><h3>Spending without a budget</h3><span class="muted">{{ label() }}</span></div>
      @if (unbudgeted().length) {
        <ul class="acc-list">@for (c of unbudgeted(); track c.id) {<li><span>{{ c.name }}</span><span><b>{{ c.value | money: P() }}</b> <button class="btn sm ghost" (click)="actions.budget(null, c.id)">Set budget</button></span></li>}</ul>
      } @else {<p class="empty-sm">Every category you spent in this month has a budget.</p>}
    </section>`,
})
export default class Budgets {
  protected readonly store = inject(LedgerStore);
  protected readonly ui = inject(UiState);
  protected readonly actions = inject(Actions);
  protected readonly P = this.store.primary;
  protected readonly round = Math.round;
  protected readonly label = computed(() => monthLabel(this.ui.month()));
  protected readonly isCurrent = computed(() => this.ui.month() === currentMonth());
  protected readonly dayFrac = computed(() => { const [y, m] = this.ui.month().split('-').map(Number); return new Date().getDate() / daysInMonth(y, m); });
  protected readonly rows = computed(() => {
    const f = this.store.finance();
    return this.store.planView().budgets.map((b) => ({ b, u: f.budgetUsage(b, this.ui.month()), name: b.categoryId === '__all' ? 'Total spending' : f.catName(b.categoryId) }));
  });
  protected readonly unbudgeted = computed(() => {
    const f = this.store.finance();
    const has = new Set(this.store.planView().budgets.map((b) => b.categoryId));
    return f.catBreakdown(f.monthSummary(this.ui.month()), 'expense').filter((c) => !has.has(c.id));
  });
}
