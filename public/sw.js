// Çevrimdışı önbellek: kabuk dosyaları + tembel yüklenen cilt JSON parçaları (TR + ayrı EN, Cilt 4–12) + WebP illüstrasyonlar.
// Sunucu veya ağ kapalıyken daha önce açılmış ciltler Cache Storage üzerinden okunur.
const VERSION = 'alya-v4';
const SHELL = ['./', './index.html', './style.css', './app.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL).catch(() => {}))
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

function scopeRelativePath(pathname) {
  try {
    const scopePath = new URL(self.registration.scope).pathname.replace(/\/$/, '');
    if (scopePath && pathname.startsWith(scopePath)) {
      return pathname.slice(scopePath.length) || '/';
    }
  } catch {}
  return pathname;
}

function putAndPruneSamePath(cache, req, res) {
  return cache
    .keys()
    .then((keys) => {
      const ru = new URL(req.url);
      return Promise.all(
        keys
          .filter((k) => {
            try {
              const ku = new URL(k.url);
              return ku.pathname === ru.pathname && ku.search !== ru.search;
            } catch {
              return false;
            }
          })
          .map((k) => cache.delete(k)),
      );
    })
    .then(() => cache.put(req, res));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const relPath = scopeRelativePath(url.pathname);

  // manifest.json ve /api/volumes: önce ağ, düşerse önbellek (yeni cilt/hash güncellemeleri için)
  if (relPath === '/bundles/manifest.json' || relPath === '/api/volumes') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
            return res;
          }
          return caches.match(req).then((hit) => hit || res);
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error())),
    );
    return;
  }

  // cilt JSON parçaları (vol-* ve bundle-en-*), bağımsız illüstrasyonlar ve sayfa görselleri: önce önbellek, sonra ağ
  const isBundleChunk = /^\/bundles\/(vol|bundle-en)-[^/]+\.json$/.test(relPath);
  const cacheFirst =
    isBundleChunk ||
    relPath.startsWith('/art/') ||
    /^\/pages[^/]*\//.test(relPath) ||
    /^\/books\/[0-9.]+\.json$/.test(relPath) ||
    relPath === '/api/book' ||
    relPath === '/api/book-en';

  if (cacheFirst) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req)
            .then((res) => {
              if (res && res.ok) {
                const copy = res.clone();
                caches
                  .open(VERSION)
                  .then((c) => (isBundleChunk ? putAndPruneSamePath(c, req, copy) : c.put(req, copy)));
              }
              return res;
            })
            .catch(() =>
              caches.match(req, { ignoreSearch: true }).then((fallback) => fallback || Response.error()),
            ),
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
          return res;
        }
        return caches.match(req).then((hit) => hit || res);
      })
      .catch(() =>
        caches
          .match(req)
          .then((hit) => hit || caches.match('./index.html'))
          .then((hit) => hit || Response.error()),
      ),
  );
});
