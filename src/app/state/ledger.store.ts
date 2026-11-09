import { computed, effect, inject, untracked } from '@angular/core';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { monthKey, todayISO } from '../core/dates';
import { defaultPlan, defaultSettings, normalizePlan, uid } from '../core/defaults';
import { Finance, nextOccurrence } from '../core/finance';
import { MarketRates, Plan, Settings, Transaction } from '../core/models';
import { Backend, ReceiptDoc } from '../data/backend';
import { ToastService } from '../shared/toast.service';

type Status = 'signed-out' | 'loading' | 'ready' | 'error';

interface LedgerState {
  status: Status;
  note: string;
  uid: string | null;
  settings: Settings | null;
  plan: Plan | null;
  market: MarketRates | null;
  months: Record<string, Transaction[]>;
  /** True once data has been confirmed by the server (not just the offline cache). */
  confirmed: boolean;
}

const initial: LedgerState = { status: 'signed-out', note: '', uid: null, settings: null, plan: null, market: null, months: {}, confirmed: false };

/** Fallback used only to render before settings exist; never written. */
const FALLBACK_SETTINGS = defaultSettings();

export const LedgerStore = signalStore(
  { providedIn: 'root' },
  withState(initial),
  withComputed((s) => {
    const transactions = computed(() => {
      const out: Transaction[] = [];
      for (const k in s.months()) out.push(...s.months()[k]);
      return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt ?? '').localeCompare(a.createdAt ?? '')));
    });
    const plan = computed(() => normalizePlan(s.plan()));
    const finance = computed(() => new Finance({ settings: s.settings() ?? FALLBACK_SETTINGS, plan: plan(), transactions: transactions(), market: s.market() }));
    return {
      transactions,
      planView: plan,
      settingsView: computed(() => s.settings() ?? FALLBACK_SETTINGS),
      finance,
      primary: computed(() => s.settings()?.primary ?? 'MYR'),
      needsOnboarding: computed(() => s.status() === 'ready' && s.confirmed() && !s.settings()),
    };
  }),
  withMethods((store, backend = inject(Backend), toast = inject(ToastService)) => {
    const queues = new Map<string, Promise<unknown>>();
    /** One write at a time per document, in order. */
    const enqueue = (key: string, run: () => Promise<void>) => {
      const p = (queues.get(key) ?? Promise.resolve()).then(run, run).catch((e: { code?: string }) => {
        toast.show(e?.code === 'permission-denied' ? 'That change was refused by the server.' : "Couldn't save just now. It will retry when you're back online.", 'error');
      });
      queues.set(key, p);
      return p;
    };
    const writeLedger = (id: 'settings' | 'plan' | 'market', data: object) => {
      const u = store.uid();
      if (!u) return Promise.resolve();
      return enqueue('ledger/' + id, () => backend.write(u, { kind: 'ledger', id }, data));
    };
    const writeMonth = (key: string) => {
      const u = store.uid();
      if (!u) return Promise.resolve();
      const items = store.months()[key] ?? [];
      return enqueue('months/' + key, () =>
        items.length ? backend.write(u, { kind: 'month', id: key }, { month: key, items }) : backend.remove(u, { kind: 'month', id: key }),
      );
    };

    const saveSettings = (mutate: (s: Settings) => void) => {
      const next = structuredClone(store.settingsView());
      mutate(next);
      next.updatedAt = new Date().toISOString();
      patchState(store, { settings: next });
      return writeLedger('settings', next);
    };
    const savePlan = (mutate: (p: Plan) => void) => {
      const next = structuredClone(store.planView());
      mutate(next);
      next.updatedAt = new Date().toISOString();
      patchState(store, { plan: next });
      return writeLedger('plan', next);
    };
    const saveMany = (list: Transaction[], removeFrom?: { id: string; date: string }) => {
      const months = { ...store.months() };
      const touched = new Set<string>();
      if (removeFrom) {
        const k = monthKey(removeFrom.date);
        months[k] = (months[k] ?? []).filter((t) => t.id !== removeFrom.id);
        touched.add(k);
      }
      for (const tx of list) {
        const k = monthKey(tx.date);
        const items = [...(months[k] ?? [])];
        const i = items.findIndex((t) => t.id === tx.id);
        if (i >= 0) items[i] = tx; else items.push(tx);
        months[k] = items;
        touched.add(k);
      }
      patchState(store, { months });
      return Promise.all([...touched].map(writeMonth));
    };

    const advanceRecurring = (rid: string, date: string) =>
      savePlan((p) => {
        const r = p.recurring.find((x) => x.id === rid);
        if (r && r.nextDate <= date) r.nextDate = nextOccurrence(r, date);
      });

    return {
      saveSettings,
      savePlan,
      saveMarket(m: MarketRates) {
        patchState(store, { market: m });
        return writeLedger('market', m);
      },
      createLedger(settings: Settings) {
        patchState(store, { settings, plan: defaultPlan() });
        return Promise.all([writeLedger('settings', settings), writeLedger('plan', defaultPlan())]);
      },
      saveTx(tx: Transaction, prevDate?: string) {
        const moved = prevDate && monthKey(prevDate) !== monthKey(tx.date) ? { id: tx.id, date: prevDate } : undefined;
        return saveMany([tx], moved);
      },
      saveManyTx: (list: Transaction[]) => saveMany(list),
      deleteTx(tx: Transaction) {
        const k = monthKey(tx.date);
        patchState(store, { months: { ...store.months(), [k]: (store.months()[k] ?? []).filter((t) => t.id !== tx.id) } });
        const u = store.uid();
        // Remove the receipt copy once no transaction points at it.
        if (u && tx.receiptId && !store.transactions().some((t) => t.receiptId === tx.receiptId)) {
          enqueue('receipts/' + tx.receiptId, () => backend.remove(u, { kind: 'receipt', id: tx.receiptId! }));
        }
        return writeMonth(k);
      },
      /** Removes every transaction from one CSV/batch import (used for "Undo this import"). */
      deleteImport(importId: string) {
        const months = { ...store.months() };
        const touched: string[] = [];
        let removed = 0;
        for (const [k, items] of Object.entries(months)) {
          const keep = items.filter((t) => t.importId !== importId);
          if (keep.length !== items.length) { removed += items.length - keep.length; months[k] = keep; touched.push(k); }
        }
        if (!touched.length) return Promise.resolve(0);
        patchState(store, { months });
        return Promise.all(touched.map(writeMonth)).then(() => removed);
      },
      saveReceipt(doc: ReceiptDoc) {
        const u = store.uid();
        if (!u) return Promise.resolve();
        return enqueue('receipts/' + doc.id, () => backend.write(u, { kind: 'receipt', id: doc.id }, doc));
      },
      getReceipt(id: string): Promise<ReceiptDoc | null> {
        const u = store.uid();
        return u ? backend.get<ReceiptDoc>(u, { kind: 'receipt', id }) : Promise.resolve(null);
      },
      async deleteEverything() {
        const u = store.uid();
        if (!u) return;
        const keys = Object.keys(store.months());
        const receipts = [...new Set(store.transactions().map((t) => t.receiptId).filter((x): x is string => !!x))];
        patchState(store, { months: {}, settings: null, plan: null });
        await Promise.all([
          ...receipts.map((id) => backend.remove(u, { kind: 'receipt', id })),
          ...keys.map((k) => backend.remove(u, { kind: 'month', id: k })),
          backend.remove(u, { kind: 'ledger', id: 'plan' }),
          backend.remove(u, { kind: 'ledger', id: 'settings' }),
        ]);
      },
      advanceRecurring,
      postRecurring(rid: string, date: string) {
        const r = store.planView().recurring.find((x) => x.id === rid);
        if (!r) return;
        if (!store.transactions().some((t) => t.recurringId === rid && t.date === date)) {
          saveMany([{ id: uid(), type: r.type, amount: r.amount, currency: r.currency, date, categoryId: r.categoryId, accountId: r.accountId, notes: r.name, recurringId: r.id, createdAt: new Date().toISOString() }]);
        }
        advanceRecurring(rid, date);
      },
      /** Record scheduled items marked "record automatically" whose date has passed. */
      autoPostRecurring() {
        const due = store.finance().dueRecurring(todayISO()).filter((d) => d.r.autoPost);
        if (!due.length) return 0;
        const existing = new Set(store.transactions().map((t) => `${t.recurringId}|${t.date}`));
        const txs: Transaction[] = [];
        const nextDates: Record<string, string> = {};
        for (const d of due) {
          if (!existing.has(`${d.r.id}|${d.date}`))
            txs.push({ id: uid(), type: d.r.type, amount: d.r.amount, currency: d.r.currency, date: d.date, categoryId: d.r.categoryId, accountId: d.r.accountId, notes: d.r.name, recurringId: d.r.id, createdAt: new Date().toISOString() });
          nextDates[d.r.id] = nextOccurrence(d.r, d.date);
        }
        if (txs.length) saveMany(txs);
        savePlan((p) => p.recurring.forEach((r) => { if (nextDates[r.id] && r.nextDate < nextDates[r.id]) r.nextDate = nextDates[r.id]; }));
        return txs.length;
      },
    };
  }),
  withHooks({
    onInit(store, backend = inject(Backend)) {
      let unsubscribe: (() => void) | null = null;
      let slowTimer: ReturnType<typeof setTimeout> | undefined;
      let autoPosted = false;
      effect(() => {
        const user = backend.user();
        untracked(() => {
          unsubscribe?.();
          unsubscribe = null;
          clearTimeout(slowTimer);
          if (!user) {
            patchState(store, { ...initial, status: user === undefined ? 'loading' : 'signed-out' });
            return;
          }
          patchState(store, { ...initial, status: 'loading', uid: user.uid });
          slowTimer = setTimeout(() => {
            if (!store.confirmed()) patchState(store, { note: "Can't reach the server yet. Showing what's saved on this device; changes sync when you're back online." });
          }, 10000);
          unsubscribe = backend.subscribe(user.uid, {
            next: (snap) => {
              patchState(store, {
                status: 'ready', settings: snap.settings, plan: snap.plan, market: snap.market, months: snap.months,
                confirmed: store.confirmed() || snap.fromServer, note: snap.fromServer ? '' : store.note(),
              });
              if (snap.fromServer) clearTimeout(slowTimer);
              if (snap.fromServer && snap.settings && !autoPosted) {
                autoPosted = true;
                setTimeout(() => store.autoPostRecurring(), 300);
              }
            },
            error: (message) => {
              clearTimeout(slowTimer); // keep the real error visible instead of the generic "can't reach" note
              patchState(store, { status: store.settings() ? 'ready' : 'error', note: message });
            },
          });
        });
      });
    },
  }),
);
