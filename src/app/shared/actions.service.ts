import { Injectable, inject } from '@angular/core';
import { Account, Budget, Category, Debt, Goal, Recurring, Transaction } from '../core/models';
import { ImportCsv } from '../forms/import-csv';
import { AccountForm, BudgetForm, CategoryForm, DebtForm, GoalForm, RecurringForm } from '../forms/simple-forms';
import { TxForm } from '../forms/tx-form';
import { LedgerStore } from '../state/ledger.store';
import { DialogService } from './dialog.service';
import { ToastService } from './toast.service';

/** Opens the right dialog for each user action, so pages stay simple. */
@Injectable({ providedIn: 'root' })
export class Actions {
  private readonly dialog = inject(DialogService);
  private readonly store = inject(LedgerStore);
  private readonly toast = inject(ToastService);

  addTx(preset: Partial<Transaction> = {}) {
    if (!this.store.settingsView().accounts.length) {
      this.toast.show('Add an account first.');
      return this.dialog.open(AccountForm);
    }
    return this.dialog.open(TxForm, { preset });
  }
  editTx(tx: Transaction) { return this.dialog.open(TxForm, { tx }); }
  account(account: Account | null = null) { return this.dialog.open(AccountForm, { account }); }
  category(category: Category | null = null) { return this.dialog.open(CategoryForm, { category }); }
  budget(budget: Budget | null = null, presetCategory = '') { return this.dialog.open(BudgetForm, { budget, presetCategory }); }
  goal(goal: Goal | null = null, emergency = false, suggestedTarget: number | null = null) { return this.dialog.open(GoalForm, { goal, emergency, suggestedTarget }); }
  recurring(item: Recurring | null = null) { return this.dialog.open(RecurringForm, { item }); }
  debt(debt: Debt | null = null) { return this.dialog.open(DebtForm, { debt }); }
  importCsv() {
    if (!this.store.settingsView().accounts.length) return this.account();
    return this.dialog.open(ImportCsv);
  }

  /** Savings transaction pre-filled for a goal. */
  goalMoney(g: Goal, out: boolean) {
    const s = this.store.settingsView();
    const cat = s.categories.find((c) => c.kind === 'savings' && c.name === (g.emergency ? 'Emergency fund' : 'Goal savings')) ?? s.categories.find((c) => c.kind === 'savings');
    const acc = s.accounts.find((a) => a.currency === g.currency && !a.archived && a.type !== 'savings') ?? s.accounts[0];
    const savAcc = s.accounts.find((a) => a.type === 'savings' && a.currency === g.currency && !a.archived);
    return this.addTx({ type: 'savings', goalId: g.id, currency: g.currency, categoryId: cat?.id ?? null, accountId: acc?.id, toAccountId: savAcc?.id ?? null, out });
  }
}
