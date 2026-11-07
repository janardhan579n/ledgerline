import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { formatMoney, round2, toNumber } from '../core/currency';
import { dateLabel, todayISO } from '../core/dates';
import { TX_TYPES, typeLabel, uid } from '../core/defaults';
import { Transaction, TxType } from '../core/models';
import { confirmAction } from '../shared/confirm-dialog';
import { DialogService } from '../shared/dialog.service';
import { Modal } from '../shared/modal';
import { ToastService } from '../shared/toast.service';
import { LedgerStore } from '../state/ledger.store';
import { activeAccounts, categoriesOf, currencyChoices, ensureCurrency } from './form-helpers';

@Component({
  selector: 'app-tx-form',
  imports: [Modal, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [heading]="isNew() ? 'Add transaction' : 'Edit transaction'">
      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <div class="modal-body">
          <div class="seg type-seg" role="radiogroup" aria-label="Type">
            @for (t of types; track t[0]) {
              <button type="button" role="radio" [attr.aria-checked]="type() === t[0]" [class]="'t-' + t[0]" (click)="setType(t[0])">{{ t[1] }}</button>
            }
          </div>
          <div class="amount-row">
            <div class="field"><label for="tf-amount">Amount</label><input id="tf-amount" formControlName="amount" type="number" inputmode="decimal" step="any" min="0" placeholder="0.00" autofocus></div>
            <div class="field"><label for="tf-currency">Currency</label>
              <select id="tf-currency" formControlName="currency" (change)="curTouched = true">@for (c of currencies(); track c.code) {<option [value]="c.code">{{ c.label }}</option>}</select></div>
          </div>
          @if (preview(); as p) {<p class="conv-preview" aria-live="polite" [class.warn-text]="p.warn">{{ p.text }}</p>}
          <div class="field-row">
            <div class="field"><label for="tf-date">Date</label><input id="tf-date" type="date" formControlName="date"></div>
            <div class="field"><label for="tf-category">Category</label>
              <select id="tf-category" formControlName="categoryId">@for (c of cats(); track c.id) {<option [value]="c.id">{{ c.name }}</option>}</select></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="tf-account">{{ accountLabel() }}</label>
              <select id="tf-account" formControlName="accountId" (change)="onAccount()">@for (a of accounts(); track a.id) {<option [value]="a.id">{{ a.name }} ({{ a.currency }})</option>}</select></div>
            @if (hasTo()) {
              <div class="field"><label for="tf-to">{{ toLabel() }}</label>
                <select id="tf-to" formControlName="toAccountId"><option value="">None</option>@for (a of accounts(); track a.id) {<option [value]="a.id">{{ a.name }} ({{ a.currency }})</option>}</select></div>
            }
          </div>
          @if (crossTo(); as to) {
            <div class="field"><label for="tf-toamount">Amount received in {{ to.currency }}</label>
              <input id="tf-toamount" formControlName="toAmount" type="number" inputmode="decimal" step="any" min="0">
              <small>{{ toHelp() }}</small></div>
          }
          @if (type() === 'savings' || type() === 'investment') {
            <div class="field-row">
              @if (type() === 'savings') {
                <div class="field"><label for="tf-goal">Savings goal</label>
                  <select id="tf-goal" formControlName="goalId"><option value="">No goal</option>@for (g of goals(); track g.id) {<option [value]="g.id">{{ g.name }}</option>}</select></div>
              }
              <div class="field"><span class="lbl">Direction</span>
                <div class="seg small" role="radiogroup" aria-label="Direction">
                  <button type="button" role="radio" [attr.aria-checked]="!out()" (click)="out.set(false)">Put money in</button>
                  <button type="button" role="radio" [attr.aria-checked]="out()" (click)="out.set(true)">Take money out</button>
                </div></div>
            </div>
          }
          <div class="field"><label for="tf-notes">Notes <small class="muted">(optional)</small></label>
            <input id="tf-notes" formControlName="notes" maxlength="200" placeholder="e.g. Tesco, rent for November, sent to Amma"></div>
          @if (value().currency !== primary()) {
            <details class="adv" [open]="!!value().fx">
              <summary>Exchange rate for this transaction</summary>
              <p class="muted small">Leave empty to use the current rate. Fill it in to lock the rate you actually got.</p>
              <div class="input-unit"><span>1 {{ value().currency }} =</span><input id="tf-fx" formControlName="fx" type="number" step="any" min="0" inputmode="decimal" aria-label="Exchange rate"><span>{{ primary() }}</span></div>
            </details>
          }
        </div>
        @if (error()) {<p class="form-error" role="alert">{{ error() }}</p>}
        <footer>
          @if (!isNew()) {<button type="button" class="btn ghost danger-text" (click)="remove()">Delete</button>}
          <span class="spacer"></span>
          <button type="button" class="btn ghost" (click)="dialog.close()">Cancel</button>
          <button type="submit" class="btn primary">Save</button>
        </footer>
      </form>
    </app-modal>
  `,
})
export class TxForm implements OnInit {
  protected readonly dialog = inject(DialogService);
  private readonly store = inject(LedgerStore);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(NonNullableFormBuilder);
  readonly tx = input<Transaction | null>(null);
  readonly preset = input<Partial<Transaction>>({});

  protected readonly types = TX_TYPES;
  protected readonly type = signal<TxType>('expense');
  protected readonly out = signal(false);
  protected readonly error = signal('');
  protected readonly primary = this.store.primary;
  protected curTouched = false;
  private id = uid();

  protected readonly form = this.fb.group({
    amount: '', currency: 'MYR', date: todayISO(), categoryId: '', accountId: '', toAccountId: '', toAmount: '', goalId: '', notes: '', fx: '',
  });
  protected readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected readonly isNew = computed(() => !this.tx());
  protected readonly settings = this.store.settingsView;
  protected readonly accounts = computed(() => activeAccounts(this.settings(), this.tx()?.accountId));
  protected readonly cats = computed(() => categoriesOf(this.settings(), this.type()));
  protected readonly goals = computed(() => this.store.planView().goals);
  protected readonly currencies = computed(() => currencyChoices(this.settings(), this.value().currency));
  protected readonly hasTo = computed(() => ['transfer', 'savings', 'investment'].includes(this.type()));
  protected readonly accountLabel = computed(() => ({ income: 'Paid into', expense: 'Paid from', transfer: 'From account' } as Record<string, string>)[this.type()] ?? (this.out() ? 'Back into account' : 'From account'));
  protected readonly toLabel = computed(() => (this.type() === 'transfer' ? 'To account' : this.type() === 'savings' ? 'Savings account (optional)' : 'Investment account (optional)'));
  protected readonly crossTo = computed(() => {
    if (!this.hasTo()) return null;
    const to = this.store.finance().account(this.value().toAccountId);
    return to && to.currency !== this.value().currency ? to : null;
  });
  protected readonly toHelp = computed(() => {
    const to = this.crossTo();
    if (!to) return '';
    const est = this.store.finance().convert(toNumber(this.value().amount), this.value().currency ?? '', to.currency);
    return est != null ? `At today's rate this is about ${formatMoney(est, to.currency)}. Enter what actually arrived to record the rate you got.` : '';
  });
  protected readonly preview = computed(() => {
    const v = this.value();
    const amt = toNumber(v.amount), cur = v.currency ?? this.primary(), P = this.primary();
    if (cur === P || !amt) return null;
    const fx = toNumber(v.fx);
    if (fx > 0) return { text: `≈ ${formatMoney(amt * fx, P)} at your rate 1 ${cur} = ${fx} ${P}`, warn: false };
    const conv = this.store.finance().convert(amt, cur, P);
    return conv == null
      ? { text: `No ${cur}→${P} rate yet. Add one in Setup, or enter a rate below.`, warn: true }
      : { text: `≈ ${formatMoney(conv, P)} at ${this.store.finance().rateText(cur, P)}`, warn: false };
  });

  ngOnInit() {
    const t = this.tx();
    const p = this.preset();
    const base: Partial<Transaction> = t ?? { type: 'expense', date: todayISO(), accountId: this.accounts()[0]?.id, ...p };
    this.curTouched = !!t || !!p.currency;
    if (t) this.id = t.id;
    this.type.set(base.type ?? 'expense');
    this.out.set(!!base.out);
    const acc = this.store.finance().account(base.accountId);
    this.form.setValue({
      amount: base.amount != null ? String(base.amount) : '',
      currency: base.currency ?? acc?.currency ?? this.primary(),
      date: base.date ?? todayISO(),
      categoryId: base.categoryId ?? this.cats()[0]?.id ?? '',
      accountId: base.accountId ?? '',
      toAccountId: base.toAccountId ?? '',
      toAmount: base.toAmount ? String(base.toAmount) : '',
      goalId: base.goalId ?? '',
      notes: base.notes ?? '',
      fx: base.fx && base.fx.base === this.primary() ? String(base.fx.rate) : '',
    });
  }

  protected setType(t: TxType) {
    this.type.set(t);
    this.form.patchValue({ categoryId: this.cats()[0]?.id ?? '' });
  }
  protected onAccount() {
    const a = this.store.finance().account(this.form.controls.accountId.value);
    if (a && !this.curTouched) this.form.patchValue({ currency: a.currency });
  }

  protected save() {
    const v = this.form.getRawValue();
    const amount = toNumber(v.amount);
    if (!(amount > 0)) return this.error.set('Enter an amount greater than zero.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return this.error.set('Choose a date.');
    const type = this.type();
    const prev = this.tx();
    const tx: Transaction = {
      id: this.id, type, amount: round2(amount), currency: v.currency, date: v.date, categoryId: v.categoryId || null, accountId: v.accountId,
      notes: v.notes.trim(), createdAt: prev?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    if (prev?.recurringId) tx.recurringId = prev.recurringId;
    if (prev?.importId) tx.importId = prev.importId;
    if (this.hasTo()) {
      tx.toAccountId = v.toAccountId || null;
      if (type === 'transfer') {
        if (!tx.toAccountId) return this.error.set('Choose the account the money went to.');
        if (tx.toAccountId === tx.accountId) return this.error.set('Choose two different accounts.');
      }
      if (this.crossTo() && toNumber(v.toAmount) > 0) tx.toAmount = round2(toNumber(v.toAmount));
      if (type !== 'transfer' && this.out()) tx.out = true;
      if (type === 'savings' && v.goalId) tx.goalId = v.goalId;
    }
    const fx = toNumber(v.fx);
    if (tx.currency !== this.primary() && fx > 0) tx.fx = { base: this.primary(), rate: fx };
    if (!this.settings().currencies.includes(tx.currency)) this.store.saveSettings((s) => ensureCurrency(s, tx.currency));
    this.store.saveTx(tx, prev?.date);
    this.toast.show(prev ? 'Updated.' : 'Saved.');
    this.dialog.close(tx);
  }

  protected async remove() {
    const t = this.tx();
    if (!t) return;
    const ok = await confirmAction(this.dialog, `Delete this ${typeLabel(t.type).toLowerCase()} of ${formatMoney(t.amount, t.currency)} on ${dateLabel(t.date, true)}?`, 'Delete');
    if (ok) { this.store.deleteTx(t); this.toast.show('Transaction deleted.'); }
  }
}
