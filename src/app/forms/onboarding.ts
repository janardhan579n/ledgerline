import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CURRENCIES, currencyName } from '../core/currency';
import { defaultSettings, uid } from '../core/defaults';
import { DialogService } from '../shared/dialog.service';
import { Modal } from '../shared/modal';
import { ToastService } from '../shared/toast.service';
import { LedgerStore } from '../state/ledger.store';
import { RecurringForm } from './simple-forms';

@Component({
  selector: 'app-onboarding',
  imports: [Modal, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal heading="Set up your ledger" [locked]="true">
      <form (submit)="$event.preventDefault(); start()">
        <div class="modal-body">
          <p>Three quick choices. You can change all of them later in Setup.</p>
          <div class="field"><label for="ob-primary">Primary display currency</label>
            <select id="ob-primary" [ngModel]="primary()" (ngModelChange)="primary.set($event)" name="primary">
              @for (c of all; track c[0]) {<option [value]="c[0]">{{ c[0] }} · {{ c[1] }}</option>}
            </select>
            <small>Totals and reports are shown in this currency.</small></div>
          <div class="field"><span class="lbl">Other currencies you earn or spend in</span>
            <div class="check-grid">
              @for (c of picks; track c) {
                <label class="check"><input type="checkbox" [checked]="others().includes(c)" (change)="toggle(c)"><span>{{ c }} · {{ name(c) }}</span></label>
              }
            </div></div>
          <div class="field"><span class="lbl">Start with these accounts</span>
            <div class="stack">
              <label class="check"><input type="checkbox" [(ngModel)]="a1" name="a1"><span><b>Salary account ({{ primary() }})</b>, a bank account your pay goes into</span></label>
              @if (second(); as s) {<label class="check"><input type="checkbox" [(ngModel)]="a2" name="a2"><span><b>{{ s }} bank account</b>, for spending in {{ s }}</span></label>}
              <label class="check"><input type="checkbox" [(ngModel)]="a3" name="a3"><span><b>Cash ({{ primary() }})</b></span></label>
            </div>
            <small>Opening balances start at zero; edit them in Setup.</small></div>
        </div>
        <footer><span class="spacer"></span><button type="submit" class="btn primary">Start tracking</button></footer>
      </form>
    </app-modal>`,
})
export class Onboarding {
  private readonly store = inject(LedgerStore);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  protected readonly all = CURRENCIES;
  protected readonly picks = ['INR', 'USD', 'SGD', 'EUR', 'GBP', 'AED'];
  protected readonly primary = signal('MYR');
  protected readonly others = signal<string[]>(['INR']);
  protected readonly second = computed(() => this.others().find((c) => c !== this.primary()) ?? null);
  protected a1 = true; protected a2 = true; protected a3 = true;
  protected name = currencyName;

  protected toggle(c: string) {
    this.others.update((o) => (o.includes(c) ? o.filter((x) => x !== c) : [...o, c]));
  }
  protected async start() {
    const p = this.primary();
    const others = this.others().filter((c) => c !== p);
    const s = defaultSettings(p, [p, ...others]);
    if (this.a1) s.accounts.push({ id: uid(), name: 'Salary account', type: 'bank', currency: p, opening: 0 });
    if (this.a2 && others[0]) s.accounts.push({ id: uid(), name: `${others[0]} bank account`, type: 'bank', currency: others[0], opening: 0 });
    if (this.a3) s.accounts.push({ id: uid(), name: 'Cash', type: 'cash', currency: p, opening: 0 });
    await this.store.createLedger(s);
    this.dialog.close();
    this.toast.show("You're set up. Add your salary next.");
    if (s.accounts.length) setTimeout(() => this.dialog.open(RecurringForm), 200);
  }
}
