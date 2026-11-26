const CACHE_NAME = 'wop-flash-sync-v12';
const APP_ASSETS = [
  './',
  './index.html',
  './styles.css?v=12',
  './manifest.webmanifest',
  './favicon.ico',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/apple-touch-icon.png',
  './assets/conquest-vhp-gmt-diagram.svg',
  './assets/conquest-vhp-gmt-diagram-pl.svg',
  './assets/hdr-white.png',
  './js/app.js?v=12',
  './js/wop-protocol.js?v=12',
  './js/timezone-utils.js?v=12',
  './js/flash-driver.js?v=12',
  './js/feedback.js?v=12',
  './js/time-sync.js?v=12',
  './js/i18n.js?v=12',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          APP_ASSETS.map((asset) =>
            fetch(new Request(asset, { cache: 'no-cache' })).then((res) => {
              if (res && res.ok) {
                return cache.put(asset, res);
              }
              return undefined;
            }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only cache same-origin app assets; let external time-sync requests hit network directly
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then((networkRes) => {
        if (networkRes && networkRes.ok) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return networkRes;
      })
      .catch(() =>
        caches
          .match(request, { ignoreSearch: true })
          .then((cached) => cached || caches.match('./index.html')),
      ),
  );
});
