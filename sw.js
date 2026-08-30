// Minimal service worker — exists solely to satisfy Chrome/Android's PWA
// installability criteria (manifest + registered SW with a fetch handler)
// so "Add to Home screen" surfaces as an automatic install prompt.
//
// Deliberately does NOT cache or intercept anything: this app is fully
// dynamic (Supabase auth/data/realtime), and any offline-caching strategy
// here risks serving stale data or breaking auth token refresh. Every
// fetch is passed straight through to the network, unmodified.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
