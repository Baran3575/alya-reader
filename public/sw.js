// Çevrimdışı önbellek: kabuk dosyaları + sayfa görselleri + kitap verisi.
// Sunucu kapalıyken de okuyucu açılır (daha önce bir kez açıldıysa).
const VERSION = 'alya-v4';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/bundle.js', '/bundle-art.js'];

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

  // görseller ve kitap verisi: önce önbellek, sonra ağ (ve önbelleğe yaz)
  const cacheFirst =
    /^\/pages[^/]*\//.test(url.pathname) ||
    url.pathname === '/api/book' ||
    url.pathname === '/bundle.js';

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

  // kabuk: önce ağ, düşerse önbellek
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
        caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/index.html') : Response.error())),
      ),
  );
});
