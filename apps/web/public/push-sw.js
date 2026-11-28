/* global self */
/*
 * Pactlab's service worker (T-146): notifications only. It caches nothing and handles no fetches.
 * A push carries fixed, content-free words (the shared "Pactlab:" template); a click opens the inbox,
 * which asks for sign-in. Only same-origin paths are ever opened.
 */
const FALLBACK = { title: 'Pactlab', body: 'Pactlab: A pact needs you. Open Pactlab to see what.', url: '/notifications', icon: '/brand/apple-touch-icon.png', badge: '/brand/favicon-32.png', tag: 'pactlab-act-now' };

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data;
  try {
    data = { ...FALLBACK, ...(event.data ? event.data.json() : {}) };
  } catch {
    data = FALLBACK;
  }
  const url = typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : FALLBACK.url;
  // Every push shows a notification (browsers require pushes to be visible).
  event.waitUntil(self.registration.showNotification(String(data.title), { body: String(data.body), icon: data.icon, badge: data.badge, tag: data.tag, renotify: true, data: { url } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data && event.notification.data.url ? event.notification.data.url : FALLBACK.url, self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === target.origin && 'focus' in client) return client.navigate(target.href).then((opened) => (opened || client).focus());
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
