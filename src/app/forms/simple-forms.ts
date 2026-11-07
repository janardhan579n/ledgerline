import { ChangeDetectionStrategy, Component, Directive, OnInit, computed, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { toNumber } from '../core/currency';
import { daysInMonth, todayISO } from '../core/dates';
import { ACCOUNT_TYPES, TX_TYPES, uid } from '../core/defaults';
import { nextOccurrence } from '../core/finance';
import { Account, Budget, Category, CategoryKind, Debt, Frequency, Goal, Recurring } from '../core/models';
import { confirmAction } from '../shared/confirm-dialog';
import { DialogService } from '../shared/dialog.service';
import { Modal } from '../shared/modal';
import { LedgerStore } from '../state/ledger.store';
import { activeAccounts, categoriesOf, currencyChoices, ensureCurrency } from './form-helpers';



@Directive()
abstract class FormBase {
  protected readonly dialog = inject(DialogService);
  protected readonly store = inject(LedgerStore);
  protected readonly fb = inject(NonNullableFormBuilder);
  protected readonly error = signal('');
  protected readonly settings = this.store.settingsView;
  protected readonly currencies = computed(() => currencyChoices(this.settings()));
}

/* ---------------- account ---------------- */
@Component({
  selector: 'app-account-form',
  imports: [Modal, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [heading]="isNew() ? 'Add account' : 'Edit account'">
      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <div class="modal-body">
          <div class="field"><label for="af-name">Name</label><input id="af-name" formControlName="name" maxlength="60" placeholder="e.g. Salary account, INR savings" autofocus></div>
          <div class="field-row">
            <div class="field"><label for="af-type">Type</label><select id="af-type" formControlName="type">@for (t of types; track t[0]) {<option [value]="t[0]">{{ t[1] }}</option>}</select></div>
            <div class="field"><label for="af-cur">Currency</label><select id="af-cur" formControlName="currency">@for (c of currencies(); track c.code) {<option [value]="c.code">{{ c.label }}</option>}</select></div>
          </div>
          <div class="field"><label for="af-open">Starting balance</label><input id="af-open" formControlName="opening" type="number" step="any" inputmode="decimal">
            <small>What's in the account before the first transaction you record. Use a negative number for a card balance you owe.</small></div>
          @if (!isNew()) {<label class="check"><input type="checkbox" formControlName="archived"><span>Archive (hide from lists, keep history)</span></label>}
        </div>
                @if (error()) {<p class="form-error" role="alert">{{ error() }}</p>}
        <footer>
          @if (!isNew()) {<button type="button" class="btn ghost danger-text" (click)="remove()">Delete account</button>}
          <span class="spacer"></span>
          <button type="button" class="btn ghost" (click)="dialog.close()">Cancel</button>
          <button type="submit" class="btn primary">Save</button>
        </footer>
      </form>
    </app-modal>`,
})
export class AccountForm extends FormBase implements OnInit {
  readonly account = input<Account | null>(null);
  protected readonly types = ACCOUNT_TYPES;
  protected readonly isNew = computed(() => !this.account());
  protected readonly form = this.fb.group({ name: '', type: 'bank', currency: 'MYR', opening: '0', archived: false });
  ngOnInit() {
    const a = this.account();
    this.form.setValue({ name: a?.name ?? '', type: a?.type ?? 'bank', currency: a?.currency ?? this.store.primary(), opening: String(a?.opening ?? 0), archived: !!a?.archived });
  }
  protected save() {
    const v = this.form.getRawValue();
    if (!v.name.trim()) return this.error.set('Give the account a name.');
    const acc: Account = { id: this.account()?.id ?? uid(), name: v.name.trim(), type: v.type as Account['type'], currency: v.currency, opening: toNumber(v.opening), ...(v.archived ? { archived: true } : {}) };
    this.store.saveSettings((s) => {
      ensureCurrency(s, acc.currency);
      const i = s.accounts.findIndex((x) => x.id === acc.id);
      if (i >= 0) s.accounts[i] = acc; else s.accounts.push(acc);
    });
    this.dialog.close(acc);
  }
  protected async remove() {
    const a = this.account()!;
    if (this.store.transactions().some((t) => t.accountId === a.id || t.toAccountId === a.id)) {
      return this.error.set('This account has transactions. Archive it instead to keep your history.');
    }
    if (await confirmAction(this.dialog, `Delete the account "${a.name}"?`, 'Delete')) this.store.saveSettings((s) => (s.accounts = s.accounts.filter((x) => x.id !== a.id)));
  }
}

/* ---------------- category ---------------- */
@Component({
  selector: 'app-category-form',
  imports: [Modal, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [heading]="isNew() ? 'Add category' : 'Edit category'">
      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <div class="modal-body">
          <div class="field"><label for="cf-name">Name</label><input id="cf-name" formControlName="name" maxlength="50" autofocus></div>
          <div class="field"><label for="cf-kind">Used for</label><select id="cf-kind" formControlName="kind">@for (t of types; track t[0]) {<option [value]="t[0]">{{ t[1] }}</option>}</select></div>
          <label class="check"><input type="checkbox" formControlName="essential"><span>Essential spending (counts toward emergency-fund targets)</span></label>
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
export class CategoryForm extends FormBase implements OnInit {
  readonly category = input<Category | null>(null);
  protected readonly types = TX_TYPES;
  protected readonly isNew = computed(() => !this.category());
  protected readonly form = this.fb.group({ name: '', kind: 'expense', essential: false });
  ngOnInit() {
    const c = this.category();
    if (c) this.form.setValue({ name: c.name, kind: c.kind, essential: !!c.essential });
  }
  protected save() {
    const v = this.form.getRawValue();
    if (!v.name.trim()) return this.error.set('Give the category a name.');
    const cat: Category = { id: this.category()?.id ?? uid(), name: v.name.trim(), kind: v.kind as CategoryKind, essential: v.essential };
    this.store.saveSettings((s) => { const i = s.categories.findIndex((x) => x.id === cat.id); if (i >= 0) s.categories[i] = cat; else s.categories.push(cat); });
    this.dialog.close(cat);
  }
  protected async remove() {
    const c = this.category()!;
    if (this.store.transactions().some((t) => t.categoryId === c.id)) return this.error.set('This category is used by transactions, so it stays. Rename it instead.');
    this.store.saveSettings((s) => (s.categories = s.categories.filter((x) => x.id !== c.id)));
    this.dialog.close();
  }
}

/* ---------------- budget ---------------- */
@Component({
  selector: 'app-budget-form',
  imports: [Modal, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [heading]="isNew() ? 'Add monthly budget' : 'Edit budget'">
      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <div class="modal-body">
          <div class="field"><label for="bf-cat">Category</label>
            <select id="bf-cat" formControlName="categoryId"><option value="__all">Total spending (all categories)</option>@for (c of cats(); track c.id) {<option [value]="c.id">{{ c.name }}</option>}</select></div>
          <div class="field-row">
            <div class="field"><label for="bf-limit">Monthly limit</label><input id="bf-limit" formControlName="limit" type="number" step="any" min="0" inputmode="decimal" autofocus></div>
            <div class="field"><label for="bf-cur">Currency</label><select id="bf-cur" formControlName="currency">@for (c of currencies(); track c.code) {<option [value]="c.code">{{ c.label }}</option>}</select>
              <small>Spending in other currencies is converted.</small></div>
          </div>
          <div class="field"><label for="bf-alert">Warn me at</label><div class="input-unit"><input id="bf-alert" formControlName="alertPct" type="number" min="10" max="100" step="5"><span>% of limit</span></div></div>
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
export class BudgetForm extends FormBase implements OnInit {
  readonly budget = input<Budget | null>(null);
  readonly presetCategory = input<string>('');
  protected readonly isNew = computed(() => !this.budget());
  protected readonly cats = computed(() => categoriesOf(this.settings(), 'expense'));
  protected readonly form = this.fb.group({ categoryId: '__all', limit: '', currency: 'MYR', alertPct: '80' });
  ngOnInit() {
    const b = this.budget();
    this.form.setValue({ categoryId: b?.categoryId ?? (this.presetCategory() || '__all'), limit: b ? String(b.limit) : '', currency: b?.currency ?? this.store.primary(), alertPct: String(b?.alertPct ?? 80) });
  }
  protected save() {
    const v = this.form.getRawValue();
    const limit = toNumber(v.limit);
    if (!(limit > 0)) return this.error.set('Enter a limit greater than zero.');
    const b: Budget = { id: this.budget()?.id ?? uid(), categoryId: v.categoryId, limit, currency: v.currency, alertPct: Math.min(100, Math.max(10, toNumber(v.alertPct) || 80)) };
    this.store.savePlan((p) => { const i = p.budgets.findIndex((x) => x.id === b.id); if (i >= 0) p.budgets[i] = b; else p.budgets.push(b); });
    this.dialog.close(b);
  }
  protected remove() {
    const id = this.budget()!.id;
    this.store.savePlan((p) => (p.budgets = p.budgets.filter((x) => x.id !== id)));
    this.dialog.close();
  }
}

/* ---------------- goal ---------------- */
@Component({
  selector: 'app-goal-form',
  imports: [Modal, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [heading]="isNew() ? 'New savings goal' : 'Edit goal'">
      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <div class="modal-body">
          <div class="field"><label for="gf-name">What are you saving for?</label><input id="gf-name" formControlName="name" maxlength="60" placeholder="e.g. Emergency fund, trip home, laptop" autofocus></div>
          <div class="field-row">
            <div class="field"><label for="gf-target">Target amount</label><input id="gf-target" formControlName="target" type="number" step="any" min="0" inputmode="decimal"></div>
            <div class="field"><label for="gf-cur">Currency</label><select id="gf-cur" formControlName="currency">@for (c of currencies(); track c.code) {<option [value]="c.code">{{ c.label }}</option>}</select></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="gf-date">Target date <small class="muted">(optional)</small></label><input id="gf-date" formControlName="targetDate" type="date"></div>
            <div class="field"><label for="gf-start">Already saved</label><input id="gf-start" formControlName="startAmount" type="number" step="any" inputmode="decimal"><small>Money set aside before you started tracking.</small></div>
          </div>
          <label class="check"><input type="checkbox" formControlName="emergency"><span>This is my emergency fund</span></label>
        </div>
                @if (error()) {<p class="form-error" role="alert">{{ error() }}</p>}
        <footer>
          @if (!isNew()) {<button type="button" class="btn ghost danger-text" (click)="remove()">Delete goal</button>}
          <span class="spacer"></span>
          <button type="button" class="btn ghost" (click)="dialog.close()">Cancel</button>
          <button type="submit" class="btn primary">Save</button>
        </footer>
      </form>
    </app-modal>`,
})
export class GoalForm extends FormBase implements OnInit {
  readonly goal = input<Goal | null>(null);
  readonly emergency = input(false);
  readonly suggestedTarget = input<number | null>(null);
  protected readonly isNew = computed(() => !this.goal());
  protected readonly form = this.fb.group({ name: '', target: '', currency: 'MYR', targetDate: '', startAmount: '0', emergency: false });
  ngOnInit() {
    const g = this.goal();
    this.form.setValue({
      name: g?.name ?? (this.emergency() ? 'Emergency fund' : ''),
      target: g ? String(g.target) : this.suggestedTarget() ? String(Math.round(this.suggestedTarget()!)) : '',
      currency: g?.currency ?? this.store.primary(), targetDate: g?.targetDate ?? '', startAmount: String(g?.startAmount ?? 0), emergency: g ? !!g.emergency : this.emergency(),
    });
  }
  protected save() {
    const v = this.form.getRawValue();
    if (!v.name.trim()) return this.error.set('Name the goal.');
    const target = toNumber(v.target);
    if (!(target > 0)) return this.error.set('Enter a target greater than zero.');
    const g: Goal = { id: this.goal()?.id ?? uid(), name: v.name.trim(), target, currency: v.currency, targetDate: v.targetDate, startAmount: toNumber(v.startAmount), emergency: v.emergency };
    this.store.savePlan((p) => {
      if (g.emergency) p.goals.forEach((x) => { if (x.id !== g.id) x.emergency = false; });
      const i = p.goals.findIndex((x) => x.id === g.id); if (i >= 0) p.goals[i] = g; else p.goals.push(g);
    });
    this.dialog.close(g);
  }
  protected async remove() {
    const g = this.goal()!;
    if (await confirmAction(this.dialog, `Delete the goal "${g.name}"? Savings transactions linked to it stay in your history.`, 'Delete goal'))
      this.store.savePlan((p) => { p.goals = p.goals.filter((x) => x.id !== g.id); if (p.assumptions.emergencyGoalId === g.id) p.assumptions.emergencyGoalId = ''; });
  }
}

/* ---------------- recurring ---------------- */
@Component({
  selector: 'app-recurring-form',
  imports: [Modal, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [heading]="isNew() ? 'Add recurring income or bill' : 'Edit recurring item'">
      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <div class="modal-body">
          <div class="seg" role="radiogroup" aria-label="Type">
            <button type="button" role="radio" [attr.aria-checked]="type() === 'income'" (click)="setType('income')">Income</button>
            <button type="button" role="radio" [attr.aria-checked]="type() === 'expense'" (click)="setType('expense')">Bill / expense</button>
          </div>
          <div class="field"><label for="rf-name">Name</label><input id="rf-name" formControlName="name" maxlength="60"></div>
          <div class="amount-row">
            <div class="field"><label for="rf-amount">Amount</label><input id="rf-amount" formControlName="amount" type="number" step="any" min="0" inputmode="decimal" autofocus><small>Use take-home (net) pay for salary.</small></div>
            <div class="field"><label for="rf-cur">Currency</label><select id="rf-cur" formControlName="currency">@for (c of currencies(); track c.code) {<option [value]="c.code">{{ c.label }}</option>}</select></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="rf-acc">Account</label><select id="rf-acc" formControlName="accountId" (change)="onAccount()">@for (a of accounts(); track a.id) {<option [value]="a.id">{{ a.name }} ({{ a.currency }})</option>}</select></div>
            <div class="field"><label for="rf-cat">Category</label><select id="rf-cat" formControlName="categoryId">@for (c of cats(); track c.id) {<option [value]="c.id">{{ c.name }}</option>}</select></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="rf-freq">Repeats</label><select id="rf-freq" formControlName="freq">
              <option value="monthly">Monthly</option><option value="biweekly">Every 2 weeks</option><option value="weekly">Weekly</option><option value="yearly">Yearly</option></select></div>
            <div class="field"><label for="rf-next">Next date</label><input id="rf-next" formControlName="nextDate" type="date"><small>Monthly items repeat on this day (shorter months use their last day).</small></div>
          </div>
          <label class="check"><input type="checkbox" formControlName="isSalary"><span>This is my salary (shows on the pay-date tracker)</span></label>
          <label class="check"><input type="checkbox" formControlName="autoPost"><span>Record it automatically on the date (otherwise you'll get a reminder)</span></label>
          @if (!isNew()) {<label class="check"><input type="checkbox" formControlName="active"><span>Active</span></label>}
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
export class RecurringForm extends FormBase implements OnInit {
  readonly item = input<Recurring | null>(null);
  protected readonly isNew = computed(() => !this.item());
  protected readonly type = signal<'income' | 'expense'>('income');
  protected readonly accounts = computed(() => activeAccounts(this.settings()));
  protected readonly cats = computed(() => categoriesOf(this.settings(), this.type()));
  protected readonly form = this.fb.group({ name: 'Salary', amount: '', currency: 'MYR', accountId: '', categoryId: '', freq: 'monthly', nextDate: '', isSalary: true, autoPost: false, active: true });

  ngOnInit() {
    const r = this.item();
    if (r) {
      this.type.set(r.type);
      this.form.setValue({ name: r.name, amount: String(r.amount), currency: r.currency, accountId: r.accountId, categoryId: r.categoryId ?? '', freq: r.freq, nextDate: r.nextDate, isSalary: !!r.isSalary, autoPost: !!r.autoPost, active: r.active !== false });
      return;
    }
    const acc = this.accounts().find((a) => a.currency === this.store.primary()) ?? this.accounts()[0];
    const salary = this.cats().find((c) => c.name === 'Salary');
    const t = todayISO();
    const [y, m, d] = t.split('-').map(Number);
    const day = Math.min(25, daysInMonth(y, m));
    const thisMonth = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    this.form.patchValue({ currency: acc?.currency ?? this.store.primary(), accountId: acc?.id ?? '', categoryId: salary?.id ?? this.cats()[0]?.id ?? '', nextDate: d <= day ? thisMonth : nextOccurrence({ freq: 'monthly', day: 25 }, thisMonth) });
  }
  protected setType(t: 'income' | 'expense') {
    this.type.set(t);
    this.form.patchValue({ categoryId: this.cats()[0]?.id ?? '', ...(t === 'expense' ? { isSalary: false, name: this.form.controls.name.value === 'Salary' ? '' : this.form.controls.name.value } : {}) });
  }
  protected onAccount() {
    const a = this.store.finance().account(this.form.controls.accountId.value);
    if (a) this.form.patchValue({ currency: a.currency });
  }
  protected save() {
    const v = this.form.getRawValue();
    const amount = toNumber(v.amount);
    if (!v.name.trim()) return this.error.set('Give it a name.');
    if (!(amount > 0)) return this.error.set('Enter an amount greater than zero.');
    if (!v.nextDate) return this.error.set('Choose the next date.');
    const r: Recurring = {
      id: this.item()?.id ?? uid(), name: v.name.trim(), type: this.type(), amount, currency: v.currency, accountId: v.accountId, categoryId: v.categoryId || null,
      freq: v.freq as Frequency, day: Number(v.nextDate.slice(8)), nextDate: v.nextDate, isSalary: v.isSalary, autoPost: v.autoPost, active: this.isNew() ? true : v.active,
    };
    this.store.savePlan((p) => { const i = p.recurring.findIndex((x) => x.id === r.id); if (i >= 0) p.recurring[i] = r; else p.recurring.push(r); });
    if (r.autoPost) setTimeout(() => this.store.autoPostRecurring(), 50);
    this.dialog.close(r);
  }
  protected remove() {
    const id = this.item()!.id;
    this.store.savePlan((p) => (p.recurring = p.recurring.filter((x) => x.id !== id)));
    this.dialog.close();
  }
}

/* ---------------- debt ---------------- */
@Component({
  selector: 'app-debt-form',
  imports: [Modal, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [heading]="isNew() ? 'Add a debt' : 'Edit debt'">
      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <div class="modal-body">
          <div class="field"><label for="df-name">Name</label><input id="df-name" formControlName="name" maxlength="60" placeholder="e.g. Credit card, car loan" autofocus></div>
          <div class="amount-row">
            <div class="field"><label for="df-bal">Balance owed</label><input id="df-bal" formControlName="balance" type="number" step="any" min="0" inputmode="decimal"></div>
            <div class="field"><label for="df-cur">Currency</label><select id="df-cur" formControlName="currency">@for (c of currencies(); track c.code) {<option [value]="c.code">{{ c.label }}</option>}</select></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="df-apr">Interest rate</label><div class="input-unit"><input id="df-apr" formControlName="apr" type="number" step="any" min="0" inputmode="decimal"><span>% a year</span></div></div>
            <div class="field"><label for="df-min">Minimum monthly payment</label><input id="df-min" formControlName="minPayment" type="number" step="any" min="0" inputmode="decimal"><small>Record actual payments as spending in Loan & card payments.</small></div>
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
export class DebtForm extends FormBase implements OnInit {
  readonly debt = input<Debt | null>(null);
  protected readonly isNew = computed(() => !this.debt());
  protected readonly form = this.fb.group({ name: '', balance: '', currency: 'MYR', apr: '', minPayment: '' });
  ngOnInit() {
    const d = this.debt();
    this.form.setValue({ name: d?.name ?? '', balance: d ? String(d.balance) : '', currency: d?.currency ?? this.store.primary(), apr: d ? String(d.apr) : '', minPayment: d ? String(d.minPayment) : '' });
  }
  protected save() {
    const v = this.form.getRawValue();
    if (!v.name.trim()) return this.error.set('Name the debt.');
    const d: Debt = { id: this.debt()?.id ?? uid(), name: v.name.trim(), balance: toNumber(v.balance), currency: v.currency, apr: toNumber(v.apr), minPayment: toNumber(v.minPayment) };
    this.store.savePlan((p) => { const i = p.debts.findIndex((x) => x.id === d.id); if (i >= 0) p.debts[i] = d; else p.debts.push(d); });
    this.dialog.close(d);
  }
  protected remove() {
    const id = this.debt()!.id;
    this.store.savePlan((p) => (p.debts = p.debts.filter((x) => x.id !== id)));
    this.dialog.close();
  }
}
