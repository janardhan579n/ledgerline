import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { formatMoney, round2 } from '../core/currency';
import { dateLabel } from '../core/dates';
import { DraftTx, findDuplicate } from '../core/receipt';
import { DialogService } from '../shared/dialog.service';
import { Icon } from '../shared/icon';
import { Modal } from '../shared/modal';
import { ScanService, ScannedFile } from '../shared/scan.service';
import { ToastService } from '../shared/toast.service';
import { LedgerStore } from '../state/ledger.store';
import { activeAccounts, currencyChoices } from './form-helpers';

const DOC_LABEL: Record<string, string> = { receipt: 'Receipt', invoice: 'Invoice', bill: 'Bill', payslip: 'Payslip', bank_statement: 'Statement', other: 'Document' };

@Component({
  selector: 'app-scan-dialog',
  imports: [Modal, FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal heading="Scan receipts & payslips" [wide]="true">
      <form (submit)="$event.preventDefault(); save()">
        <div class="modal-body">
          @if (stage() === 'pick') {
            <label class="dropzone" [class.over]="dragging()" (dragover)="$event.preventDefault(); dragging.set(true)" (dragleave)="dragging.set(false)" (drop)="onDrop($event)">
              <input id="scan-files" type="file" multiple accept="image/*,application/pdf,.pdf" (change)="onPick($event)" class="sr">
              <app-icon name="scan" />
              <b>Choose photos or PDFs</b>
              <span class="muted small">Receipts, bills, invoices, payslips or bank statements. On a phone you can take a photo. Up to 15 MB each.</span>
            </label>
            <div class="field-row">
              <div class="field"><label for="scan-acc">Record into account</label>
                <select id="scan-acc" name="acc" [(ngModel)]="accountId">@for (a of accounts(); track a.id) {<option [value]="a.id">{{ a.name }} ({{ a.currency }})</option>}</select>
                <small>You can change the account for each item on the next screen.</small></div>
              <div class="field"><span class="lbl">Receipt copies</span>
                <label class="check"><input type="checkbox" name="keep" [(ngModel)]="keepCopy"><span>Keep a small copy with the transaction</span></label>
                <small>Photos are shrunk to about 300 KB and stored privately in your account.</small></div>
            </div>
            <p class="scan-privacy small"><app-icon name="lock" />{{ scan.reader.privacyNote }}</p>
          } @else {
            <ul class="scan-files">
              @for (f of files(); track f.index) {
                <li class="scan-file" [class.failed]="f.status === 'failed'">
                  <div class="sf-head">
                    @if (f.previewUrl) {<img [src]="f.previewUrl" alt="" class="sf-thumb">} @else {<span class="sf-thumb doc"><app-icon name="report" /></span>}
                    <div class="sf-title"><b>{{ f.name }}</b>
                      <small class="muted">
                        @switch (f.status) {
                          @case ('waiting') {Waiting…}
                          @case ('reading') {<span class="spinner" aria-hidden="true"></span>Reading…}
                          @case ('failed') {<span class="warn-text">{{ f.error }}</span>}
                          @default {<span>{{ docLabel(f.docType) }}@if (f.issuer) { · {{ f.issuer }}} · found {{ f.drafts.length }} item{{ f.drafts.length === 1 ? '' : 's' }}</span>}
                        }
                      </small></div>
                    @if (f.status === 'failed' && f.retryable) {<button type="button" class="btn sm" (click)="retry(f)">Try again</button>}
                  </div>
                  @for (w of f.warnings; track $index) {<p class="small warn-text">{{ w }}</p>}
                  @if (f.copyNote) {<p class="small muted">{{ f.copyNote }}</p>}
                  @for (d of f.drafts; track d.key) {
                    <div class="draft" [class.off]="!d.include">
                      <label class="check draft-inc"><input type="checkbox" [name]="'inc' + d.key" [(ngModel)]="d.include" (ngModelChange)="touch()"><span class="sr">Include</span></label>
                      <div class="draft-grid">
                        <div class="seg small" role="radiogroup" aria-label="Money in or out">
                          <button type="button" role="radio" [attr.aria-checked]="d.type === 'expense'" (click)="setType(d, 'expense')">− Out</button>
                          <button type="button" role="radio" [attr.aria-checked]="d.type === 'income'" (click)="setType(d, 'income')">+ In</button>
                        </div>
                        <div class="draft-amt"><input type="number" step="any" min="0" inputmode="decimal" [name]="'amt' + d.key" [(ngModel)]="d.amount" (ngModelChange)="recheck(d)" aria-label="Amount">
                          <select [name]="'cur' + d.key" [(ngModel)]="d.currency" (ngModelChange)="recheck(d)" aria-label="Currency">@for (c of currencies(); track c.code) {<option [value]="c.code">{{ c.code }}</option>}</select></div>
                        <input type="date" [name]="'date' + d.key" [(ngModel)]="d.date" (ngModelChange)="recheck(d)" aria-label="Date">
                        <select [name]="'cat' + d.key" [(ngModel)]="d.categoryId" aria-label="Category">@for (c of catsFor(d.type); track c.id) {<option [value]="c.id">{{ c.name }}</option>}</select>
                        <select class="draft-acc" [name]="'acc' + d.key" [(ngModel)]="d.accountId" aria-label="Account">@for (a of accounts(); track a.id) {<option [value]="a.id">{{ a.name }}</option>}</select>
                        <input type="text" [name]="'notes' + d.key" [(ngModel)]="d.notes" maxlength="200" aria-label="Notes" class="draft-notes">
                      </div>
                      @if (d.duplicateOf) {<p class="small warn-text draft-note"><app-icon name="alert" />Looks like {{ dupText(d) }}, already recorded. Tick to add it anyway.</p>}
                      @for (p of d.problems; track p) {<p class="small warn-text draft-note">{{ p }}</p>}
                    </div>
                  }
                </li>
              }
            </ul>
          }
        </div>
        @if (error()) {<p class="form-error" role="alert">{{ error() }}</p>}
        <footer>
          @if (stage() === 'review') {<button type="button" class="btn ghost" (click)="reset()" [disabled]="busy()">Scan more</button>}
          <span class="spacer"></span>
          @if (stage() === 'review') {<span class="small muted scan-total">{{ summary() }}</span>}
          <button type="button" class="btn ghost" (click)="dialog.close()">Cancel</button>
          @if (stage() === 'review') {<button type="submit" class="btn primary" [disabled]="busy() || !count()">Save {{ count() || '' }}</button>}
        </footer>
      </form>
    </app-modal>`,
})
export class ScanDialog implements OnDestroy {
  protected readonly dialog = inject(DialogService);
  protected readonly scan = inject(ScanService);
  private readonly store = inject(LedgerStore);
  private readonly toast = inject(ToastService);
  protected readonly stage = signal<'pick' | 'review'>('pick');
  protected readonly files = signal<ScannedFile[]>([]);
  protected readonly busy = signal(false);
  protected readonly dragging = signal(false);
  protected readonly error = signal('');
  private readonly version = signal(0);
  private raw: File[] = [];

  protected readonly accounts = computed(() => activeAccounts(this.store.settingsView()));
  protected readonly currencies = computed(() => currencyChoices(this.store.settingsView()));
  protected accountId = this.store.settingsView().scan?.accountId ?? this.accounts().find((a) => a.currency === this.store.primary())?.id ?? this.accounts()[0]?.id ?? '';
  protected keepCopy = this.store.settingsView().scan?.keepCopies ?? true;

  protected readonly count = computed(() => { this.version(); return this.files().flatMap((f) => f.drafts).filter((d) => d.include && d.amount > 0).length; });
  protected readonly summary = computed(() => {
    this.version();
    const f = this.store.finance();
    let inn = 0, out = 0;
    for (const d of this.files().flatMap((x) => x.drafts)) {
      if (!d.include) continue;
      const v = f.convert(d.amount, d.currency, f.primary) ?? 0;
      if (d.type === 'income') inn += v; else out += v;
    }
    return `+${formatMoney(inn, f.primary)} / −${formatMoney(out, f.primary)}`;
  });

  protected docLabel(t?: string) { return DOC_LABEL[t ?? 'other'] ?? 'Document'; }
  protected catsFor(type: 'income' | 'expense') { return this.store.settingsView().categories.filter((c) => c.kind === type); }
  protected touch() { this.version.update((v) => v + 1); }
  private refresh() { this.files.update((f) => [...f]); this.touch(); }

  protected setType(d: DraftTx, type: 'income' | 'expense') {
    d.type = type;
    d.categoryId = this.catsFor(type).find((c) => /^Other/.test(c.name))?.id ?? this.catsFor(type)[0]?.id ?? null;
    this.recheck(d);
  }
  protected recheck(d: DraftTx) {
    d.amount = round2(Number(d.amount) || 0);
    const dup = d.amount > 0 && d.date ? findDuplicate(d, this.store.transactions()) : undefined;
    d.duplicateOf = dup?.id;
    this.touch();
  }
  protected dupText(d: DraftTx) {
    const t = this.store.transactions().find((x) => x.id === d.duplicateOf);
    return t ? `${formatMoney(t.amount, t.currency)} on ${dateLabel(t.date, true)} (${this.store.finance().catName(t.categoryId)})` : 'a matching transaction';
  }

  protected onPick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const list = [...(input.files ?? [])];
    input.value = '';
    void this.start(list);
  }
  protected onDrop(ev: DragEvent) {
    ev.preventDefault();
    this.dragging.set(false);
    void this.start([...(ev.dataTransfer?.files ?? [])]);
  }

  private async start(list: File[]) {
    if (!list.length) return;
    if (!this.accountId) { this.error.set('Add an account first (Setup → Accounts).'); return; }
    this.error.set('');
    if (list.length > 20) { list = list.slice(0, 20); this.toast.show('Scanning the first 20 files.'); }
    // Remember the choices for next time.
    const s = this.store.settingsView().scan;
    if (s?.keepCopies !== this.keepCopy || s?.accountId !== this.accountId)
      void this.store.saveSettings((x) => (x.scan = { keepCopies: this.keepCopy, accountId: this.accountId }));
    const base = this.files().length;
    this.raw.push(...list);
    this.files.update((f) => [...f, ...list.map((file, i) => ({ index: base + i, name: file.name || 'Photo', status: 'waiting' as const, warnings: [], drafts: [] }))]);
    this.stage.set('review');
    this.busy.set(true);
    // One at a time: the free AI tier allows only a few requests a minute.
    for (let i = base; i < this.files().length; i++) {
      const item = this.files()[i];
      if (item.status !== 'waiting') continue;
      await this.scan.scan(this.raw[i], item, { accountId: this.accountId, keepCopy: this.keepCopy }, () => this.refresh());
      this.refresh();
    }
    this.busy.set(false);
  }

  protected async retry(item: ScannedFile) {
    Object.assign(item, { status: 'waiting', error: undefined, warnings: [], drafts: [] });
    this.busy.set(true);
    await this.scan.scan(this.raw[item.index], item, { accountId: this.accountId, keepCopy: this.keepCopy }, () => this.refresh());
    this.refresh();
    this.busy.set(false);
  }

  protected reset() {
    this.stage.set('pick');
  }

  protected async save() {
    if (!this.count()) return;
    this.busy.set(true);
    try {
      const n = await this.scan.save(this.files());
      this.toast.show(`Recorded ${n} transaction${n === 1 ? '' : 's'} from your scans.`);
      this.dialog.close(n);
    } catch {
      this.error.set("Couldn't save. Check your connection and try again.");
    } finally {
      this.busy.set(false);
    }
  }

  ngOnDestroy() {
    this.files().forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
  }
}
