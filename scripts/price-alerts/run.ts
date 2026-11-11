/**
 * Hourly price-alert check. Run by .github/workflows/price-alerts.yml (free GitHub Actions minutes).
 *
 * For every Ledgerline user with alerts: fetch gold, silver and currency prices, decide which
 * notifications are due (same code as the app: src/app/core/price-alerts.ts), send them by ntfy and/or
 * browser push (Firebase Cloud Messaging), and save what was sent so nothing is repeated.
 *
 * Env:
 *   FIREBASE_SERVICE_ACCOUNT  service-account JSON (GitHub secret)
 *   APP_URL                   link opened from a notification (default https://personal-ledger.web.app)
 *   DRY_RUN=1                 print what would be sent; send and save nothing
 */
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import {
  ALERT_DEFAULTS, AlertSettings, AlertState, FX_URL, METALS_URL, Notice, Quotes, evaluate, quotesFrom,
} from '../../src/app/core/price-alerts';

const APP_URL = (process.env['APP_URL'] || 'https://personal-ledger.web.app').replace(/\/$/, '');
const DRY = process.env['DRY_RUN'] === '1';

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'ledgerline-price-alerts' } });
  if (!r.ok) throw new Error(`${new URL(url).host} answered HTTP ${r.status}`);
  return r.json();
}

async function fetchQuotes(): Promise<Quotes> {
  const [metals, fx] = await Promise.allSettled([getJson(METALS_URL), getJson(FX_URL)]);
  const q = quotesFrom(metals.status === 'fulfilled' ? metals.value : null, fx.status === 'fulfilled' ? fx.value : null);
  if (metals.status === 'rejected') console.warn('Metal prices unavailable:', String(metals.reason));
  if (fx.status === 'rejected') console.warn('Exchange rates unavailable:', String(fx.reason));
  if (q.goldUsdG == null && Object.keys(q.usd).length <= 1) throw new Error('No prices available from any source.');
  return q;
}

async function sendNtfy(topic: string, n: Notice): Promise<void> {
  const r = await fetch('https://ntfy.sh/', {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, title: n.title, message: n.body, tags: n.tags, priority: n.priority === 'high' ? 4 : 3, click: `${APP_URL}/prices` }),
  });
  if (!r.ok) throw new Error(`ntfy answered HTTP ${r.status}`);
}

/** Sends to every device the person turned push on for; forgets devices that unsubscribed. */
async function sendPush(uid: string, n: Notice): Promise<number> {
  const db = getFirestore();
  const devices = await db.collection('users').doc(uid).collection('devices').get();
  let ok = 0;
  for (const d of devices.docs) {
    const token = d.get('token');
    if (typeof token !== 'string') continue;
    try {
      await getMessaging().send({
        token,
        webpush: {
          headers: { Urgency: n.priority === 'high' ? 'high' : 'normal', TTL: '43200' },
          data: { title: n.title, body: n.body, link: `${APP_URL}/prices` },
        },
      });
      ok++;
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token') || code.includes('invalid-argument')) {
        await d.ref.delete();
        console.log('Removed a device that no longer accepts notifications.');
      } else throw e;
    }
  }
  return ok;
}

async function main() {
  const raw = process.env['FIREBASE_SERVICE_ACCOUNT'];
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set. Add it as a GitHub Actions secret (see README).');
  initializeApp({ credential: cert(JSON.parse(raw)) });
  const db = getFirestore();
  const quotes = await fetchQuotes();
  const now = new Date();
  const users = await db.collection('users').listDocuments();
  let checked = 0, sent = 0;

  for (const user of users) {
    const ledger = user.collection('ledger');
    const snap = await ledger.doc('alerts').get();
    if (!snap.exists) continue;
    const s: AlertSettings = { ...ALERT_DEFAULTS, ...(snap.data() as Partial<AlertSettings>) };
    if (!s.alerts?.length) continue;
    checked++;
    const prevSnap = await ledger.doc('alertState').get();
    const prev = prevSnap.exists ? (prevSnap.data() as AlertState) : null;
    const { notices, state } = evaluate(s, prev, quotes, now);

    const errors: string[] = [];
    let delivered = 0;
    for (const n of notices) {
      if (DRY) { console.log(`[dry run] ${n.title}\n${n.body}`); delivered++; continue; }
      if (s.ntfy?.on && s.ntfy.topic) {
        try { await sendNtfy(s.ntfy.topic, n); delivered++; } catch (e) { errors.push(String(e)); }
      }
      if (s.push?.on) {
        try { delivered += (await sendPush(user.id, n)) ? 1 : 0; } catch (e) { errors.push(`push: ${String(e)}`); }
      }
    }
    sent += notices.length;
    if (!s.ntfy?.on && !s.push?.on && notices.length) errors.push('No notification method is turned on.');

    // If nothing could be delivered, keep the old rule state so the same alerts are tried again next hour.
    const save: AlertState = notices.length && !delivered && prev ? { ...prev, lastRun: state.lastRun } : state;
    save.quotes = quotes;
    if (errors.length) save.lastError = errors.slice(0, 3).join(' · ').slice(0, 500);
    else delete save.lastError;
    if (!DRY) await ledger.doc('alertState').set(save);
  }
  console.log(`Checked ${checked} user(s) with alerts; ${sent} notification(s) due.${DRY ? ' (dry run)' : ''}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
