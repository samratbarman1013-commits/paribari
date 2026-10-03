/* PariBari service worker — offline shell for the static assets only.
   Data always comes live from Supabase, so API calls are never cached. */
const CACHE = 'paribari-v3';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './config.js', './supabase.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{})));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // never cache backend / CDN calls — always go to the network
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{});
      return res;
    }).catch(() => cached))
  );
});
