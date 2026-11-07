import { Injectable, signal } from '@angular/core';
import { currentMonth } from '../core/dates';
import { TxType } from '../core/models';

export interface TxFilters { q: string; type: TxType | ''; cat: string; acc: string; cur: string; from: string; to: string }
export const EMPTY_FILTERS: TxFilters = { q: '', type: '', cat: '', acc: '', cur: '', from: '', to: '' };

/** View state shared across pages (selected month, report period, filters). Not persisted. */
@Injectable({ providedIn: 'root' })
export class UiState {
  readonly month = signal(currentMonth());
  readonly reportKind = signal<'month' | 'year'>('month');
  readonly reportYear = signal(String(new Date().getFullYear()));
  readonly cashflowKind = signal<'month' | 'year'>('month');
  readonly filters = signal<TxFilters>({ ...EMPTY_FILTERS });
  readonly txLimit = signal(150);
}
