/* Ledgerline price-alert notifications (Firebase Cloud Messaging, data-only web push).
   Registered by the app with scope /push/, separate from the Angular service worker. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = { data: { body: event.data && event.data.text() } }; }
  const m = d.data || d.notification || d;
  const title = m.title || 'Ledgerline';
  event.waitUntil(self.registration.showNotification(title, {
    body: m.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: title,
    data: { link: m.link || '/prices' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/prices';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) { await c.focus(); return; }
    }
    await self.clients.openWindow(link);
  })());
});
