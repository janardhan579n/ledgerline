import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { addMonths, currentMonth, monthLabel } from '../core/dates';
import { Backend } from '../data/backend';
import { RatesService } from '../data/rates.service';
import { Onboarding } from '../forms/onboarding';
import { Actions } from '../shared/actions.service';
import { DialogService } from '../shared/dialog.service';
import { Icon } from '../shared/icon';
import { LedgerStore } from '../state/ledger.store';
import { UiState } from '../state/ui.state';
import { MoreNav } from './more-nav';
import { NAV } from './nav';



@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="app">
      <aside class="sidebar" aria-label="Main">
        <div class="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="7"/><path d="M10 21l5-6 4 3 4-7"/></svg><span>Ledgerline</span></div>
        <nav class="side-nav">
          @for (n of nav; track n.path) {<a [routerLink]="'/' + n.path" routerLinkActive="active"><app-icon [name]="n.icon" /><span>{{ n.label }}</span></a>}
        </nav>
        <div class="side-foot">
          <span class="muted small">Totals in</span> <a routerLink="/setup" class="chip">{{ store.primary() }}</a>
          @if (backend.user(); as u) {<span class="who small muted" [title]="u.email">{{ u.email }}</span>}
        </div>
      </aside>
      <main>
        <header class="topbar">
          <h1>{{ current().label }}</h1>
          @if (current().month) {
            <div class="month-picker">
              <button class="btn ghost icon-only" (click)="step(-1)" aria-label="Previous month"><app-icon name="chevL" /></button>
              <button class="mp-label" (click)="ui.month.set(thisMonth)" title="Jump to this month">{{ monthText() }}</button>
              <button class="btn ghost icon-only" (click)="step(1)" [disabled]="atLimit()" aria-label="Next month"><app-icon name="chevR" /></button>
            </div>
          }
          <button class="btn scan-btn" (click)="actions.scan()"><app-icon name="scan" />Scan</button>
          <button class="btn primary add-btn" (click)="actions.addTx()"><app-icon name="plus" />Add</button>
        </header>
        @if (backend.mode === 'demo') {<div class="banner warning"><app-icon name="alert" /><span><b>Demo mode.</b> Firebase isn't configured, so nothing you enter is saved. See the README to connect your own project.</span></div>}
        @if (store.note()) {<div class="banner info">{{ store.note() }}</div>}
        @if (store.status() === 'loading') {
          <div class="skeleton"><div></div><div></div><div></div></div>
        } @else {
          <div class="view"><router-outlet /></div>
        }
      </main>
      <nav class="tabbar" aria-label="Main">
        <a routerLink="/overview" routerLinkActive="active"><app-icon name="home" /><span>Overview</span></a>
        <a routerLink="/transactions" routerLinkActive="active"><app-icon name="list" /><span>History</span></a>
        <button class="fab" (click)="actions.addTx()" aria-label="Add transaction"><app-icon name="plus" /></button>
        <a routerLink="/reports" routerLinkActive="active"><app-icon name="report" /><span>Reports</span></a>
        <button [class.active]="isMore()" (click)="dialog.open(moreNav)"><app-icon name="more" /><span>More</span></button>
      </nav>
    </div>`,
})
export class Shell {
  protected readonly store = inject(LedgerStore);
  protected readonly ui = inject(UiState);
  protected readonly actions = inject(Actions);
  protected readonly backend = inject(Backend);
  protected readonly dialog = inject(DialogService);
  private readonly router = inject(Router);
  protected readonly nav = NAV;
  protected readonly moreNav = MoreNav;
  protected readonly thisMonth = currentMonth();
  private readonly url = toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map(() => this.router.url)), { initialValue: this.router.url });
  protected readonly current = computed(() => NAV.find((n) => this.url().split(/[?#]/)[0] === '/' + n.path) ?? NAV[0]);
  protected readonly isMore = computed(() => !['overview', 'transactions', 'reports'].includes(this.current().path));
  protected readonly monthText = computed(() => monthLabel(this.ui.month()));
  protected readonly atLimit = computed(() => this.ui.month() >= addMonths(this.thisMonth, 1));

  constructor() {
    inject(RatesService); // starts automatic rate refresh
    effect(() => {
      if (this.store.needsOnboarding()) untracked(() => this.dialog.open(Onboarding));
    });
    effect(() => {
      const title = this.current().label;
      untracked(() => (document.title = `Ledgerline · ${title}`));
    });
  }
  protected step(n: number) { this.ui.month.update((m) => addMonths(m, n)); }
}
