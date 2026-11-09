import { Injectable, signal } from '@angular/core';
import { FirebaseApp, initializeApp } from 'firebase/app';
import {
  Auth, GoogleAuthProvider, browserLocalPersistence, connectAuthEmulator, getAuth, getRedirectResult,
  onAuthStateChanged, setPersistence, signInWithPopup, signInWithRedirect, signOut,
} from 'firebase/auth';
import {
  Firestore, clearIndexedDbPersistence, collection, getDoc, connectFirestoreEmulator, deleteDoc, doc, initializeFirestore, onSnapshot,
  persistentLocalCache, persistentMultipleTabManager, setDoc, terminate,
} from 'firebase/firestore';
import { ReCaptchaV3Provider, initializeAppCheck } from 'firebase/app-check';
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

  constructor() {
    super();
    this.app = initializeApp(firebaseConfig);
    if (aiConfig.appCheckSiteKey) {
      initializeAppCheck(this.app, { provider: new ReCaptchaV3Provider(aiConfig.appCheckSiteKey), isTokenAutoRefreshEnabled: true });
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

/** Firestore rejects `undefined` field values. */
function stripUndefined<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
