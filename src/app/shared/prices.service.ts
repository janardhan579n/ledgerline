import { Injectable, inject, signal } from '@angular/core';
import { FX_URL, METALS_URL, Quotes, quotesFrom } from '../core/price-alerts';
import { LedgerStore } from '../state/ledger.store';

/** Live gold, silver and exchange rates for the Price alerts page (cached for 10 minutes). */
@Injectable({ providedIn: 'root' })
export class PricesService {
  private readonly store = inject(LedgerStore);
  readonly quotes = signal<Quotes | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  private at = 0;

  async load(force = false) {
    if (!force && this.quotes() && Date.now() - this.at < 600_000) return;
    this.loading.set(true);
    this.error.set('');
    const get = (u: string) => fetch(u, { signal: AbortSignal.timeout(15_000) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))));
    const [m, f] = await Promise.allSettled([get(METALS_URL), get(FX_URL)]);
    const q = quotesFrom(m.status === 'fulfilled' ? m.value : null, f.status === 'fulfilled' ? f.value : null);
    const saved = this.store.alertState()?.quotes ?? null;
    if (q.goldUsdG == null && saved) { q.goldUsdG = saved.goldUsdG; q.silverUsdG = saved.silverUsdG; }
    if (Object.keys(q.usd).length <= 1 && saved) q.usd = saved.usd;
    if (m.status === 'rejected' || f.status === 'rejected') this.error.set(saved ? 'Live prices are unavailable; showing the last prices the scheduler saw.' : "Couldn't load live prices right now.");
    this.quotes.set(q.goldUsdG == null && Object.keys(q.usd).length <= 1 ? null : q);
    this.at = Date.now();
    this.loading.set(false);
  }
}
