// Çevrimdışı önbellek: kabuk dosyaları + gömülü illüstrasyon paketi + kitap verisi.
// GitHub Pages alt dizini (/alya-reader/) ve yerel kök dizin altında self.registration.scope ile çalışır.
const VERSION = 'alya-27bfa1f73fb3';
const SHELL = ['./', './index.html', './style.css', './app.js', './bundle.js', './bundle-art.js'];

function scopeBase() {
  return (self.registration && self.registration.scope) || new URL('./', self.location.href).href;
}

function scopeUrl(rel) {
  return new URL(rel, scopeBase()).href;
}

function scopePathname() {
  const p = new URL(scopeBase()).pathname;
  return p.endsWith('/') ? p : p + '/';
}

self.addEventListener('install', (e) => {
  const shellUrls = SHELL.map((rel) => scopeUrl(rel));
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(shellUrls))
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

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const basePath = scopePathname();
  if (!url.pathname.startsWith(basePath)) return;
  const relPath = url.pathname.slice(basePath.length);

  // görseller, gömülü paketler ve kitap verisi: önce önbellek, sonra ağ (ve önbelleğe yaz)
  const cacheFirst =
    relPath.startsWith('pages/') ||
    relPath.startsWith('pages45/') ||
    relPath === 'api/book' ||
    relPath === 'bundle.js' ||
    relPath === 'bundle-art.js';

  if (cacheFirst) {
    e.respondWith(
      caches.open(VERSION).then((cache) =>
        cache.match(req).then(
          (hit) =>
            hit ||
            fetch(req)
              .then((res) => {
                if (res && res.ok) {
                  cache.put(req, res.clone());
                }
                return res;
              })
              .catch(() => hit || (typeof Response !== 'undefined' ? Response.error() : undefined)),
        ),
      ),
    );
    return;
  }

  // kabuk: önce ağ, düşerse önbellek veya gezinme isteklerinde ./index.html
  const fallbackIndex = scopeUrl('./index.html');
  const isDocRequest = req.mode === 'navigate' || relPath === '' || relPath === 'index.html';
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
        caches.open(VERSION).then((cache) =>
          cache.match(req).then((hit) => {
            if (hit) return hit;
            if (isDocRequest) return cache.match(fallbackIndex);
            return typeof Response !== 'undefined' ? Response.error() : undefined;
          }),
        ),
      ),
  );
});
