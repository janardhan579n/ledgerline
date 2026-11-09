import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { formatMoney, round2, toNumber } from '../core/currency';
import { dateLabel, todayISO } from '../core/dates';
import { uid } from '../core/defaults';
import { LOAN_KINDS, LoanBasis, addMonthsToDate, loanStatus, mainLoanCurrency, nextDueDate, presentValue, resolveRate } from '../core/loans';
import { Debt, EmiInfo, Recurring } from '../core/models';
import { confirmAction } from '../shared/confirm-dialog';
import { DialogService } from '../shared/dialog.service';
import { Modal } from '../shared/modal';
import { LedgerStore } from '../state/ledger.store';
import { activeAccounts, currencyChoices, ensureCurrency } from './form-helpers';

const BASES: ReadonlyArray<[LoanBasis, string]> = [['rate', 'Interest rate'], ['outstanding', 'Amount outstanding'], ['original', 'Original loan & tenure'], ['none', 'Not sure']];

@Component({
  selector: 'app-loan-form',
  imports: [Modal, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [heading]="isNew() ? 'Add a loan (EMI)' : 'Edit loan'" [wide]="true">
      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <div class="modal-body">
          <div class="field-row three">
            <div class="field"><label for="lf-name">Name</label><input id="lf-name" type="text" formControlName="name" maxlength="60" placeholder="e.g. Home loan, Car loan" autofocus></div>
            <div class="field"><label for="lf-kind">Type</label><select id="lf-kind" formControlName="kind">@for (k of kinds; track k[0]) {<option [value]="k[0]">{{ k[1] }}</option>}</select></div>
            <div class="field"><label for="lf-lender">Lender <span class="muted">(optional)</span></label><input id="lf-lender" type="text" formControlName="lender" maxlength="60" placeholder="e.g. HDFC, Maybank"></div>
          </div>
          <div class="field-row three">
            <div class="field"><label for="lf-emi">Monthly EMI</label><input id="lf-emi" formControlName="emi" type="number" step="any" min="0" inputmode="decimal"></div>
            <div class="field"><label for="lf-cur">Currency</label><select id="lf-cur" formControlName="currency" (change)="onCurrency()">@for (c of currencies(); track c.code) {<option [value]="c.code">{{ c.label }}</option>}</select></div>
            <div class="field"><label for="lf-day">EMI date</label><div class="input-unit"><span>Day</span><input id="lf-day" formControlName="day" type="number" min="1" max="31" inputmode="numeric"><span>of each month</span></div></div>
          </div>
          <div class="field"><label for="lf-left">EMIs left</label><input id="lf-left" formControlName="monthsLeft" type="number" min="1" max="600" inputmode="numeric" class="short-input">
            <small>Count the next one, due {{ nextLabel() }}.@if (preview().last) { The last EMI would be {{ preview().last }}.}</small></div>

          <div class="field"><span class="lbl">What else do you know about it?</span>
            <div class="seg small" role="radiogroup" aria-label="What you know">
              @for (b of bases; track b[0]) {<button type="button" role="radio" [attr.aria-checked]="basis() === b[0]" (click)="setBasis(b[0])">{{ b[1] }}</button>}
            </div>
          </div>
          @switch (basis()) {
            @case ('rate') {
              <div class="field"><label for="lf-apr">Interest rate</label><div class="input-unit short"><input id="lf-apr" formControlName="apr" type="number" step="any" min="0" inputmode="decimal"><span>% a year</span></div>
                <small>From your sanction letter or loan statement. For floating-rate loans, use today's rate.</small></div>
            }
            @case ('outstanding') {
              <div class="field"><label for="lf-out">Principal outstanding now</label><input id="lf-out" formControlName="outstanding" type="number" step="any" min="0" inputmode="decimal" class="short-input">
                <small>From your latest loan statement or banking app, after the last EMI. The interest rate is worked out from this.</small></div>
            }
            @case ('original') {
              <p class="small muted">The interest rate is worked out from the original amount, the EMI and the total number of EMIs.</p>
            }
            @default {
              <p class="small muted">You'll see the total still to pay. Add the rate or outstanding amount later to see how much of it is interest.</p>
            }
          }
          <details class="adv" [open]="basis() === 'original' || hasLife()">
            <summary>{{ basis() === 'original' ? 'Original loan' : 'Original loan (optional, for progress and interest paid so far)' }}</summary>
            <div class="field-row">
              <div class="field"><label for="lf-orig">Loan amount taken</label><input id="lf-orig" formControlName="original" type="number" step="any" min="0" inputmode="decimal"></div>
              <div class="field"><label for="lf-ten">Total EMIs (tenure)</label><div class="input-unit"><input id="lf-ten" formControlName="tenure" type="number" min="1" max="600" inputmode="numeric"><span>months</span></div></div>
            </div>
          </details>

          @if (preview(); as p) {
            @if (p.error) {<p class="small warn-text">{{ p.error }}</p>}
            @else if (p.payable) {
              <dl class="kv loan-preview">
                <div><dt>Total still to pay</dt><dd>{{ p.payable }}</dd></div>
                <div><dt>Principal outstanding</dt><dd>{{ p.outstanding ?? '—' }}</dd></div>
                <div><dt>Interest still to pay</dt><dd>{{ p.interest ?? '—' }}</dd></div>
                <div><dt>Interest rate</dt><dd>{{ p.rate ?? '—' }}</dd></div>
              </dl>
            }
          }

          <div class="loan-sched">
            <label class="check"><input type="checkbox" formControlName="schedule"><span>Add the EMI to scheduled payments, so it shows in upcoming bills and stops after the last EMI</span></label>
            @if (form.controls.schedule.value) {
              <div class="field-row">
                <div class="field"><label for="lf-acc">Paid from</label><select id="lf-acc" formControlName="accountId">@for (a of accounts(); track a.id) {<option [value]="a.id">{{ a.name }} ({{ a.currency }})</option>}</select></div>
                <div class="field"><span class="lbl">Recording</span><label class="check"><input type="checkbox" formControlName="autoPost"><span>Record each EMI automatically as spending (Loan & card payments)</span></label></div>
              </div>
            }
          </div>
        </div>
        @if (error()) {<p class="form-error" role="alert">{{ error() }}</p>}
        <footer>
          @if (!isNew()) {<button type="button" class="btn ghost danger-text" (click)="remove()">Delete</button>}
          <span class="spacer"></span>
          <button type="button" class="btn ghost" (click)="dialog.close()">Cancel</button>
          <button type="submit" class="btn primary">Save</button>
        </footer>
      </form>
    </app-modal>`,
})
export class LoanForm implements OnInit {
  protected readonly dialog = inject(DialogService);
  private readonly store = inject(LedgerStore);
  private readonly fb = inject(NonNullableFormBuilder);
  readonly debt = input<Debt | null>(null);
  protected readonly isNew = computed(() => !this.debt());
  protected readonly error = signal('');
  protected readonly basis = signal<LoanBasis>('rate');
  protected readonly kinds = LOAN_KINDS;
  protected readonly bases = BASES;
  protected readonly currencies = computed(() => currencyChoices(this.store.settingsView()));
  protected readonly accounts = computed(() => activeAccounts(this.store.settingsView()));
  private readonly today = todayISO();

  protected readonly form = this.fb.group({
    name: '', kind: 'home', lender: '', emi: '', currency: 'MYR', day: '5', monthsLeft: '', apr: '', outstanding: '', original: '', tenure: '',
    schedule: true, accountId: '', autoPost: false,
  });
  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  private readonly day = computed(() => Math.min(31, Math.max(1, Math.round(toNumber(this.value().day ?? '5')) || 5)));
  private readonly nextDate = computed(() => nextDueDate(this.day(), this.today));
  protected readonly nextLabel = computed(() => (this.nextDate() === this.today ? 'today' : 'on ' + dateLabel(this.nextDate(), true)));
  protected readonly hasLife = computed(() => !!this.debt()?.emi?.original);

  private readonly input = computed(() => {
    const v = this.value();
    return {
      emi: toNumber(v.emi ?? ''), monthsLeft: Math.round(toNumber(v.monthsLeft ?? '')), basis: this.basis(),
      apr: v.apr === '' ? undefined : toNumber(v.apr ?? ''), outstanding: toNumber(v.outstanding ?? ''), original: toNumber(v.original ?? ''), tenure: Math.round(toNumber(v.tenure ?? '')),
    };
  });
  protected readonly preview = computed(() => {
    const i = this.input();
    const cur = this.value().currency ?? 'MYR';
    if (!(i.emi > 0) || !(i.monthsLeft > 0)) return { payable: '', last: '' } as Preview;
    const last = dateLabel(addMonthsToDate(this.nextDate(), i.monthsLeft - 1, this.day()), true);
    const { apr, error } = resolveRate(i);
    if (error && i.basis !== 'none') return { payable: '', last, error };
    const payable = i.emi * i.monthsLeft;
    const out = apr == null ? null : presentValue(i.emi, i.monthsLeft, apr);
    return {
      last, payable: formatMoney(payable, cur), outstanding: out == null ? null : formatMoney(out, cur),
      interest: out == null ? null : formatMoney(payable - out, cur),
      rate: apr == null ? null : `${+apr.toFixed(2)}% a year${i.basis === 'rate' ? '' : ' (worked out)'}`,
    } as Preview;
  });

  ngOnInit() {
    const d = this.debt();
    const acc = this.accounts().find((a) => a.currency === this.store.primary()) ?? this.accounts()[0];
    if (!d?.emi) {
      // New loans start in the currency your loans use (e.g. INR), paid from an account in that currency.
      const cur = mainLoanCurrency(this.store.planView().debts, this.store.primary(), this.today);
      this.form.patchValue({ currency: cur, accountId: (this.accounts().find((a) => a.currency === cur) ?? acc)?.id ?? '' });
      return;
    }
    const e = d.emi;
    const s = loanStatus(d, this.today)!;
    const rec = this.store.planView().recurring.find((r) => r.id === e.recurringId);
    this.basis.set(e.basis);
    this.form.setValue({
      name: d.name, kind: e.kind ?? 'other', lender: e.lender ?? '', emi: String(e.amount), currency: d.currency, day: String(e.day),
      monthsLeft: String(s.left || ''), apr: e.basis === 'none' ? '' : String(+(+d.apr).toFixed(3)),
      outstanding: s.outstanding == null ? '' : String(s.outstanding), original: e.original ? String(e.original) : '', tenure: e.tenure ? String(e.tenure) : '',
      schedule: !!rec, accountId: rec?.accountId ?? e.accountId ?? acc?.id ?? '', autoPost: !!rec?.autoPost,
    });
  }

  /** Keep the "paid from" account in the loan's currency when there is one. */
  protected onCurrency() {
    const cur = this.form.controls.currency.value;
    const now = this.accounts().find((a) => a.id === this.form.controls.accountId.value);
    if (now?.currency === cur) return;
    const match = this.accounts().find((a) => a.currency === cur);
    if (match) this.form.patchValue({ accountId: match.id });
  }

  protected setBasis(b: LoanBasis) { this.basis.set(b); this.error.set(''); }

  protected save() {
    const v = this.form.getRawValue();
    const i = this.input();
    if (!v.name.trim()) return this.error.set('Name the loan.');
    if (!(i.emi > 0)) return this.error.set('Enter the monthly EMI.');
    if (!(i.monthsLeft > 0) || i.monthsLeft > 600) return this.error.set('Enter how many EMIs are left (1 to 600).');
    const { apr, error } = resolveRate(i);
    if (error) return this.error.set(error);
    if (v.schedule && !v.accountId) return this.error.set('Choose the account the EMI is paid from.');

    const prev = this.debt();
    const id = prev?.id ?? uid();
    const nextDate = this.nextDate();
    const day = this.day();
    const lastDate = addMonthsToDate(nextDate, i.monthsLeft - 1, day);
    const recurringId = v.schedule ? prev?.emi?.recurringId ?? uid() : undefined;
    const emi: EmiInfo = {
      amount: round2(i.emi), monthsLeft: i.monthsLeft, nextDate, day, basis: this.basis(), kind: v.kind as EmiInfo['kind'],
      ...(v.lender.trim() ? { lender: v.lender.trim() } : {}),
      ...(i.original > 0 && i.tenure > 0 ? { original: round2(i.original), tenure: i.tenure } : {}),
      ...(v.schedule ? { accountId: v.accountId, recurringId } : {}),
    };
    const debt: Debt = {
      id, name: v.name.trim(), currency: v.currency, minPayment: emi.amount, emi,
      apr: apr ?? 0, balance: round2(apr == null ? i.emi * i.monthsLeft : presentValue(i.emi, i.monthsLeft, apr)),
    };
    const s = this.store.settingsView();
    const cat = s.categories.find((c) => c.kind === 'expense' && /loan/i.test(c.name)) ?? s.categories.find((c) => c.kind === 'expense' && /^other/i.test(c.name));
    const rec: Recurring | null = v.schedule ? {
      id: recurringId!, name: `${debt.name} EMI`, type: 'expense', amount: emi.amount, currency: debt.currency, accountId: v.accountId, categoryId: cat?.id ?? null,
      freq: 'monthly', day, nextDate, endDate: lastDate, autoPost: v.autoPost, active: true, debtId: id,
    } : null;

    if (!s.currencies.includes(debt.currency)) this.store.saveSettings((x) => ensureCurrency(x, debt.currency));
    this.store.savePlan((p) => {
      const at = p.debts.findIndex((x) => x.id === id);
      if (at >= 0) p.debts[at] = debt; else p.debts.push(debt);
      const oldRec = prev?.emi?.recurringId;
      p.recurring = p.recurring.filter((r) => r.id !== oldRec || (rec && r.id === rec.id));
      if (rec) {
        const ri = p.recurring.findIndex((r) => r.id === rec.id);
        if (ri >= 0) p.recurring[ri] = { ...p.recurring[ri], ...rec }; else p.recurring.push(rec);
      }
    });
    if (rec?.autoPost) setTimeout(() => this.store.autoPostRecurring(), 50);
    this.dialog.close(debt);
  }

  protected async remove() {
    const d = this.debt()!;
    const linked = d.emi?.recurringId;
    if (await confirmAction(this.dialog, `Delete the loan "${d.name}"?${linked ? ' Its scheduled EMI payment is removed too. EMIs already recorded stay in your history.' : ''}`, 'Delete loan'))
      this.store.savePlan((p) => { p.debts = p.debts.filter((x) => x.id !== d.id); p.recurring = p.recurring.filter((r) => r.id !== linked); });
  }
}

interface Preview { payable: string; last: string; outstanding?: string | null; interest?: string | null; rate?: string | null; error?: string }
