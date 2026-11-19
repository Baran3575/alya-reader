// Çevrimdışı önbellek: kabuk dosyaları + sayfa görselleri (tüm ciltler 4–12) + cilt bazlı kitap verisi.
// Hem kök dizinde (/) hem de GitHub Pages alt-dizininde (/alya-reader/) çalışır.
const VERSION = 'alya-v5';
const SHELL_REL = ['./', 'index.html', 'style.css', 'app.js', 'bundle-art.js', 'books/index.json'];

function scopeUrl(rel) {
  return new URL(rel, self.registration.scope).href;
}

function relativeToScope(url) {
  const scopePath = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scopePath)) return null;
  return url.pathname.slice(scopePath.length);
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL_REL.map(scopeUrl)).catch(() => {}))
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

  const rel = relativeToScope(url);
  if (rel === null) return;

  // görseller (Cilt 4–12 pages*/) ve cilt paketleri (books/index.json hariç): önce önbellek, sonra ağ
  const cacheFirst =
    /^pages\d*\//.test(rel) ||
    (/^books\/[0-9.]+\.json$/.test(rel) && rel !== 'books/index.json') ||
    rel === 'api/book' ||
    rel === 'bundle.js' ||
    rel === 'bundle-art.js';

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

  // kabuk ve manifest: önce ağ, düşerse önbellek
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match(scopeUrl('index.html')))),
  );
});
