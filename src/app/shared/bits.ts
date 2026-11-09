import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { dateLabel, weekday } from '../core/dates';
import { txSign } from '../core/finance';
import { Transaction } from '../core/models';
import { typeLabel } from '../core/defaults';
import { LedgerStore } from '../state/ledger.store';
import { Icon } from './icon';
import { MoneyPipe } from './money.pipe';

@Component({
  selector: 'app-status-pill',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (status()) {
      @case ('over') {<span class="pill critical"><app-icon name="alert" />Over</span>}
      @case ('near') {<span class="pill warning"><app-icon name="alert" />Close</span>}
      @default {<span class="pill good"><app-icon name="check" />On track</span>}
    }`,
})
export class StatusPill {
  readonly status = input.required<'ok' | 'near' | 'over'>();
}

@Component({
  selector: 'app-delta',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="delta" [class]="'delta ' + d().cls">{{ d().text }}</span>`,
})
export class Delta {
  readonly now = input.required<number>();
  readonly before = input.required<number>();
  readonly goodWhenUp = input(true);
  readonly suffix = input('vs last month');
  protected readonly d = computed(() => {
    const a = this.now(), b = this.before();
    if (!b) return { cls: 'flat', text: 'no prior data' };
    const c = (a - b) / Math.abs(b);
    if (Math.abs(c) < 0.005) return { cls: 'flat', text: 'same as last month' };
    const up = c > 0;
    return { cls: (this.goodWhenUp() ? up : !up) ? 'good' : 'bad', text: `${up ? '▲' : '▼'} ${Math.abs(c * 100).toFixed(0)}% ${this.suffix()}` };
  });
}

interface Group { date: string | null; label: string; items: Transaction[] }

@Component({
  selector: 'app-tx-list',
  imports: [Icon, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!list().length) {
      <div class="empty">{{ empty() }}</div>
    }
    @for (g of groups(); track g.label) {
      @if (g.date) {<h4 class="day-h">{{ g.label }}</h4>}
      <ul class="txs">
        @for (t of g.items; track t.id) {
          <li>
            <button class="tx" type="button" (click)="edit.emit(t)">
              <span class="tx-ico" [class]="'tx-ico t-' + t.type"><app-icon [name]="t.type" /></span>
              <span class="tx-main"><b>{{ title(t) }}@if (t.receiptId) {<app-icon name="clip" class="clip" />}</b><small>{{ sub(t) || '&nbsp;' }}</small></span>
              <span class="tx-amt">
                <b [class.pos]="sign(t) > 0" [class.neg]="sign(t) < 0">{{ sign(t) > 0 ? '+' : sign(t) < 0 ? '−' : '' }}{{ t.amount | money: t.currency }}</b>
                @if (t.currency !== fin().primary) {
                  @if (fin().txValue(t); as v) {<small>≈ {{ v | money: fin().primary }}</small>} @else {<small class="warn-text">rate needed</small>}
                }
                @if (received(t); as r) {<small>received {{ r.amount | money: r.cur }}</small>}
              </span>
            </button>
          </li>
        }
      </ul>
    }
  `,
})
export class TxList {
  private readonly store = inject(LedgerStore);
  readonly list = input.required<Transaction[]>();
  readonly grouped = input(true);
  readonly empty = input('No transactions yet.');
  readonly edit = output<Transaction>();
  protected readonly fin = this.store.finance;
  protected readonly sign = txSign;

  protected readonly groups = computed<Group[]>(() => {
    const list = this.list();
    if (!this.grouped()) return list.length ? [{ date: null, label: 'all', items: list }] : [];
    const out: Group[] = [];
    for (const t of list) {
      const last = out[out.length - 1];
      if (last && last.date === t.date) last.items.push(t);
      else out.push({ date: t.date, label: `${weekday(t.date)}, ${dateLabel(t.date)}`, items: [t] });
    }
    return out;
  });

  protected title(t: Transaction) {
    const f = this.fin();
    if (t.type === 'transfer') return `${f.accName(t.accountId)} → ${f.accName(t.toAccountId)}`;
    const g = f.goal(t.goalId);
    return g ? g.name : f.catName(t.categoryId);
  }
  protected sub(t: Transaction) {
    return [t.type === 'transfer' ? typeLabel(t.type) : this.fin().accName(t.accountId), t.notes].filter(Boolean).join(' · ');
  }
  protected received(t: Transaction) {
    const to = this.fin().account(t.toAccountId);
    return t.type === 'transfer' && t.toAmount && to && to.currency !== t.currency ? { amount: t.toAmount, cur: to.currency } : null;
  }
}
