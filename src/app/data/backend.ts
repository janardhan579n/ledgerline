import { Signal } from '@angular/core';
import { MarketRates, Plan, Settings, Transaction } from '../core/models';
import { AlertSettings, AlertState } from '../core/price-alerts';

export interface AppUser {
  uid: string;
  name: string;
  email: string;
  photoURL?: string | null;
}

/** Where each piece of a user's ledger is stored. Everything lives under users/{uid}/. */
export type DocRef =
  | { kind: 'ledger'; id: 'settings' | 'plan' | 'market' | 'alerts' }
  | { kind: 'device'; id: string } // a browser that receives push notifications: { token, label, createdAt }
  | { kind: 'month'; id: string } // YYYY-MM, holds { month, items: Transaction[] }
  | { kind: 'receipt'; id: string }; // a stored copy of a scanned receipt (ReceiptDoc)

/** A small copy of an uploaded receipt or payslip, kept with its transactions. */
export interface ReceiptDoc {
  id: string;
  name: string;
  mime: string;
  /** base64, no data: prefix */
  data: string;
  size: number;
  createdAt: string;
}

export interface LedgerSnapshot {
  settings: Settings | null;
  plan: Plan | null;
  market: MarketRates | null;
  /** Price alerts set up by the person, and what the hourly job last did with them (read-only here). */
  alerts: AlertSettings | null;
  alertState: AlertState | null;
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
  /** One-off read of a document that isn't part of the live snapshot (receipt copies). */
  abstract get<T = unknown>(uid: string, ref: DocRef): Promise<T | null>;
}
