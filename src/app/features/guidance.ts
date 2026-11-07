import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formatMoney } from '../core/currency';
import { dateLabel, monthLabel } from '../core/dates';
import { DEFAULT_ASSUMPTIONS } from '../core/defaults';
import { Guidance as G, computeGuidance, project } from '../core/guidance';
import { Assumptions } from '../core/models';
import { Actions } from '../shared/actions.service';
import { Legend, LineChart } from '../shared/charts';
import { Icon } from '../shared/icon';
import { MoneyPipe } from '../shared/money.pipe';
import { LedgerStore } from '../state/ledger.store';

type StepStatus = 'done' | 'now' | 'next' | 'skip' | 'warn';
interface Chip { label: string; key: keyof Assumptions | 'essential' }
interface Step { status: StepStatus; title: string; body: string[]; chips: Chip[]; kind?: 'debts' | 'emergency-goal' }

const EDU = [
  { t: 'High-yield savings & fixed deposits', d: 'Bank deposits that pay interest. Fixed deposits lock money for a set term at a set rate.', access: 'Savings: anytime. Fixed deposits: at term end, or early with lost interest.', risk: "Very low. Value doesn't swing, but inflation can outpace interest.", suits: 'Emergency funds and goals within 1–3 years.' },
  { t: 'Government & retirement schemes', d: 'Long-term savings schemes run or backed by government, often with tax benefits and withdrawal rules.', access: 'Limited. Usually locked until retirement or a set age, with some exceptions.', risk: 'Low to moderate, depending on the scheme.', suits: 'Retirement saving alongside employer contributions.' },
  { t: 'Bonds & bond funds', d: 'Loans to governments or companies that pay interest. Funds hold many bonds at once.', access: 'Funds: usually within days. Single bonds: sell on the market or hold to maturity.', risk: 'Low to moderate. Prices fall when interest rates rise.', suits: 'Medium-term goals and balancing out shares.' },
  { t: 'Index funds & ETFs', d: 'Funds that track a whole market index, so you own small pieces of many companies at a low fee.', access: 'Usually within days.', risk: 'High in the short term. Drops of 20–30% in a bad year have happened.', suits: "Money you won't need for 5+ years." },
  { t: 'Unit trusts & mutual funds', d: 'Professionally managed pooled funds. Many people invest a fixed amount monthly (an SIP in India).', access: 'Usually within days. Some carry exit fees.', risk: 'Varies with what the fund holds. Check its fees and fact sheet.', suits: 'Regular investing toward long-term goals.' },
  { t: 'Gold', d: "Physical gold, gold savings accounts or gold funds. Doesn't pay interest or dividends.", access: 'Usually easy to sell, with dealer spreads.', risk: 'Moderate to high. Can move sharply in either direction.', suits: 'A small part of a wider mix, not the whole plan.' },
];

const FIELDS: { key: keyof Assumptions; label: string; min: number; max: number; step: number; unit: string; help?: string }[] = [
  { key: 'lookbackMonths', label: 'Months to average', min: 1, max: 12, step: 1, unit: 'months', help: 'Full months before this one.' },
  { key: 'starterMonths', label: 'Starter buffer', min: 0, max: 6, step: 0.5, unit: 'months', help: 'Of essential spending.' },
  { key: 'emergencyMonths', label: 'Emergency fund target', min: 1, max: 24, step: 1, unit: 'months', help: 'Of essential spending.' },
  { key: 'highInterestApr', label: 'Treat debt as high-interest from', min: 0, max: 60, step: 0.5, unit: '% a year' },
  { key: 'expectedReturn', label: 'Assumed long-term return', min: 0, max: 15, step: 0.5, unit: '% a year', help: 'For the illustration only.' },
  { key: 'inflation', label: 'Assumed inflation', min: 0, max: 15, step: 0.5, unit: '% a year' },
  { key: 'horizonYears', label: 'Illustration length', min: 1, max: 40, step: 1, unit: 'years' },
  { key: 'fxShockPct', label: 'Exchange-rate move to test', min: 1, max: 30, step: 1, unit: '%' },
];

