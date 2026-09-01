/* Runner OS service worker — minimal, installability only. No data sync.
   V1 deliberately avoids offline-first synchronization; this SW just satisfies
   PWA install criteria and lets the app shell load fast. */
const CACHE = 'runneros-shell-v1';
const SHELL = ['/today', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Network-first for navigations; never cache API responses (authoritative server).
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return; // let API pass straight through
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/today')));
  }
});
