// Service Worker — Hotel Antique Split PWA
// Handles push notifications for Concierge request updates

const CACHE_NAME = 'antique-split-v13';

self.addEventListener('install', (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      )
    ).then(() => clients.claim())
  );
});

// ── Push notification received ───────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data = {};
  try { data = event.data.json(); } catch { data = { body: event.data.text() }; }

  const title   = data.title || 'Hotel Antique Split';
  const options = {
    body:    data.body || 'Your request has been updated.',
    icon:    '/pwa/icons/icon-192.png',
    badge:   '/pwa/icons/icon-192.png',
    tag:     data.tag || 'concierge-update',
    data:    { url: data.url || '/pwa/' },
    vibrate: [200, 100, 200],
    actions: [
      { action: 'open', title: 'View' },
      { action: 'close', title: 'Dismiss' },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'close') return;

  const url = event.notification.data?.url || '/pwa/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const match = wins.find(w => w.url.includes('/pwa/'));
      if (match) return match.focus();
      return clients.openWindow(url);
    })
  );
});