@Component({
  selector: 'app-guidance',
  imports: [Icon, MoneyPipe, LineChart, Legend],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="disclaimer" role="note"><app-icon name="alert" />
      <p><b>Educational guidance, not financial advice.</b> Suggestions come from the numbers you've recorded and the assumptions shown, which you can change. Nothing here recommends buying any product, and investment returns are not guaranteed. For decisions about your situation, speak to a licensed financial adviser.</p></aside>
    @if (g().basis === 'none') {
      <div class="card empty">Guidance needs at least one month of income and spending. Record your salary and a few weeks of spending, then come back.</div>
    } @else {
      <section class="tiles four">
        <div class="tile"><span class="tile-k">Average income</span><span class="tile-v">{{ g().avgIncome | money: P() }}</span><span class="delta flat">per month</span></div>
        <div class="tile"><span class="tile-k">Average spending</span><span class="tile-v">{{ g().avgSpend | money: P() }}</span><span class="delta flat">{{ g().avgEssential | money: P() }} essential</span></div>
        <div class="tile" [class.neg]="g().surplus < 0" [class.net]="g().surplus >= 0"><span class="tile-k">Monthly surplus</span><span class="tile-v">{{ g().surplus | money: P() }}</span><span class="delta flat">before savings & investing</span></div>
        <div class="tile"><span class="tile-k">Emergency cover</span><span class="tile-v">{{ cover() }} mo</span><span class="delta flat">target {{ a().emergencyMonths }} months</span></div>
      </section>
      <p class="muted small basis">Based on {{ basisText() }}, converted to {{ P() }}. Change the assumptions and every figure updates.</p>
    }
    <div class="guide-layout">
      <div class="guide-main">
        @if (g().basis !== 'none') {
          @if (split().length) {
            <section class="card"><div class="card-h"><h3>A suggested split of your {{ g().surplus | money: P() }} monthly surplus</h3></div>
              <div class="split-bar" role="img" aria-label="Suggested split">@for (x of split(); track x.label) {<span [style.flex]="x.value" [style.background]="x.color" [attr.title]="x.label"></span>}</div>
              <ul class="split-legend">@for (x of split(); track x.label) {<li><i [style.background]="x.color"></i>{{ x.label }}<b>{{ x.value | money: P() }}</b><small>{{ x.pct }}%</small></li>}</ul>
              <p class="muted small">Each step is filled before the next, in the order below. This is one common way to order priorities; your situation may call for a different order.</p>
            </section>
          }
          <ol class="steps">
            @for (s of steps(); track s.title; let i = $index) {
              <li class="card step" [class]="'card step st-' + s.status">
                <div class="step-h"><span class="step-n">{{ i + 1 }}</span><h3>{{ s.title }}</h3>
                  @switch (s.status) {
                    @case ('done') {<span class="pill good"><app-icon name="check" />Done</span>}
                    @case ('now') {<span class="pill accent">Focus now</span>}
                    @case ('warn') {<span class="pill warning"><app-icon name="alert" />Needs attention</span>}
                    @case ('skip') {<span class="pill neutral">Not needed</span>}
                    @default {<span class="pill neutral">Next</span>}
                  }</div>
                @for (p of s.body; track $index) {<p>{{ p }}</p>}
                @if (s.kind === 'emergency-goal' && !g().emergencyGoal) {<button class="btn sm" (click)="actions.goal(null, true, g().emergencyTarget)">Create an emergency fund goal</button>}
                @if (s.kind === 'debts') {
                  <div class="debts">
                    @if (g().debts.length) {
                      <ul class="acc-list">@for (d of g().debts; track d.id) {
                        <li><span>{{ d.name }} <small class="muted">{{ d.apr }}% a year · min {{ d.minPayment | money: d.currency }}/mo</small></span>
                          <span><b>{{ d.balance | money: d.currency }}</b> <button class="btn sm ghost icon-only" (click)="actions.debt(d)" [attr.aria-label]="'Edit ' + d.name"><app-icon name="edit" /></button></span></li>
                      }</ul>
                    }
                    <button class="btn sm" (click)="actions.debt()"><app-icon name="plus" />Add a debt</button>
                  </div>
                }
                @if (s.chips.length) {<div class="assume-row"><span class="muted small">Assumptions:</span>@for (c of s.chips; track c.label) {<button class="chip" (click)="focus(c.key)">{{ c.label }}</button>}</div>}
              </li>
            }
          </ol>
          @if (exposure().length) {
            <section class="card"><div class="card-h"><h3>Exchange-rate sensitivity</h3></div>
              @for (e of exposure(); track e) {<p>{{ e }}</p>}
              <p class="muted small">Keeping a buffer in the currency you spend in, or converting on a regular schedule rather than all at once, can smooth out rate swings.</p>
              <div class="assume-row"><button class="chip" (click)="focus('fxShockPct')">{{ a().fxShockPct }}% rate move</button></div></section>
          }
        }
        <section class="card edu" aria-labelledby="edu-h">
          <div class="card-h"><h3 id="edu-h">Learning about investment choices</h3><span class="pill neutral">Educational</span></div>
          <p class="muted">General descriptions to help you ask better questions. They are not recommendations and say nothing about which option suits you. Returns are never guaranteed, and you can lose money in market investments.</p>
          <div class="edu-grid">@for (e of edu; track e.t) {
            <article><h4>{{ e.t }}</h4><p>{{ e.d }}</p><dl><div><dt>Access to money</dt><dd>{{ e.access }}</dd></div><div><dt>Ups and downs</dt><dd>{{ e.risk }}</dd></div><div><dt>Usually suits</dt><dd>{{ e.suits }}</dd></div></dl></article>
          }</div>
          <p class="muted small">Malaysia has EPF (KWSP) and Private Retirement Schemes (PRS); India has PPF, NPS and bank fixed deposits. Contribution limits, tax treatment and eligibility depend on where you live and pay tax, and they change, so check official sources or a licensed adviser before acting.</p>
          @if (proj(); as p) {
            <div class="card-h sub"><h4>What {{ g().alloc.invest | money: P() }} a month could grow to (illustration)</h4></div>
            <app-legend [series]="p.series" />
            <app-line-chart [labels]="p.labels" [series]="p.series" [currency]="P()" ariaLabel="Illustrative growth of monthly contributions" />
            <p class="small">After {{ p.years }} years: {{ p.put | money: P() }} put in, an illustrative {{ p.final | money: P() }} at {{ a().expectedReturn }}% a year, or about {{ p.real | money: P() }} in today's money after {{ a().inflation }}% inflation. Real returns vary year to year and can be negative. This is arithmetic on your assumptions, not a forecast.</p>
          }
        </section>
      </div>
      <aside class="card assumptions" id="assumptions" aria-labelledby="as-h">
        <div class="card-h"><h3 id="as-h">Assumptions</h3><button class="btn sm ghost" (click)="reset()">Reset</button></div>
        @for (f of fields; track f.key) {
          <div class="field" [id]="'wrap-' + f.key"><label [for]="'as-' + f.key">{{ f.label }}</label>
            <div class="input-unit"><input [id]="'as-' + f.key" type="number" inputmode="decimal" [min]="f.min" [max]="f.max" [step]="f.step" [value]="a()[f.key]" (change)="setNum(f.key, $any($event.target).value, f.min, f.max)"><span>{{ f.unit }}</span></div>
            @if (f.help) {<small>{{ f.help }}</small>}</div>
        }
        <div class="field" id="wrap-emergencyGoalId"><label for="as-emergencyGoalId">Emergency fund goal</label>
          <select id="as-emergencyGoalId" (change)="setGoal($any($event.target).value)">
            <option value="" [selected]="!a().emergencyGoalId">{{ hasEmergencyFlag() ? 'Goal marked as emergency fund' : 'None yet' }}</option>
            @for (goal of goals(); track goal.id) {<option [value]="goal.id" [selected]="a().emergencyGoalId === goal.id">{{ goal.name }}</option>}
          </select></div>
        <div class="field" id="wrap-essential"><span class="lbl">Essential spending categories</span>
          <div class="check-grid">@for (c of expenseCats(); track c.id) {<label class="check"><input type="checkbox" [checked]="c.essential" (change)="toggleEssential(c.id, $any($event.target).checked)"><span>{{ c.name }}</span></label>}</div>
          <small>Used for emergency-fund targets.</small></div>
      </aside>
    </div>`,
})
export default class Guidance {
  private readonly store = inject(LedgerStore);
  protected readonly actions = inject(Actions);
  protected readonly P = this.store.primary;
  protected readonly edu = EDU;
  protected readonly fields = FIELDS;
  protected readonly a = computed(() => this.store.planView().assumptions);
  protected readonly g = computed<G>(() => computeGuidance(this.store.finance(), this.a()));
  protected readonly goals = computed(() => this.store.planView().goals);
  protected readonly hasEmergencyFlag = computed(() => this.goals().some((g) => g.emergency));
  protected readonly expenseCats = computed(() => this.store.settingsView().categories.filter((c) => c.kind === 'expense'));
  protected readonly cover = computed(() => (this.g().avgEssential ? (this.g().emergencySaved / this.g().avgEssential).toFixed(1) : '0'));
  protected readonly basisText = computed(() => {
    const g = this.g();
    if (g.basis === 'current') return 'this month so far (no full months yet)';
    return `the last ${g.months.length} full month${g.months.length > 1 ? 's' : ''} (${[...g.months].reverse().map((m) => monthLabel(m, 'short')).join(', ')})`;
  });
  protected readonly split = computed(() => {
    const g = this.g(), total = Math.max(0, g.surplus);
    if (!total) return [];
    return [
      { label: 'Starter buffer', value: g.alloc.starter, color: 'var(--s3)' },
      { label: 'High-interest debt', value: g.alloc.debt, color: 'var(--s2)' },
      { label: 'Emergency fund', value: g.alloc.full, color: 'var(--s1)' },
      { label: 'Dated goals', value: g.alloc.goals, color: 'var(--s5)' },
      { label: 'Long-term / investing', value: g.alloc.invest, color: 'var(--s4)' },
    ].filter((x) => x.value > 0.5).map((x) => ({ ...x, pct: Math.round((x.value / total) * 100) }));
  });

  protected readonly steps = computed<Step[]>(() => {
    const g = this.g(), a = g.a, m = (v: number) => formatMoney(v, this.P());
    const months = (gap: number, per: number) => { const n = Math.ceil(gap / per); return `${n} month${n === 1 ? '' : 's'}`; };
    const s: Step[] = [];
    if (g.surplus <= 0) {
      const disc = g.topDiscretionary;
      s.push({ status: 'warn', title: 'Spend less than you earn', chips: [{ label: `Average of ${a.lookbackMonths} months`, key: 'lookbackMonths' }, { label: 'Which categories are essential', key: 'essential' }],
        body: [`On average you spent ${m(g.avgSpend)} a month against ${m(g.avgIncome)} of income, a shortfall of ${m(-g.surplus)}. Until that closes there is nothing left to save.`,
          ...(disc.length ? [`Your largest non-essential categories were ${disc.map((d) => `${d.name} (${m(d.value)})`).join(', ')}. Cutting these by a tenth would free about ${m(disc.reduce((x, d) => x + d.value, 0) * 0.1)} a month.`] : [])] });
    }
    const plural = (n: number) => `${n} month${n === 1 ? '' : 's'}`;
    s.push({ status: g.starterGap <= 0 ? 'done' : g.surplus > 0 ? 'now' : 'next', title: `Build a starter buffer of ${plural(a.starterMonths)}`, kind: 'emergency-goal',
      chips: [{ label: `${a.starterMonths} month starter`, key: 'starterMonths' }, { label: 'Essential categories', key: 'essential' }, { label: g.emergencyGoal ? `Fund: ${g.emergencyGoal.name}` : 'Pick emergency goal', key: 'emergencyGoalId' }],
      body: g.starterGap <= 0 ? [`Your emergency savings (${m(g.emergencySaved)}) already cover ${plural(a.starterMonths)} of essential spending.`]
        : [`A small cash buffer stops a surprise bill from turning into card debt. Target: ${m(g.starterTarget)} (${a.starterMonths} × your essential spending of ${m(g.avgEssential)} a month). You have ${m(g.emergencySaved)}${g.emergencyGoal ? ` in "${g.emergencyGoal.name}"` : ''}.`,
          ...(g.alloc.starter > 0 ? [`Putting ${m(g.alloc.starter)} a month here fills it in about ${months(g.starterGap, g.alloc.starter)}.`] : [])] });
    s.push({ status: !g.debts.length ? 'skip' : g.highDebtTotal <= 0 ? 'done' : g.starterGap <= 0 && g.surplus > 0 ? 'now' : 'next', title: 'Pay down high-interest debt', kind: 'debts',
      chips: [{ label: `High interest = ${a.highInterestApr}%+`, key: 'highInterestApr' }],
      body: !g.debts.length ? ["You haven't listed any debts. If you carry a credit card balance or personal loan, add it below so it's counted."]
        : g.highDebtTotal <= 0 ? [`None of your debts charge ${a.highInterestApr}% a year or more. Keep paying them on schedule.`]
        : [`Debt at ${a.highInterestApr}%+ a year usually costs more than savings earn. Paying the highest rate first (the "avalanche" order) saves the most interest: ${g.highDebts.map((d) => `${d.name} at ${d.apr}% (${formatMoney(d.balance, d.currency)})`).join(', then ')}.`,
          ...(g.alloc.debt > 0 ? [`After the starter buffer, ${m(g.alloc.debt)} a month goes here on top of minimum payments, clearing ${m(g.highDebtTotal)} in about ${months(g.highDebtTotal, g.alloc.debt)} (before interest).`] : [])] });
    const efDone = g.emergencySaved >= g.emergencyTarget && g.emergencyTarget > 0;
    s.push({ status: efDone ? 'done' : g.alloc.full > 0 ? 'now' : 'next', title: `Grow the emergency fund to ${plural(a.emergencyMonths)}`,
      chips: [{ label: `${a.emergencyMonths} months target`, key: 'emergencyMonths' }],
      body: efDone ? [`You have ${m(g.emergencySaved)}, which covers ${plural(a.emergencyMonths)} of essential spending (${m(g.emergencyTarget)}).`]
        : [`Target: ${m(g.emergencyTarget)}. You have ${m(g.emergencySaved)}, about ${this.cover()} months. Many people keep 3–6 months; more if income is irregular or you support family.`,
          ...(g.alloc.full > 0 ? [`${m(g.alloc.full)} a month reaches it in about ${months(g.fullGap, g.alloc.full)}.`] : [])] });
    s.push({ status: !g.datedGoals.length ? 'skip' : g.alloc.goals >= g.goalNeed - 0.5 ? 'now' : g.alloc.goals > 0 ? 'warn' : 'next', title: 'Fund goals with deadlines', chips: [],
      body: !g.datedGoals.length ? ['No goals with a target date. Add a date to a goal to see what it needs each month.']
        : [`${g.datedGoals.map((x) => `${x.goal.name} needs ${formatMoney(x.plan.perMonth ?? 0, x.goal.currency)} a month until ${dateLabel(x.goal.targetDate, true)}`).join('; ')}. Together ${m(g.goalNeed)} a month.`,
          ...(g.alloc.goals < g.goalNeed - 0.5 ? [`Only ${m(g.alloc.goals)} is left for them after the steps above. Consider a later date or a smaller target.`] : [])] });
    s.push({ status: g.alloc.invest > 0 ? 'now' : 'next', title: "Learn about investing what's left",
      chips: [{ label: `Assumed return ${a.expectedReturn}%`, key: 'expectedReturn' }, { label: `${a.horizonYears}-year horizon`, key: 'horizonYears' }],
      body: [g.alloc.invest > 0 ? `About ${m(g.alloc.invest)} a month is left after the steps above. For money you won't need for 5+ years, it's worth learning how long-term options work. See the educational section below.`
        : 'Once the steps above are covered, any remaining surplus can go toward longer-term investing. See the educational section below.'] });
    return s;
  });

  protected readonly exposure = computed(() => {
    const g = this.g(), P = this.P(), shock = g.a.fxShockPct, m = (v: number) => formatMoney(v, P);
    return Object.entries(g.exposure).filter(([, v]) => Math.abs(v) > 0.5).map(([c, v]) => v > 0
      ? `You spend about ${m(v)} a month more in ${c} than you earn in it. If ${c} rose ${shock}% against ${P}, that spending would cost roughly ${m((v * shock) / 100)} more each month.`
      : `You earn about ${m(-v)} a month more in ${c} than you spend in it. A ${shock}% fall in ${c} against ${P} would cut that by roughly ${m((-v * shock) / 100)} a month.`);
  });

  protected readonly proj = computed(() => {
    const g = this.g(), a = g.a;
    if (!(g.alloc.invest > 0)) return null;
    const p = project(g.alloc.invest, a.expectedReturn, a.horizonYears, a.inflation);
    return {
      labels: p.labels, years: p.labels.length - 1, put: p.contributed[p.contributed.length - 1], final: p.finalValue, real: p.realValue,
      series: [{ name: 'Amount you put in', color: 'var(--s1)', values: p.contributed, area: true }, { name: `Value at an assumed ${a.expectedReturn}% a year`, color: 'var(--s4)', values: p.value }],
    };
  });

  protected setNum(key: keyof Assumptions, raw: string, min: number, max: number) {
    const v = Number(raw);
    if (raw === '' || Number.isNaN(v)) return;
    const c = Math.min(max, Math.max(min, v));
    if (this.a()[key] !== c) this.store.savePlan((p) => ((p.assumptions as unknown as Record<string, number>)[key] = c));
  }
  protected setGoal(id: string) { this.store.savePlan((p) => (p.assumptions.emergencyGoalId = id)); }
  protected toggleEssential(id: string, on: boolean) {
    this.store.saveSettings((s) => { const c = s.categories.find((x) => x.id === id); if (c) c.essential = on; });
  }
  protected reset() { this.store.savePlan((p) => (p.assumptions = { ...DEFAULT_ASSUMPTIONS, emergencyGoalId: p.assumptions.emergencyGoalId })); }
  protected focus(key: string) {
    const wrap = document.getElementById('wrap-' + key);
    if (!wrap) return;
    wrap.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    setTimeout(() => (wrap.querySelector('input,select') as HTMLElement | null)?.focus({ preventScroll: true }), 250);
    wrap.classList.add('flash');
    setTimeout(() => wrap.classList.remove('flash'), 1400);
  }
}
