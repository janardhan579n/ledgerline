import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { Backend } from './data/backend';
import { Shell } from './shell/shell';

/** Waits for Firebase to restore the session, then allows or redirects. */
const whenAuthKnown = (wantSignedIn: boolean): CanActivateFn => () => {
  const backend = inject(Backend);
  const router = inject(Router);
  return toObservable(backend.user).pipe(
    filter((u) => u !== undefined),
    take(1),
    map((u) => (!!u === wantSignedIn ? true : router.createUrlTree([wantSignedIn ? '/sign-in' : '/overview']))),
  );
};

export const routes: Routes = [
  { path: 'sign-in', canActivate: [whenAuthKnown(false)], loadComponent: () => import('./shell/sign-in') },
  {
    path: '',
    component: Shell,
    canActivate: [whenAuthKnown(true)],
    canActivateChild: [whenAuthKnown(true)],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      { path: 'overview', loadComponent: () => import('./features/dashboard') },
      { path: 'transactions', loadComponent: () => import('./features/transactions') },
      { path: 'income', loadComponent: () => import('./features/income') },
      { path: 'budgets', loadComponent: () => import('./features/budgets') },
      { path: 'goals', loadComponent: () => import('./features/goals') },
      { path: 'loans', loadComponent: () => import('./features/loans') },
      { path: 'prices', loadComponent: () => import('./features/prices') },
      { path: 'reports', loadComponent: () => import('./features/reports') },
      { path: 'cashflow', loadComponent: () => import('./features/cashflow') },
      { path: 'guidance', loadComponent: () => import('./features/guidance') },
      { path: 'setup', loadComponent: () => import('./features/setup') },
    ],
  },
  { path: '**', redirectTo: '' },
];
