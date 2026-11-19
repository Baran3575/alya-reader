// Çevrimdışı önbellek: kabuk dosyaları + sayfa görselleri (tüm ciltler 4–12) + kitap verisi.
// Sunucu kapalıyken veya GitHub Pages üzerinde çevrimdışı okuma sağlar.
const VERSION = 'alya-v5';
const SHELL = ['./', './index.html', './style.css', './app.js', './bundle.js', './bundle-art.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()),
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

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // görseller ve kitap verisi (tüm /pages*/ önekleri ve /books/*.json dahil): önce önbellek, sonra ağ
  const cacheFirst =
    /\/pages[^/]*\//.test(url.pathname) ||
    /\/books\/(?:[0-9.]+|volumes)\.json$/.test(url.pathname) ||
    url.pathname.endsWith('/api/book') ||
    url.pathname.endsWith('/api/volumes') ||
    url.pathname.endsWith('/bundle.js') ||
    url.pathname.endsWith('/bundle-art.js');

  if (cacheFirst) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req)
            .then((res) => {
              if (res && res.ok) {
                const copy = res.clone();
                caches.open(VERSION).then((c) => c.put(req, copy));
              }
              return res;
            })
            .catch(() => hit),
      ),
    );
    return;
  }

  // kabuk: önce ağ, düşerse önbellek (yalnız gezinti isteklerinde index.html yedeklemesi)
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
        caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())),
      ),
  );
});
