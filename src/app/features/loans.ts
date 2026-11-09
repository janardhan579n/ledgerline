import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { formatMoney, toNumber } from '../core/currency';
import { addMonths, dateLabel, monthLabel, todayISO } from '../core/dates';
import { LoanStatus, addMonthsToDate, loanKindLabel, loanStatus, loanTotalsByCurrency, prepay, schedule, scheduleByYear } from '../core/loans';
import { Debt } from '../core/models';
import { Actions } from '../shared/actions.service';
import { Progress } from '../shared/charts';
import { Icon } from '../shared/icon';
import { MoneyPipe } from '../shared/money.pipe';
import { LedgerStore } from '../state/ledger.store';

interface LoanView { d: Debt; s: LoanStatus }
interface Prepay { lump: string; extra: string; mode: 'tenure' | 'emi' }

@Component({
  selector: 'app-loans',
  imports: [Icon, MoneyPipe, Progress, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card-h page-h">
      <p class="muted">Enter each loan's EMI and how many EMIs are left to see what you still owe and how much of it is interest. Figures move forward on their own as each EMI date passes.</p>
      <div class="row-actions">
        <button class="btn" (click)="actions.debt()"><app-icon name="plus" />Other debt</button>
        <button class="btn primary" (click)="actions.loan()"><app-icon name="plus" />Add a loan (EMI)</button>
      </div>
    </section>

    @for (t of groups(); track t.currency) {
      <section class="loan-totals" [attr.aria-label]="t.currency + ' loans'">
        @if (groups().length > 1) {<h3 class="loan-cur-h">{{ t.currency }} loans <span class="muted small">{{ t.count }} loan{{ t.count === 1 ? '' : 's' }}</span></h3>}
        <div class="tiles four">
          <div class="tile"><span class="tile-k">Still to pay</span><span class="tile-v">{{ t.payable | money: t.currency }}</span><span class="delta flat">all remaining EMIs, principal + interest</span></div>
          <div class="tile"><span class="tile-k"><i style="background: var(--s1)"></i>Principal outstanding</span><span class="tile-v">{{ t.principal | money: t.currency }}</span>
            <span class="delta flat">@if (t.unknown) {<span>{{ t.unknown }} loan{{ t.unknown === 1 ? '' : 's' }} without a rate not included</span>} @else {<span>what you'd owe to close them today</span>}</span></div>
          <div class="tile"><span class="tile-k"><i style="background: var(--s2)"></i>Interest still to pay</span><span class="tile-v">{{ t.interest | money: t.currency }}</span>
            <span class="delta flat">@if (t.payable && !t.unknown) {<span>{{ pct(t.interest / t.payable) }}% of what's left</span>} @else {<span>for loans with a known rate</span>}</span></div>
          <div class="tile"><span class="tile-k">Monthly EMIs</span><span class="tile-v">{{ t.emi | money: t.currency }}</span>
            <span class="delta flat">due every month in {{ t.currency }}</span></div>
        </div>
      </section>
    }
    @if (burden() != null) {
      <p class="note small" [class.warn-text]="burden()! > 0.5">All EMIs together take about <b>{{ pct(burden()!) }}%</b> of your average monthly income (converted to {{ P() }} only for this comparison).</p>
    }

    @if (loans().length) {
      <div class="loan-grid">
        @for (x of loans(); track x.d.id) {
          <article class="card loan" [class.closed]="x.s.done">
            <div class="card-h">
              <div><h3>{{ x.d.name }}</h3><span class="muted small">{{ kind(x.d) }}@if (x.d.emi?.lender) { · {{ x.d.emi!.lender }}}</span></div>
              <button class="btn sm ghost icon-only" (click)="actions.loan(x.d)" [attr.aria-label]="'Edit ' + x.d.name"><app-icon name="edit" /></button>
            </div>
            @if (x.s.done) {
              <p><span class="pill good"><app-icon name="check" />Paid off</span> The last EMI was due {{ date(lastPaid(x)) }}. Delete it from Edit when you no longer need it.</p>
            } @else {
              <div class="goal-figs"><span class="big">{{ x.s.payable | money: x.d.currency }}</span><span class="muted">left to pay over {{ x.s.left }} EMI{{ x.s.left === 1 ? '' : 's' }}, until {{ month(x.s.lastDate!) }}</span></div>
              @if (x.s.outstanding != null) {
                <div class="split-bar" role="img" [attr.aria-label]="'Principal ' + money(x.s.outstanding, x.d.currency) + ', interest ' + money(x.s.interestLeft!, x.d.currency)">
                  <span [style.flex-grow]="x.s.outstanding" style="background: var(--s1)"></span><span [style.flex-grow]="x.s.interestLeft" style="background: var(--s2)"></span>
                </div>
                <div class="split-legend small">
                  <span><i style="background: var(--s1)"></i>Principal <b>{{ x.s.outstanding | money: x.d.currency }}</b></span>
                  <span><i style="background: var(--s2)"></i>Interest <b>{{ x.s.interestLeft | money: x.d.currency }}</b> ({{ pct(x.s.interestShare!) }}%)</span>
                </div>
              } @else {
                <p class="small muted">Add the interest rate or the outstanding amount to see how much of this is interest. <button class="link-btn" (click)="actions.loan(x.d)">Edit</button></p>
              }
              <dl class="kv">
                <div><dt>Monthly EMI</dt><dd>{{ x.s.emi | money: x.d.currency }}</dd></div>
                <div><dt>Next EMI</dt><dd>{{ date(x.s.nextDate!) }}</dd></div>
                <div><dt>Interest rate</dt><dd>{{ x.s.apr == null ? 'Not known' : rate(x.s.apr) + '% a year' }}@if (x.d.emi?.basis === 'outstanding' || x.d.emi?.basis === 'original') {<small class="muted"> worked out</small>}</dd></div>
                <div><dt>Next EMI split</dt><dd>@if (x.s.nextInterest != null) {{{ x.s.nextInterest | money: x.d.currency }} interest<br>{{ x.s.nextPrincipal | money: x.d.currency }} principal} @else {—}</dd></div>
              </dl>
              @if (x.s.life; as l) {
                <div class="loan-life">
                  <div class="ml-top small"><span>{{ l.emisPaid }} of {{ l.tenure }} EMIs paid</span><b>{{ pct(l.progress) }}%</b></div>
                  <app-progress [value]="l.progress" status="goal" />
                  <dl class="kv">
                    <div><dt>Borrowed</dt><dd>{{ l.original | money: x.d.currency }}</dd></div>
                    <div><dt>Principal repaid</dt><dd>{{ l.principalRepaid | money: x.d.currency }}</dd></div>
                    <div><dt>Interest paid so far</dt><dd>{{ l.interestPaid | money: x.d.currency }}</dd></div>
                    <div><dt>Total interest over the loan</dt><dd>{{ l.totalInterest | money: x.d.currency }}</dd></div>
                  </dl>
                </div>
              }
              @if (x.s.outstanding != null) {
                <div class="row-actions">
                  <button class="btn sm" [class.on]="panel()[x.d.id] === 'prepay'" (click)="toggle(x.d.id, 'prepay')" [attr.aria-expanded]="panel()[x.d.id] === 'prepay'">Prepayment what-if</button>
                  <button class="btn sm" [class.on]="panel()[x.d.id] === 'schedule'" (click)="toggle(x.d.id, 'schedule')" [attr.aria-expanded]="panel()[x.d.id] === 'schedule'">Repayment schedule</button>
                </div>
                @if (panel()[x.d.id] === 'prepay') {
                  <div class="loan-panel">
                    <div class="field-row">
                      <div class="field"><label [for]="'pl' + x.d.id">Pay once now</label><input [id]="'pl' + x.d.id" type="number" min="0" step="any" inputmode="decimal" [ngModel]="pp(x.d.id).lump" (ngModelChange)="setPp(x.d.id, { lump: $event })" placeholder="0"></div>
                      <div class="field"><label [for]="'pe' + x.d.id">Extra with every EMI</label><input [id]="'pe' + x.d.id" type="number" min="0" step="any" inputmode="decimal" [ngModel]="pp(x.d.id).extra" (ngModelChange)="setPp(x.d.id, { extra: $event })" placeholder="0"></div>
                    </div>
                    <div class="seg small" role="radiogroup" aria-label="After a one-time prepayment">
                      <button type="button" role="radio" [attr.aria-checked]="pp(x.d.id).mode === 'tenure'" (click)="setPp(x.d.id, { mode: 'tenure' })">Keep EMI, finish sooner</button>
                      <button type="button" role="radio" [attr.aria-checked]="pp(x.d.id).mode === 'emi'" (click)="setPp(x.d.id, { mode: 'emi' })">Keep end date, lower EMI</button>
                    </div>
                    @if (whatIf(x); as r) {
                      @if (r.closes) {<p class="whatif"><b>That closes the loan.</b> You'd skip {{ r.saved | money: x.d.currency }} of interest.</p>}
                      @else if (r.saved > 0) {
                        <p class="whatif">You'd save <b>{{ r.saved | money: x.d.currency }}</b> in interest.
                          @if (r.monthsSaved) { The loan would end {{ r.monthsSaved }} month{{ r.monthsSaved === 1 ? '' : 's' }} sooner, in {{ month(r.lastDate!) }}.}
                          @if (r.newEmi && r.newEmi < x.s.emi - 0.005) { Your EMI would drop to {{ r.newEmi | money: x.d.currency }}.}</p>
                      } @else {<p class="small muted">Enter an amount to see the effect.</p>}
                    }
                    <p class="small muted">Banks may charge a prepayment fee, and some apply prepayments only on certain dates. Check with your lender.</p>
                  </div>
                }
                @if (panel()[x.d.id] === 'schedule') {
                  <div class="loan-panel">
                    <div class="table-wrap"><table class="data">
                      <thead><tr><th>Year</th><th class="num">EMIs</th><th class="num">Interest</th><th class="num">Principal</th><th class="num">Owed at end</th></tr></thead>
                      <tbody>@for (y of years(x); track y.year) {
                        <tr><th>{{ y.year }}</th><td class="num">{{ y.emis }}</td><td class="num">{{ y.interest | money: x.d.currency }}</td><td class="num">{{ y.principal | money: x.d.currency }}</td><td class="num">{{ y.balance | money: x.d.currency }}</td></tr>
                      }</tbody>
                    </table></div>
                    <p class="small muted">Early EMIs are mostly interest; later ones mostly principal.</p>
                  </div>
                }
              }
            }
          </article>
        }
      </div>
    } @else {
      <div class="card empty">
        <h3>Track your loans and EMIs</h3>
        <p>Add a home, car, personal or education loan with its monthly EMI and how many EMIs are left. You'll see the total still to pay, how much of it is interest, when it ends, and what prepaying would save.</p>
        <div class="row-actions"><button class="btn primary" (click)="actions.loan()"><app-icon name="plus" />Add a loan (EMI)</button></div>
      </div>
    }

    @if (others().length) {
      <section class="card">
        <div class="card-h"><h3>Other debts</h3><span class="muted small">Credit card balances and debts without a fixed EMI</span></div>
        <ul class="acc-list">
          @for (d of others(); track d.id) {
            <li><span>{{ d.name }} <small class="muted">{{ d.apr }}% a year · min {{ d.minPayment | money: d.currency }}/mo</small></span>
              <span><b>{{ d.balance | money: d.currency }}</b> <button class="btn sm ghost icon-only" (click)="actions.debt(d)" [attr.aria-label]="'Edit ' + d.name"><app-icon name="edit" /></button></span></li>
          }
        </ul>
      </section>
    }
    <p class="note small muted">Worked out on a reducing balance with a fixed rate and every EMI paid on its date. Floating-rate loans, fees, insurance added to the loan and missed EMIs make real figures differ. For understanding only, not financial advice.</p>
  `,
})
export default class Loans {
  protected readonly store = inject(LedgerStore);
  protected readonly actions = inject(Actions);
  protected readonly P = this.store.primary;
  private readonly today = todayISO();
  protected readonly panel = signal<Record<string, 'prepay' | 'schedule' | undefined>>({});
  private readonly prepays = signal<Record<string, Prepay>>({});

  protected readonly loans = computed<LoanView[]>(() =>
    this.store.planView().debts.filter((d) => d.emi)
      .map((d) => ({ d, s: loanStatus(d, this.today)! }))
      .sort((a, b) => Number(a.s.done) - Number(b.s.done) || b.s.payable - a.s.payable));
  protected readonly active = computed(() => this.loans().filter((x) => !x.s.done));
  protected readonly others = computed(() => this.store.planView().debts.filter((d) => !d.emi));

  /** Separate totals for each loan currency (INR, MYR, ...), never mixed. */
  protected readonly groups = computed(() => loanTotalsByCurrency(this.store.planView().debts, this.today));
  /** All EMIs as a share of average income over the last three complete months, in the main currency. */
  protected readonly burden = computed(() => {
    const f = this.store.finance();
    const cm = this.today.slice(0, 7);
    const inc = [1, 2, 3].map((i) => f.monthSummary(addMonths(cm, -i)).income).filter((v) => v > 0);
    if (!inc.length || !this.groups().length) return null;
    let emi = 0;
    for (const g of this.groups()) {
      const v = f.convert(g.emi, g.currency, f.primary);
      if (v == null) return null;
      emi += v;
    }
    return emi / (inc.reduce((a, b) => a + b, 0) / inc.length);
  });

  protected kind(d: Debt) { return loanKindLabel(d.emi?.kind); }
  protected pct(v: number) { return Math.round(v * 100); }
  protected rate(v: number) { return +v.toFixed(2); }
  protected date(d: string) { return dateLabel(d, true); }
  protected month(d: string) { return monthLabel(d.slice(0, 7)); }
  protected money(v: number, c: string) { return formatMoney(v, c); }
  protected lastPaid(x: LoanView) { const e = x.d.emi!; return addMonthsToDate(e.nextDate, e.monthsLeft - 1, e.day); }

  protected toggle(id: string, p: 'prepay' | 'schedule') { this.panel.update((m) => ({ ...m, [id]: m[id] === p ? undefined : p })); }
  protected pp(id: string): Prepay { return this.prepays()[id] ?? { lump: '', extra: '', mode: 'tenure' }; }
  protected setPp(id: string, patch: Partial<Prepay>) { this.prepays.update((m) => ({ ...m, [id]: { ...this.pp(id), ...patch } })); }
  protected whatIf(x: LoanView) {
    const p = this.pp(x.d.id);
    return prepay(x.s, toNumber(String(p.lump ?? '')), toNumber(String(p.extra ?? '')), p.mode, x.d.emi?.day);
  }
  protected years(x: LoanView) {
    return scheduleByYear(schedule(x.s.outstanding!, x.s.apr!, x.s.emi, x.s.nextDate!, x.d.emi?.day));
  }
}
