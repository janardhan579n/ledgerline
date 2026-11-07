import { Signal } from '@angular/core';
import { MarketRates, Plan, Settings, Transaction } from '../core/models';

export interface AppUser {
  uid: string;
  name: string;
  email: string;
  photoURL?: string | null;
}

/** Where each piece of a user's ledger is stored. Everything lives under users/{uid}/. */
export type DocRef =
  | { kind: 'ledger'; id: 'settings' | 'plan' | 'market' }
  | { kind: 'month'; id: string }; // YYYY-MM, holds { month, items: Transaction[] }

export interface LedgerSnapshot {
  settings: Settings | null;
  plan: Plan | null;
  market: MarketRates | null;
  months: Record<string, Transaction[]>;
  /** False while showing cached data the server hasn't confirmed yet. */
  fromServer: boolean;
}

export interface SubscribeHandlers {
  next: (snap: LedgerSnapshot) => void;
  error: (message: string) => void;
}

/**
 * Storage + sign-in. FirebaseBackend is the real one; DemoBackend keeps data in memory so the
 * app can be tried (and tested) before a Firebase project exists.
 */
export abstract class Backend {
  abstract readonly mode: 'firebase' | 'demo';
  /** undefined while the sign-in state is being restored, null when signed out. */
  abstract readonly user: Signal<AppUser | null | undefined>;
  abstract signIn(): Promise<void>;
  abstract signOut(): Promise<void>;
  abstract subscribe(uid: string, h: SubscribeHandlers): () => void;
  abstract write(uid: string, ref: DocRef, data: object): Promise<void>;
  abstract remove(uid: string, ref: DocRef): Promise<void>;
}
