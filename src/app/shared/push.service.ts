import { Injectable, inject, signal } from '@angular/core';
import { pushConfig } from '../../environments/firebase.config';
import { Backend } from '../data/backend';
import { FirebaseBackend } from '../data/firebase-backend';
import { LedgerStore } from '../state/ledger.store';

export type PushStatus = 'checking' | 'demo' | 'not-configured' | 'unsupported' | 'blocked' | 'off' | 'on';
const KEY = 'll.pushDevice';
const SCOPE = '/push/';

const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v: string | null) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ } };

/**
 * Browser push for price alerts (Firebase Cloud Messaging). Each browser that turns it on is saved
 * as a device under users/{uid}/devices; the hourly job sends to all of them.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly backend = inject(Backend);
  private readonly store = inject(LedgerStore);
  readonly status = signal<PushStatus>('checking');
  readonly error = signal('');

  get supported() {
    return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }
  /** iPhone/iPad Safari only allows web push for apps added to the Home Screen. */
  get needsHomeScreen() {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    return ios && !standalone;
  }

  check() {
    if (this.backend.mode === 'demo') return this.status.set('demo');
    if (!pushConfig.vapidKey) return this.status.set('not-configured');
    if (!this.supported) return this.status.set('unsupported');
    if (Notification.permission === 'denied') return this.status.set('blocked');
    this.status.set(Notification.permission === 'granted' && read() ? 'on' : 'off');
  }

  async enable() {
    this.error.set('');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return this.status.set(perm === 'denied' ? 'blocked' : 'off');
      const reg = await navigator.serviceWorker.register('/push-sw.js', { scope: SCOPE });
      await activated(reg);
      const { getMessaging, getToken } = await import('firebase/messaging');
      const token = await getToken(getMessaging((this.backend as FirebaseBackend).app), { vapidKey: pushConfig.vapidKey, serviceWorkerRegistration: reg });
      if (!token) throw new Error('No push token was issued.');
      const id = await shortHash(token);
      await this.store.saveDevice(id, { token, label: deviceLabel(), createdAt: new Date().toISOString() });
      write(id);
      if (!this.store.alertsView().push.on) await this.store.saveAlerts((a) => (a.push = { on: true }));
      this.status.set('on');
    } catch (e) {
      const err = e as { code?: string; message?: string };
      this.error.set(`Couldn't turn on notifications${err.code ? ` (${err.code})` : ''}: ${err.message ?? e}`);
      this.check();
    }
  }

  async disable() {
    this.error.set('');
    const id = read();
    try {
      const { deleteToken, getMessaging } = await import('firebase/messaging');
      await deleteToken(getMessaging((this.backend as FirebaseBackend).app)).catch(() => undefined);
      if (id) await this.store.removeDevice(id);
    } finally {
      write(null);
      this.status.set('off');
    }
  }

  /** Shows a notification on this device right away, to check the browser allows them. */
  async test() {
    const reg = await navigator.serviceWorker.getRegistration(SCOPE);
    if (!reg) return this.error.set('Turn notifications on first.');
    await reg.showNotification('Ledgerline', { body: 'Notifications work on this device. Price alerts will look like this.', icon: '/icons/icon-192.png' });
  }
}

function activated(reg: ServiceWorkerRegistration): Promise<void> {
  if (reg.active) return Promise.resolve();
  const sw = reg.installing ?? reg.waiting;
  return new Promise((resolve) => {
    if (!sw) return resolve();
    sw.addEventListener('statechange', () => sw.state === 'activated' && resolve());
    setTimeout(resolve, 8000);
  });
}

async function shortHash(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}
