/* Renewals service worker. Network first, falls back to the saved copy when offline. */
const CACHE = 'renewals-v1';
const SDK = 'renewals-sdk';
const FILES = ['./', './index.html', './style.css', './app.js', './logic.js', './manifest.webmanifest', './firebase-config.js', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      // Only touch Renewals' own caches. Shelf, Musicbox, SavePoint and Libraries keep theirs.
      .then(keys => Promise.all(keys.filter(k => k.startsWith('renewals-') && k !== CACHE && k !== SDK).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  // The Firebase code files are versioned by their address, so a saved copy is safe to reuse. This lets the app open offline.
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith(caches.open(SDK).then(c => c.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }))));
    return;
  }
  if (url.origin !== location.origin) return;
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  e.respondWith(
    fetch(req, { cache: 'no-store' })
      .then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; })
      .catch(() => caches.match(req).then(m => m || caches.match('./index.html')))
  );
});
