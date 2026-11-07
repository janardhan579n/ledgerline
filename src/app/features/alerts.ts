import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatMoney } from '../core/currency';
import { dateLabel } from '../core/dates';
import { Icon } from '../shared/icon';
import { ToastService } from '../shared/toast.service';
import { LedgerStore } from '../state/ledger.store';

interface Alert {
  level: 'critical' | 'warning' | 'info';
  html: string;
  link?: { to: string; label: string };
  due?: { id: string; date: string };
}

/** Budget, scheduled-item and missing-rate alerts for a month. */
@Component({
  selector: 'app-alerts',
  imports: [Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (alerts().length) {
      <section class="alerts" aria-label="Alerts">
        @for (a of alerts(); track $index) {
          <div class="alert" [class]="'alert ' + a.level">
            <app-icon [name]="a.level === 'info' ? 'clock' : 'alert'" />
            <p [innerHTML]="a.html"></p>
            <div class="alert-act">
              @if (a.link) {<a class="link" [routerLink]="a.link.to">{{ a.link.label }}</a>}
              @if (a.due; as d) {
                <button class="btn sm" (click)="post(d.id, d.date)">Record it</button>
                <button class="btn sm ghost" (click)="skip(d.id, d.date)">Skip</button>
              }
            </div>
          </div>
        }
      </section>
    }`,
})
export class Alerts {
  private readonly store = inject(LedgerStore);
  private readonly toast = inject(ToastService);
  readonly month = input.required<string>();
  readonly includeDue = input(true);

  protected readonly alerts = computed<Alert[]>(() => {
    const f = this.store.finance();
    const out: Alert[] = [];
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    for (const b of this.store.planView().budgets) {
      const u = f.budgetUsage(b, this.month());
      if (u.status === 'ok') continue;
      const name = esc(b.categoryId === '__all' ? 'Total spending' : f.catName(b.categoryId));
      out.push({
        level: u.status === 'over' ? 'critical' : 'warning',
        html: u.status === 'over'
          ? `<b>${name}</b> is over budget by ${formatMoney(-u.remaining, b.currency)} (${Math.round(u.pct * 100)}% of ${formatMoney(b.limit, b.currency)}).`
          : u.remaining <= 0.005 ? `<b>${name}</b> has reached its ${formatMoney(b.limit, b.currency)} budget for this month.` : `<b>${name}</b> has used ${Math.round(u.pct * 100)}% of its ${formatMoney(b.limit, b.currency)} budget. ${formatMoney(u.remaining, b.currency)} left.`,
        link: { to: '/budgets', label: 'Budgets' },
      });
    }
    if (this.includeDue()) {
      for (const d of f.dueRecurring().slice(0, 4))
        out.push({ level: 'info', html: `<b>${esc(d.r.name)}</b> was due ${dateLabel(d.date)}: ${formatMoney(d.r.amount, d.r.currency)}.`, due: { id: d.r.id, date: d.date } });
    }
    for (const c of f.usedCurrencies())
      if (f.unitValue(c) == null) out.push({ level: 'warning', html: `No exchange rate for <b>${c}</b>, so its amounts are left out of ${f.primary} totals.`, link: { to: '/setup', label: 'Set rate' } });
    return out;
  });

  protected post(id: string, date: string) {
    this.store.postRecurring(id, date);
    this.toast.show('Recorded.');
  }
  protected skip(id: string, date: string) {
    this.store.advanceRecurring(id, date);
    this.toast.show('Skipped.');
  }
}
