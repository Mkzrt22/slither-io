/**
 * sw.js — Service worker for offline play (Lucky Dungeon Tycoon).
 *
 * Strategy: stale-while-revalidate over same-origin GETs. Every asset the
 * game touches lands in the runtime cache on first visit, so the app shell
 * keeps working with no network; fresh copies are fetched in the background
 * and used on the next load. Bump CACHE_NAME to invalidate after a deploy
 * of breaking asset changes.
 */

const CACHE_NAME = 'ldt-shell-v9';
const PRECACHE = ['./', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const refresh = fetch(request)
        .then((response) => {
          if (response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? refresh;
    }),
  );
});
