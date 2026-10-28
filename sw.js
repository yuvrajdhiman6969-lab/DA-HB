// Bump this string whenever you push a new version of index.html
// so phones/laptops pick up the update instead of serving the old cache.
const CACHE_NAME = 'discipline-os-v9';
const CORE_FILES = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

/* v2 (important): this file used to delete EVERY cache on this site whose name was not CACHE_NAME. The Jarvis AI brain (about 1 GB) and the
   neural voice (about 90 MB) are stored by their libraries in caches of their own on the SAME site, so every time CACHE_NAME was bumped for
   an update the browser threw the model away and Jarvis had to download it all again. Now only this app's own old caches ("discipline-os-*")
   are cleaned up, and nothing else is ever touched. */
const OWN = /^discipline-os-/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => OWN.test(n) && n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

/* Which files get a copy kept for offline use:
   - this app's own scripts, styles, sounds and images (network first, so an update always wins when you are online)
   - the small, version-pinned Jarvis libraries on esm.run / cdn.jsdelivr.net (they never change, so cache first)
   The AI model weights are NOT touched here: they are huge and the AI library already keeps them in its own cache. */
const LIB_HOSTS = /^(esm\.run|cdn\.jsdelivr\.net|unpkg\.com)$/;
/* Finger mode: the ~8 MB hand-tracking model lives on Google's public MediaPipe bucket. Cache just that path, so Finger mode also starts offline. */
const MODEL_HOST = /^storage\.googleapis\.com$/, MODEL_PATH = '/mediapipe-models/';
const ASSET = /\.(?:js|css|mp3|wav|ogg|png|jpg|jpeg|svg|webp|woff2?|json)$/i;

function keep(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return response;
  const copy = response.clone();
  caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => { });
  return response;
}

// Network-first for navigation (so a real internet connection always gets
// the latest version); fall back to cache when offline.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }
  let url; try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin === self.location.origin && ASSET.test(url.pathname)) {
    event.respondWith(
      fetch(req).then((res) => keep(req, res)).catch(() => caches.match(req))
    );
    return;
  }
  if (LIB_HOSTS.test(url.hostname) || (MODEL_HOST.test(url.hostname) && url.pathname.indexOf(MODEL_PATH) === 0)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => keep(req, res)))
    );
    return;
  }
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
