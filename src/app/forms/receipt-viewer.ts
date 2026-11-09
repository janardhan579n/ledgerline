import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { Transaction } from '../core/models';
import { DialogService } from '../shared/dialog.service';
import { Icon } from '../shared/icon';
import { Modal } from '../shared/modal';
import { LedgerStore } from '../state/ledger.store';
import { TxForm } from './tx-form';

/** Shows the stored copy of a receipt; PDFs open in a new tab. */
@Component({
  selector: 'app-receipt-viewer',
  imports: [Modal, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [heading]="name() || 'Receipt'" [wide]="true">
      <div class="modal-body receipt-view">
        @switch (state()) {
          @case ('loading') {<p class="muted">Loading receipt…</p>}
          @case ('missing') {<p class="muted">The copy of this receipt isn't available. It may have been deleted, or you're offline and it hasn't been opened on this device before.</p>}
          @case ('image') {<img [src]="url()" [alt]="'Receipt: ' + name()">}
          @case ('pdf') {<p>This receipt is a PDF.</p><a class="btn primary" [href]="url()" target="_blank" rel="noopener"><app-icon name="download" />Open PDF</a>}
        }
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn ghost" (click)="back()">Back to transaction</button></footer>
    </app-modal>`,
})
export class ReceiptViewer implements OnInit, OnDestroy {
  private readonly store = inject(LedgerStore);
  private readonly dialog = inject(DialogService);
  private readonly sanitizer = inject(DomSanitizer);
  readonly tx = input.required<Transaction>();
  protected readonly state = signal<'loading' | 'missing' | 'image' | 'pdf'>('loading');
  protected readonly url = signal<SafeUrl | string>('');
  protected readonly name = signal('');
  private objectUrl = '';

  async ngOnInit() {
    const id = this.tx().receiptId;
    const doc = id ? await this.store.getReceipt(id).catch(() => null) : null;
    if (!doc) return this.state.set('missing');
    this.name.set(doc.name);
    const bytes = Uint8Array.from(atob(doc.data), (c) => c.charCodeAt(0));
    this.objectUrl = URL.createObjectURL(new Blob([bytes], { type: doc.mime }));
    this.url.set(this.sanitizer.bypassSecurityTrustUrl(this.objectUrl));
    this.state.set(doc.mime === 'application/pdf' ? 'pdf' : 'image');
  }
  protected back() { this.dialog.open(TxForm, { tx: this.tx() }); }
  ngOnDestroy() { if (this.objectUrl) setTimeout(() => URL.revokeObjectURL(this.objectUrl), 60000); }
}
