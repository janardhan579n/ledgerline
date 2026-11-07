import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DialogService } from '../shared/dialog.service';
import { Icon } from '../shared/icon';
import { Modal } from '../shared/modal';
import { NAV } from './nav';

@Component({
  selector: 'app-more-nav',
  imports: [Modal, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal heading="Go to">
      <div class="modal-body"><nav class="more-nav">
        @for (n of nav; track n.path) {<a [routerLink]="'/' + n.path" (click)="dialog.close()"><app-icon [name]="n.icon" /><span>{{ n.label }}</span></a>}
      </nav></div>
    </app-modal>`,
})
export class MoreNav {
  protected readonly dialog = inject(DialogService);
  protected readonly nav = NAV;
}
