import { Injectable, signal } from '@angular/core';
import { FirebaseApp, initializeApp } from 'firebase/app';
import {
  Auth, GoogleAuthProvider, browserLocalPersistence, connectAuthEmulator, getAuth, getRedirectResult,
  onAuthStateChanged, setPersistence, signInWithPopup, signInWithRedirect, signOut,
} from 'firebase/auth';
import {
  Firestore, clearIndexedDbPersistence, collection, getDoc, getDocFromServer, connectFirestoreEmulator, deleteDoc, doc, initializeFirestore, onSnapshot,
  persistentLocalCache, persistentMultipleTabManager, setDoc, terminate,
} from 'firebase/firestore';
import { AppCheck, ReCaptchaEnterpriseProvider, getToken, initializeAppCheck } from 'firebase/app-check';
import { aiConfig, firebaseConfig, useEmulators } from '../../environments/firebase.config';
import { MarketRates, Plan, Settings, Transaction } from '../core/models';
import { AppUser, Backend, DocRef, LedgerSnapshot, SubscribeHandlers } from './backend';

@Injectable()
export class FirebaseBackend extends Backend {
  readonly mode = 'firebase' as const;
  readonly user = signal<AppUser | null | undefined>(undefined);
  readonly app: FirebaseApp;
  private readonly auth: Auth;
  private readonly db: Firestore;
  private appCheck: AppCheck | null = null;

