import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CURRENCIES, toNumber } from '../core/currency';
import { uid } from '../core/defaults';
import { Asset, MetalUnit, NOTIFICATIONS_ENABLED, PURITIES, PriceAlert, RuleKind, UNIT_LABEL, alertSubject, alertValue, formatPrice } from '../core/price-alerts';
import { confirmAction } from '../shared/confirm-dialog';
import { DialogService } from '../shared/dialog.service';
import { Modal } from '../shared/modal';
import { PricesService } from '../shared/prices.service';
import { LedgerStore } from '../state/ledger.store';

const KINDS: ReadonlyArray<[RuleKind, string]> = NOTIFICATIONS_ENABLED
  ? [['daily', 'Daily update'], ['above', 'Goes above'], ['below', 'Goes below'], ['move', 'Moves by %']]
  : [['daily', 'Just show the price'], ['above', 'Target: above'], ['below', 'Target: below']];

@Component({
  selector: 'app-price-alert-form',
  imports: [Modal, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [heading]="notify ? (isNew() ? 'New price alert' : 'Edit price alert') : (isNew() ? 'Add a price to watch' : 'Edit watched price')">
      <form (submit)="$event.preventDefault(); save()">
        <div class="modal-body">
          <div class="field"><span class="lbl">Watch</span>
            <div class="seg" role="radiogroup" aria-label="What to watch">
              <button type="button" role="radio" [attr.aria-checked]="asset() === 'gold'" (click)="setAsset('gold')">Gold</button>
              <button type="button" role="radio" [attr.aria-checked]="asset() === 'silver'" (click)="setAsset('silver')">Silver</button>
              <button type="button" role="radio" [attr.aria-checked]="asset() === 'fx'" (click)="setAsset('fx')">Currency</button>
            </div>
          </div>
          @if (asset() === 'fx') {
            <div class="field-row">
              <div class="field"><label for="pa-base">1 unit of</label><select id="pa-base" name="base" [ngModel]="base()" (ngModelChange)="base.set($event)">@for (c of currencies(); track c) {<option [value]="c">{{ c }}</option>}</select></div>
              <div class="field"><label for="pa-cur">In</label><select id="pa-cur" name="cur" [ngModel]="currency()" (ngModelChange)="currency.set($event)">@for (c of currencies(); track c) {<option [value]="c">{{ c }}</option>}</select></div>
            </div>
          } @else {
            <div class="field-row three">
              @if (asset() === 'gold') {
                <div class="field"><label for="pa-pur">Purity</label><select id="pa-pur" name="pur" [ngModel]="purity()" (ngModelChange)="purity.set(+$event)">@for (p of purities; track p[0]) {<option [value]="p[0]">{{ p[1] }}</option>}</select></div>
              }
              <div class="field"><label for="pa-unit">Price</label><select id="pa-unit" name="unit" [ngModel]="unit()" (ngModelChange)="unit.set($event)">@for (u of units; track u[0]) {<option [value]="u[0]">{{ u[1] }}</option>}</select></div>
              <div class="field"><label for="pa-cur2">In</label><select id="pa-cur2" name="cur2" [ngModel]="currency()" (ngModelChange)="currency.set($event)">@for (c of currencies(); track c) {<option [value]="c">{{ c }}</option>}</select></div>
            </div>
          }
          <p class="small muted">{{ subject() }} is <b>{{ now() ?? 'loading…' }}</b> right now.</p>

          <div class="field"><span class="lbl">{{ notify ? 'Notify me' : 'Target (optional)' }}</span>
            <div class="seg small" role="radiogroup" aria-label="When to notify">
              @for (k of kinds; track k[0]) {<button type="button" role="radio" [attr.aria-checked]="kind() === k[0]" (click)="setKind(k[0])">{{ k[1] }}</button>}
            </div>
          </div>
          @switch (kind()) {
            @case ('daily') {
              @if (notify) {<p class="small muted">Sent once a day at {{ hourLabel() }} with the price and its change since the day before. Change the time under Notifications.</p>}
              @else {<p class="small muted">Shown on your list whenever you get the latest prices.</p>}
            }
            @case ('move') {
              <div class="field"><label for="pa-val">When it moves by</label><div class="input-unit short"><input id="pa-val" name="val" type="number" min="0.1" max="50" step="0.1" inputmode="decimal" [ngModel]="value()" (ngModelChange)="value.set($event)"><span>% up or down</span></div>
                <small>Measured from the price when the alert was set, then from each notified price.</small></div>
            }
            @default {
              <div class="field"><label for="pa-val">{{ kind() === 'above' ? 'When it rises to or above' : 'When it falls to or below' }}</label>
                <div class="pa-target"><input id="pa-val" name="val" type="number" min="0" step="any" inputmode="decimal" [ngModel]="value()" (ngModelChange)="value.set($event)" class="short-input">
                  @if (nowValue() != null) {<button type="button" class="btn sm ghost" (click)="useNow()">Use current</button>}</div>
                <small>In {{ currency() }}{{ asset() === 'fx' ? '' : ', ' + unitLabel() }}.@if (!notify) { Your list shows "Target reached" when the price gets there.}</small></div>
            }
          }
          @if (notify && kind() !== 'daily') {
            <div class="field"><span class="lbl">How often</span>
              <div class="seg small" role="radiogroup" aria-label="Repeat">
                <button type="button" role="radio" [attr.aria-checked]="repeat() === 'once'" (click)="repeat.set('once')">Once, then stop</button>
                <button type="button" role="radio" [attr.aria-checked]="repeat() === 'every'" (click)="repeat.set('every')">Every time it happens</button>
              </div>
              <small>{{ repeat() === 'every' ? (kind() === 'move' ? 'Again after each further move.' : 'Again after the price has moved back past the target.') : 'You can switch it back on from the list.' }}</small>
            </div>
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
    </app-modal>`,
})
export class PriceAlertForm implements OnInit {
  protected readonly dialog = inject(DialogService);
  private readonly store = inject(LedgerStore);
  private readonly prices = inject(PricesService);
  readonly alert = input<PriceAlert | null>(null);
  /** Pre-filled choices for a new alert (e.g. from a price tile). */
  readonly preset = input<Partial<PriceAlert>>({});
  protected readonly isNew = computed(() => !this.alert());
  protected readonly kinds = KINDS;
  protected readonly notify = NOTIFICATIONS_ENABLED;
  protected readonly purities = PURITIES;
  protected readonly units = Object.entries(UNIT_LABEL) as [MetalUnit, string][];
  protected readonly error = signal('');

  protected readonly asset = signal<Asset>('gold');
  protected readonly currency = signal('MYR');
  protected readonly base = signal('MYR');
  protected readonly unit = signal<MetalUnit>('g');
  protected readonly purity = signal(0.999);
  protected readonly kind = signal<RuleKind>('above');
  protected readonly value = signal<string | number>('');
  protected readonly repeat = signal<'once' | 'every'>('once');

  protected readonly currencies = computed(() => [...new Set([...this.store.settingsView().currencies, 'USD', ...CURRENCIES.map((c) => c[0])])]);
  private readonly draft = computed(() => ({ asset: this.asset(), currency: this.currency(), base: this.base(), unit: this.unit(), purity: this.purity() }));
  protected readonly subject = computed(() => alertSubject(this.draft()));
  protected readonly unitLabel = computed(() => UNIT_LABEL[this.unit()]);
  protected readonly nowValue = computed(() => { const q = this.prices.quotes(); return q ? alertValue(this.draft(), q) : null; });
  protected readonly now = computed(() => { const v = this.nowValue(); return v == null ? null : formatPrice(v, this.draft()); });
  protected readonly hourLabel = computed(() => { const h = this.store.alertsView().dailyHour; return `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`; });

  ngOnInit() {
    void this.prices.load();
    const s = this.store.settingsView();
    const other = s.currencies.find((c) => c !== s.primary) ?? 'INR';
    const a = this.alert() ?? (Object.keys(this.preset()).length ? ({ kind: NOTIFICATIONS_ENABLED ? 'above' : 'daily', ...this.preset() } as PriceAlert) : null);
    if (!a) {
      this.currency.set(s.primary);
      this.base.set(s.primary);
      if (!NOTIFICATIONS_ENABLED) this.kind.set('daily');
      return;
    }
    this.asset.set(a.asset);
    this.currency.set(a.currency || (a.asset === 'fx' ? other : s.primary));
    this.base.set(a.base ?? s.primary);
    this.unit.set(a.unit ?? 'g');
    this.purity.set(a.purity ?? 0.999);
    this.kind.set(KINDS.some((k) => k[0] === a.kind) ? a.kind : 'daily');
    this.value.set(a.value ?? '');
    this.repeat.set(a.repeat ?? 'once');
  }

  protected setAsset(x: Asset) {
    this.asset.set(x);
    const s = this.store.settingsView();
    if (x === 'fx') {
      this.base.set(s.primary);
      this.currency.set(s.currencies.find((c) => c !== s.primary) ?? 'INR');
    } else if (this.currency() === this.base() || !this.currency()) this.currency.set(s.primary);
    if (x === 'silver' && this.unit() === '10g') this.unit.set('g');
    this.value.set('');
  }
  protected setKind(k: RuleKind) {
    if ((k === 'move') !== (this.kind() === 'move')) this.value.set(k === 'move' ? 1 : '');
    this.kind.set(k);
  }
  protected useNow() {
    const v = this.nowValue();
    if (v != null) this.value.set(+v.toFixed(this.asset() === 'fx' ? 4 : 2));
  }

  protected save() {
    const v = toNumber(String(this.value() ?? ''));
    const k = this.kind();
    if (this.asset() === 'fx' && this.base() === this.currency()) return this.error.set('Choose two different currencies.');
    if (k !== 'daily' && !(v > 0)) return this.error.set(k === 'move' ? 'Enter the percentage, e.g. 1.5.' : 'Enter the target price.');
    if (k === 'move' && v > 50) return this.error.set('Use a move of 50% or less.');
    const prev = this.alert();
    const a: PriceAlert = {
      id: prev?.id ?? uid(), asset: this.asset(), currency: this.currency(), kind: k, active: true, rev: new Date().toISOString(),
      ...(this.asset() === 'fx' ? { base: this.base() } : { unit: this.unit() }),
      ...(this.asset() === 'gold' ? { purity: this.purity() } : {}),
      ...(k === 'daily' ? {} : { value: v, repeat: this.repeat() }),
    };
    void this.store.saveAlerts((s) => {
      const i = s.alerts.findIndex((x) => x.id === a.id);
      if (i >= 0) s.alerts[i] = a; else s.alerts.push(a);
    });
    this.dialog.close(a);
  }

  protected async remove() {
    const a = this.alert()!;
    if (await confirmAction(this.dialog, this.notify ? 'Delete this price alert?' : 'Remove this price from your list?', 'Delete')) void this.store.saveAlerts((s) => (s.alerts = s.alerts.filter((x) => x.id !== a.id)));
  }
}
