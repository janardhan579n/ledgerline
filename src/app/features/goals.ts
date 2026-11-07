import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { dateLabel } from '../core/dates';
import { Actions } from '../shared/actions.service';
import { Progress } from '../shared/charts';
import { Icon } from '../shared/icon';
import { MoneyPipe } from '../shared/money.pipe';
import { LedgerStore } from '../state/ledger.store';

@Component({
  selector: 'app-goals',
  imports: [Icon, MoneyPipe, Progress],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card-h page-h"><p class="muted">Money you move into a goal is recorded as a Savings transaction, so it shows up in reports and on the overview.</p>
      <button class="btn primary" (click)="actions.goal()"><app-icon name="plus" />New goal</button></section>
    @if (goals().length) {
      <div class="goal-grid">
        @for (x of goals(); track x.g.id) {
          <article class="card goal">
            <div class="card-h"><h3>{{ x.g.name }}@if (x.g.emergency) { <span class="pill neutral">Emergency fund</span>}</h3>
              <button class="btn sm ghost icon-only" (click)="actions.goal(x.g)" [attr.aria-label]="'Edit ' + x.g.name"><app-icon name="edit" /></button></div>
            <div class="goal-figs"><span class="big">{{ x.p.saved | money: x.g.currency }}</span><span class="muted">of {{ x.g.target | money: x.g.currency }}</span></div>
            <app-progress [value]="x.p.pct" [status]="x.p.pct >= 1 ? 'done' : 'goal'" />
            <dl class="kv">
              <div><dt>Progress</dt><dd>{{ round(x.p.pct * 100) }}%</dd></div>
              <div><dt>Still needed</dt><dd>{{ x.p.remaining | money: x.g.currency }}</dd></div>
              <div><dt>Target date</dt><dd>{{ x.g.targetDate ? date(x.g.targetDate) : 'None' }}</dd></div>
              <div><dt>Needed per month</dt><dd>{{ x.p.perMonth == null ? '—' : (x.p.perMonth | money: x.g.currency) }}</dd></div>
              <div><dt>Your pace (3 mo)</dt><dd>{{ x.p.pace | money: x.g.currency }}/mo</dd></div>
              <div><dt>Status</dt><dd>
                @if (x.p.pct >= 1) {<span class="pill good"><app-icon name="check" />Reached</span>}
                @else if (x.onTrack === null) {No deadline}
                @else if (x.onTrack) {<span class="pill good"><app-icon name="check" />On pace</span>}
                @else {<span class="pill warning"><app-icon name="alert" />Behind</span>}
              </dd></div>
            </dl>
            <div class="row-actions"><button class="btn sm primary" (click)="actions.goalMoney(x.g, false)">Add money</button><button class="btn sm" (click)="actions.goalMoney(x.g, true)">Take out</button></div>
          </article>
        }
      </div>
    } @else {
      <div class="card empty">No goals yet. A good first one is an emergency fund covering a few months of essential spending.</div>
    }`,
})
export default class Goals {
  protected readonly store = inject(LedgerStore);
  protected readonly actions = inject(Actions);
  protected readonly round = Math.round;
  protected readonly date = (d: string) => dateLabel(d, true);
  protected readonly goals = computed(() =>
    this.store.planView().goals.map((g) => {
      const p = this.store.finance().goalPlan(g);
      return { g, p, onTrack: p.perMonth == null ? null : p.pace >= p.perMonth * 0.95 || p.remaining === 0 };
    }));
}