  constructor() {
    super();
    this.app = initializeApp(firebaseConfig);
    if (aiConfig.appCheckSiteKey) {
      this.appCheck = initializeAppCheck(this.app, { provider: new ReCaptchaEnterpriseProvider(aiConfig.appCheckSiteKey), isTokenAutoRefreshEnabled: true });
    }
    this.auth = getAuth(this.app);
    // Offline cache: the app opens instantly and works without a connection; writes sync when back online.
    this.db = initializeFirestore(this.app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
    if (useEmulators) {
      connectAuthEmulator(this.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(this.db, '127.0.0.1', 8080);
    }
    setPersistence(this.auth, browserLocalPersistence).catch(() => undefined);
    getRedirectResult(this.auth).catch(() => undefined);
    onAuthStateChanged(this.auth, (u) =>
      this.user.set(u ? { uid: u.uid, name: u.displayName ?? '', email: u.email ?? '', photoURL: u.photoURL } : null),
    );
  }

  /** Connection check shown in Setup: App Check token and a direct server read, each with the exact error. */
  async diagnose(): Promise<{ name: string; ok: boolean; detail: string }[]> {
    const out: { name: string; ok: boolean; detail: string }[] = [];
    const t0 = performance.now();
    if (!this.appCheck) out.push({ name: 'App Check', ok: false, detail: 'Not configured (no site key in firebase.config.ts).' });
    else {
      try {
        const r = await within(getToken(this.appCheck, true), 20000, 'No token after 20 s (reCAPTCHA did not answer).');
        out.push({ name: 'App Check', ok: true, detail: `Token received in ${Math.round(performance.now() - t0)} ms.` });
        void r;
      } catch (e) {
        out.push({ name: 'App Check', ok: false, detail: describe(e) });
      }
    }
    // What the browser actually did with reCAPTCHA, to tell a blocked script from a key problem.
    const g = (window as unknown as { grecaptcha?: { enterprise?: Record<string, unknown> } }).grecaptcha;
    const res = performance.getEntriesByType('resource').filter((r) => /recaptcha/.test(r.name)).map((r) => r.name.replace(/^https:\/\//, '').split('?')[0].slice(0, 70));
    const csp = (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [];
    out.push({
      name: 'reCAPTCHA details',
      ok: typeof g?.enterprise?.['execute'] === 'function' && !csp.length,
      detail: [
        `script ready: ${typeof g?.enterprise?.['execute'] === 'function' ? 'yes' : g ? 'loader only' : 'no'}`,
        `frames: ${document.querySelectorAll('iframe[src*="recaptcha"]').length}`,
        `loaded: ${res.join(', ') || 'nothing'}`,
        `blocked by CSP: ${csp.join('; ') || 'nothing'}`,
        `browser: ${navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 90)}`,
      ].join(' · '),
    });
    const uid = this.user()?.uid;
    if (!uid) out.push({ name: 'Database', ok: false, detail: 'Not signed in.' });
    else {
      const t1 = performance.now();
      try {
        const snap = await within(getDocFromServer(doc(this.db, 'users', uid, 'ledger', 'settings')), 20000, 'No answer from Firestore after 20 s.');
        out.push({ name: 'Database', ok: true, detail: `Server answered in ${Math.round(performance.now() - t1)} ms (${snap.exists() ? 'settings found' : 'no settings yet'}). Signed in as ${this.user()?.email}.` });
      } catch (e) {
        out.push({ name: 'Database', ok: false, detail: describe(e) + ` Signed in as ${this.user()?.email}.` });
      }
    }
    return out;
  }

  async signIn(): Promise<void> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(this.auth, provider);
    } catch (e: unknown) {
      const code = (e as { code?: string }).code ?? '';
      // Popups are often blocked in installed (home-screen) apps and some mobile browsers.
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(this.auth, provider);
        return;
      }
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      throw e;
    }
  }

  /** Signs out and wipes this device's offline copy of the data. */
  async signOut(): Promise<void> {
    await signOut(this.auth);
    try {
      await terminate(this.db);
      await clearIndexedDbPersistence(this.db);
    } finally {
      location.assign('/sign-in');
    }
  }

  subscribe(uid: string, h: SubscribeHandlers): () => void {
    const state: LedgerSnapshot = { settings: null, plan: null, market: null, months: {}, fromServer: false };
    let ledgerServer = false, monthsServer = false, ledgerSeen = false, monthsSeen = false;
    const emit = () => {
      if (!ledgerSeen || !monthsSeen) return;
      h.next({ ...state, months: { ...state.months }, fromServer: ledgerServer && monthsServer });
    };
    const fail = (e: { code?: string }) =>
      h.error(e.code === 'permission-denied' ? `This Google account (${this.user()?.email ?? 'unknown'}) isn't allowed to use this app. Sign out and use an allowed account.` : 'Live updates stopped. Reload to reconnect.');

    const unLedger = onSnapshot(collection(this.db, 'users', uid, 'ledger'), { includeMetadataChanges: true }, (snap) => {
      state.settings = null; state.plan = null; state.market = null;
      snap.docs.forEach((d) => {
        if (d.id === 'settings') state.settings = d.data() as Settings;
        else if (d.id === 'plan') state.plan = d.data() as Plan;
        else if (d.id === 'market') state.market = d.data() as MarketRates;
      });
      ledgerSeen = true;
      ledgerServer = !snap.metadata.fromCache;
      emit();
    }, fail);

    const unMonths = onSnapshot(collection(this.db, 'users', uid, 'months'), { includeMetadataChanges: true }, (snap) => {
      const months: Record<string, Transaction[]> = {};
      snap.docs.forEach((d) => {
        const items = d.data()['items'];
        if (Array.isArray(items)) months[d.id] = items as Transaction[];
      });
      state.months = months;
      monthsSeen = true;
      monthsServer = !snap.metadata.fromCache;
      emit();
    }, fail);

    return () => { unLedger(); unMonths(); };
  }

  write(uid: string, ref: DocRef, data: object): Promise<void> {
    return setDoc(this.docRef(uid, ref), stripUndefined(data));
  }

  remove(uid: string, ref: DocRef): Promise<void> {
    return deleteDoc(this.docRef(uid, ref));
  }

  async get<T>(uid: string, ref: DocRef): Promise<T | null> {
    const snap = await getDoc(this.docRef(uid, ref));
    return snap.exists() ? (snap.data() as T) : null;
  }

  private docRef(uid: string, ref: DocRef) {
    const coll = ref.kind === 'ledger' ? 'ledger' : ref.kind === 'month' ? 'months' : 'receipts';
    return doc(this.db, 'users', uid, coll, ref.id);
  }
}

function within<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export function describe(e: unknown): string {
  const err = e as { code?: string; message?: string; customData?: { httpStatus?: number } };
  return [err?.code, err?.message].filter(Boolean).join(': ').slice(0, 300) || String(e);
}

/** Firestore rejects `undefined` field values. */
function stripUndefined<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
