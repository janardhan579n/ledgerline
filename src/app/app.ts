import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { Router, RouterOutlet } from '@angular/router';
import { Backend } from './data/backend';
import { DialogService } from './shared/dialog.service';
import { ToastService } from './shared/toast.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />
    @if (dialog.current(); as d) {
      <div class="modal-root" [class.modal-open]="true"><ng-container *ngComponentOutlet="d.component; inputs: d.inputs" /></div>
    }
    <div class="toast" [class.show]="!!toast.current()" [class.error]="toast.current()?.kind === 'error'" role="status" aria-live="polite">{{ toast.current()?.message }}</div>`,
})
export class App {
  protected readonly dialog = inject(DialogService);
  protected readonly toast = inject(ToastService);
  private readonly backend = inject(Backend);
  private readonly router = inject(Router);

  constructor() {
    // Leave the app as soon as the user signs out (or the session ends) and enter it after sign-in.
    let last: string | null | undefined;
    effect(() => {
      const u = this.backend.user();
      const id = u === undefined ? undefined : u?.uid ?? null;
      if (id === last) return;
      const was = last;
      last = id;
      if (id === null && was !== undefined) { this.dialog.close(); void this.router.navigateByUrl('/sign-in'); }
      if (id && was === null) void this.router.navigateByUrl('/overview');
    });
    effect(() => document.body.classList.toggle('modal-open', !!this.dialog.current()));
  }
}
