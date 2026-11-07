import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { MarketRates } from '../core/models';
import { LedgerStore } from '../state/ledger.store';

const REFRESH_MS = 12 * 60 * 60 * 1000;

/**
 * Keeps reference exchange rates fresh (units per 1 USD).
 * Source 1: Frankfurter (European Central Bank reference rates, published each working day).
 * Source 2: ExchangeRate-API open access, used only for currencies the ECB doesn't publish (e.g. AED, LKR).
 * Rates are cached in the user's own ledger, so the app works offline with the last known rates.
 */
@Injectable({ providedIn: 'root' })
export class RatesService {
  private readonly store = inject(LedgerStore);
  readonly refreshing = signal(false);
  readonly lastError = signal('');

  constructor() {
    effect(() => {
      const ready = this.store.status() === 'ready' && this.store.confirmed() && !!this.store.settings();
      if (!ready) return;
      const market = this.store.market();
      const needed = this.store.finance().usedCurrencies();
      untracked(() => {
        const stale = !market || Date.now() - Date.parse(market.fetchedAt || '1970-01-01') > REFRESH_MS;
        const missing = needed.some((c) => !((market?.rates?.[c] ?? 0) > 0));
        if ((stale || missing) && !this.refreshing() && navigator.onLine !== false) void this.refresh(needed);
      });
    });
  }

  async refresh(currencies = this.store.finance().usedCurrencies()): Promise<boolean> {
    this.refreshing.set(true);
    this.lastError.set('');
    try {
      const rates: Record<string, number> = { USD: 1 };
      let asOf = '';
      const sources: string[] = [];
      try {
        const r = await fetch('https://api.frankfurter.dev/v1/latest?base=USD');
        if (r.ok) {
          const j = (await r.json()) as { date: string; rates: Record<string, number> };
          Object.assign(rates, j.rates);
          asOf = j.date;
          sources.push('European Central Bank via Frankfurter');
        }
      } catch { /* try the fallback */ }
      const missing = currencies.filter((c) => !(rates[c] > 0));
      if (missing.length || !asOf) {
        const r = await fetch('https://open.er-api.com/v6/latest/USD');
        if (r.ok) {
          const j = (await r.json()) as { result: string; time_last_update_utc: string; rates: Record<string, number> };
          if (j.result === 'success') {
            for (const c of Object.keys(j.rates)) if (!(rates[c] > 0)) rates[c] = j.rates[c];
            asOf ||= new Date(j.time_last_update_utc).toISOString().slice(0, 10);
            sources.push('ExchangeRate-API');
          }
        }
      }
      if (!asOf) throw new Error('No rate source answered');
      const m: MarketRates = { base: 'USD', asOf, fetchedAt: new Date().toISOString(), source: sources.join(' + '), rates };
      await this.store.saveMarket(m);
      return true;
    } catch {
      this.lastError.set("Couldn't fetch current rates. Using the last saved rates and any you've entered.");
      return false;
    } finally {
      this.refreshing.set(false);
    }
  }
}
