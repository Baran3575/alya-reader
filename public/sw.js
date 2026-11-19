// Çevrimdışı önbellek: kabuk dosyaları + tembel cilt paketleri + WebP görseller.
// Hem kök dizinde (http://localhost:3000/) hem de GitHub Pages alt yollarında (/<repo>/) çalışır.
const VERSION = 'alya-v4';
const SHELL = ['./', 'index.html', 'style.css', 'bundles/manifest.js', 'app.js'];

function scopeUrl(rel) {
  return new URL(rel, self.registration.scope).href;
}

function scopeRelPath(url) {
  const scopePath = new URL('./', self.registration.scope).pathname;
  if (!url.pathname.startsWith(scopePath)) return null;
  return url.pathname.slice(scopePath.length);
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => Promise.all(SHELL.map((rel) => c.add(scopeUrl(rel)).catch(() => {}))))
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

  const rel = scopeRelPath(url);
  if (rel === null) return;

  // Cilt paketleri ve WebP görseller: önce önbellek, sonra ağ (ve önbelleğe yaz)
  const isManifest = rel === 'bundles/manifest.js';
  const cacheFirst =
    (!isManifest && rel.startsWith('bundles/')) ||
    rel.endsWith('.webp') ||
    /^pages[^/]*\//.test(rel) ||
    rel === 'api/book';

  if (cacheFirst) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req)
            .then((res) => {
              if (res && res.ok) {
                const copy = res.clone();
                caches.open(VERSION).then(async (c) => {
                  try {
                    if (rel.startsWith('bundles/book-') && url.search && typeof c.keys === 'function') {
                      const existing = await c.keys();
                      await Promise.all(
                        existing
                          .filter((k) => {
                            const ku = new URL(typeof k === 'string' ? k : k.url);
                            return ku.pathname === url.pathname && ku.href !== url.href;
                          })
                          .map((k) => c.delete(k)),
                      );
                    }
                    await c.put(req, copy);
                  } catch {}
                });
              }
              return res;
            })
            .catch(() => caches.match(req, { ignoreSearch: true })),
      ),
    );
    return;
  }

  // Kabuk ve manifest: önce ağ, düşerse önbellek
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy).catch(() => {}));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) => {
          if (hit) return hit;
          if (req.mode === 'navigate' || rel === '' || rel === 'index.html') {
            return caches.match(scopeUrl('index.html')).then((idx) => idx || caches.match(scopeUrl('./')));
          }
          return undefined;
        }),
      ),
  );
});
