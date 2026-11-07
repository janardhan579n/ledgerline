import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, inject, input, output } from '@angular/core';
import { DialogService } from './dialog.service';
import { Icon } from './icon';

/** Dialog chrome: title bar, scrolling body, footer. Submitting the inner <form> is up to the caller. */
@Component({
  selector: 'app-modal',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape()' },
  template: `
    <div class="scrim" (click)="dismiss()"></div>
    <div class="modal" [class.wide]="wide()" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header>
        <h2 id="modal-title">{{ heading() }}</h2>
        <button type="button" class="btn ghost icon-only" (click)="dismiss()" aria-label="Close"><app-icon name="x" /></button>
      </header>
      <ng-content />
    </div>
  `,
})
export class Modal implements AfterViewInit {
  private readonly dialog = inject(DialogService);
  private readonly el = inject(ElementRef<HTMLElement>);
  readonly heading = input.required<string>();
  readonly wide = input(false);
  readonly locked = input(false);
  readonly dismissed = output<void>();

  ngAfterViewInit() {
    const first = this.el.nativeElement.querySelector('[autofocus], .modal-body input:not([type=checkbox]):not([type=file]), .modal-body select') as HTMLElement | null;
    setTimeout(() => first?.focus(), 30);
  }
  onEscape() { if (!this.locked()) this.dismiss(); }
  dismiss() {
    this.dismissed.emit();
    this.dialog.close(undefined);
  }
}
