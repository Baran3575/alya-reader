// Çevrimdışı önbellek: kabuk dosyaları + sayfa görselleri (tüm ciltler 4–12) + kitap verisi.
// Sunucu kapalıyken veya GitHub Pages üzerinde çevrimdışı okuma sağlar.
const VERSION = 'alya-v4';
const SHELL_REL = ['./', './index.html', './style.css', './app.js', './bundle.js', './bundle-art.js'];

function scopeUrl(rel) {
  const base = (self.registration && self.registration.scope) || self.location.href;
  return new URL(rel, base).toString();
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => Promise.all(SHELL_REL.map((p) => c.add(scopeUrl(p)).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function putAndPruneQuery(cache, req, res) {
  const target = new URL(req.url);
  if (target.search) {
    const keys = await cache.keys();
    for (const k of keys) {
      const ku = new URL(typeof k === 'string' ? k : k.url);
      if (ku.pathname === target.pathname && ku.search !== target.search) {
        await cache.delete(k);
      }
    }
  }
  await cache.put(req, res);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // görseller ve kitap verisi (Cilt 4–12 /pages*/ ve /books/{v,bundle-en-,art-}*.json dahil): önce önbellek, sonra ağ
  const cacheFirst =
    /\/pages\d*\//.test(url.pathname) ||
    /\/books\/(?:v|bundle-en-|art-)?[0-9.]+\.json$/.test(url.pathname) ||
    url.pathname.endsWith('/api/book') ||
    url.pathname.endsWith('/api/book-en');

  if (cacheFirst) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req)
            .then((res) => {
              if (res && res.ok) {
                const copy = res.clone();
                caches.open(VERSION).then((c) => putAndPruneQuery(c, req, copy));
              }
              return res;
            })
            .catch(() => caches.match(req, { ignoreSearch: true })),
      ),
    );
    return;
  }

  // kabuk ve manifest (bundle.js): önce ağ (güncel hash için), düşerse önbellek
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(req, { ignoreSearch: true })
          .then((hit) => hit || (req.mode === 'navigate' ? caches.match(scopeUrl('./index.html')) : undefined)),
      ),
  );
});
