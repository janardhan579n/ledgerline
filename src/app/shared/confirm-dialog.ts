import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { DialogService } from './dialog.service';
import { Modal } from './modal';

@Component({
  selector: 'app-confirm-dialog',
  imports: [Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal heading="Please confirm">
      <form (submit)="$event.preventDefault(); dialog.close(true)">
        <div class="modal-body"><p>{{ message() }}</p></div>
        <footer>
          <span class="spacer"></span>
          <button type="button" class="btn ghost" (click)="dialog.close(false)">Cancel</button>
          <button type="submit" class="btn" [class.danger]="danger()" [class.primary]="!danger()" autofocus>{{ confirmLabel() }}</button>
        </footer>
      </form>
    </app-modal>
  `,
})
export class ConfirmDialog {
  protected readonly dialog = inject(DialogService);
  readonly message = input.required<string>();
  readonly confirmLabel = input('Confirm');
  readonly danger = input(true);
}

export function confirmAction(dialog: DialogService, message: string, confirmLabel = 'Confirm', danger = true): Promise<boolean> {
  return dialog.open<boolean>(ConfirmDialog, { message, confirmLabel, danger }).then((r) => !!r);
}
