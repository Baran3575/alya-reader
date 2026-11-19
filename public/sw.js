// Çevrimdışı önbellek: kabuk dosyaları + cilt JSON paketleri + illüstrasyonlar + sayfa görselleri.
// Hem kök dizinde (localhost) hem de GitHub Pages alt yolunda (/alya-reader/) çalışır.
const VERSION = 'alya-v4';
const SHELL_REL = ['./', './index.html', './style.css', './app.js', './bundle.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL_REL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const scopePath = new URL(self.registration.scope).pathname;
  const relPath = url.pathname.startsWith(scopePath)
    ? url.pathname.slice(scopePath.length)
    : url.pathname.replace(/^\/+/, '');

  // Cilt paketleri, illüstrasyonlar ve sayfa görselleri: önce önbellek, yoksa ağ (ve önbelleğe yaz)
  const cacheFirst =
    relPath.startsWith('art/') ||
    /^pages[^/]*\//.test(relPath) ||
    /^volumes\/[^/]+\.json$/.test(relPath) ||
    relPath === 'api/book' ||
    relPath === 'api/catalog' ||
    relPath === 'bundle.js';

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
            .catch(() => hit)
      )
    );
    return;
  }

  // Kabuk dosyaları: önce ağ, düşerse çevrimdışı önbellek
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
