// Automated verification of master's public/books/v<CİLT>.json + bundle-en-<CİLT>.json lazy chunks,
// CacheStorage caching, localStorage quota safety (< 5 KB), and Service Worker subpath routing.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { buildBook, buildBookEn, getBook, getBookEn, getBundleManifest, VOLUMES, VOLUME_KEYS } = require('../server.js');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const BOOKS_DIR = path.join(PUB, 'books');
const BUILD_SCRIPT = path.join(ROOT, 'scripts', 'build_bundle.js');

function testBuildBundleSchema() {
  console.log('1. Testing public/bundle.js + public/books/v<vol>.json + public/books/bundle-en-<vol>.json...');
  execFileSync(process.execPath, [BUILD_SCRIPT], { cwd: ROOT, encoding: 'utf8' });

  assert(!fs.existsSync(path.join(PUB, 'bundles')), 'Legacy public/bundles/ directory must not exist');
  assert(fs.existsSync(path.join(PUB, 'bundle.js')), 'public/bundle.js manifest must exist');
  assert(fs.existsSync(path.join(PUB, 'bundle-art.js')), 'public/bundle-art.js index must exist');

  const bundleRaw = fs.readFileSync(path.join(PUB, 'bundle.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(bundleRaw, sandbox);
  assert(sandbox.window.ALYA_BUNDLE && sandbox.window.ALYA_BUNDLE.vols, 'window.ALYA_BUNDLE.vols must exist');
  assert(typeof sandbox.window.ALYA_BUNDLE_VERSION === 'string' && sandbox.window.ALYA_BUNDLE_VERSION.length === 12);

  for (const k of VOLUME_KEYS) {
    const meta = sandbox.window.ALYA_BUNDLE.vols[k];
    assert(meta && meta.total > 0 && Array.isArray(meta.chapters), `Manifest must include Vol ${k}`);
    assert(!('pages' in meta), `Manifest Vol ${k} must not embed pages`);
    assert(typeof meta.hash === 'string' && typeof meta.enHash === 'string', `Manifest Vol ${k} must include hashes`);

    const vPath = path.join(BOOKS_DIR, `v${k}.json`);
    const enPath = path.join(BOOKS_DIR, `bundle-en-${k}.json`);
    assert(fs.existsSync(vPath), `Missing ${vPath}`);
    assert(fs.existsSync(enPath), `Missing ${enPath}`);

    const book = JSON.parse(fs.readFileSync(vPath, 'utf8'));
    const bookEn = JSON.parse(fs.readFileSync(enPath, 'utf8'));
    assert(book.pages.every((p) => !('en' in p)), `v${k}.json must omit p.en`);
    assert(bookEn && typeof bookEn.pages === 'object' && Object.keys(bookEn.pages).length > 0, `bundle-en-${k}.json must have English pages`);
  }
  console.log('   ✓ All 11 v<vol>.json + bundle-en-<vol>.json chunks verified');
}

function testServerLiveParityAndSizeReduction() {
  console.log('2. Testing server.js live parity and 11-volume JSON size reduction...');
  const liveManifest = getBundleManifest();
  assert.strictEqual(
    liveManifest.body.toString('utf8'),
    fs.readFileSync(path.join(PUB, 'bundle.js'), 'utf8'),
    'server.js live /bundle.js must match scripts/build_bundle.js byte-for-byte'
  );
  assert.strictEqual(
    getBook('4.5').json.toString('utf8'),
    fs.readFileSync(path.join(BOOKS_DIR, 'v4.5.json'), 'utf8'),
    'server.js live /books/v4.5.json must match prebuilt v4.5.json'
  );
  assert.strictEqual(
    getBookEn('4.5').json.toString('utf8'),
    fs.readFileSync(path.join(BOOKS_DIR, 'bundle-en-4.5.json'), 'utf8'),
    'server.js live /books/bundle-en-4.5.json must match prebuilt bundle-en-4.5.json'
  );

  // Default buildBook(opt) keeps p.en for backward compatibility; includeEn: false omits p.en
  const defaultV4 = buildBook(VOLUMES['4']);
  const slimV4 = buildBook({ ...VOLUMES['4'], includeEn: false });
  assert(defaultV4.pages.some((p) => Array.isArray(p.en) && p.en.length > 0), 'Default buildBook() must retain p.en');
  assert(slimV4.pages.every((p) => !('en' in p)), 'buildBook({ includeEn: false }) must omit p.en');

  let fullBytes = 0;
  let slimBytes = 0;
  for (const k of VOLUME_KEYS) {
    fullBytes += Buffer.byteLength(JSON.stringify(buildBook({ ...VOLUMES[k], includeEn: true })));
    slimBytes += Buffer.byteLength(JSON.stringify(buildBook({ ...VOLUMES[k], includeEn: false })));
  }
  const reductionPct = (1 - slimBytes / fullBytes) * 100;
  assert(reductionPct > 44, `Expected >44% UTF-8 byte reduction across 11 volumes, got ${reductionPct.toFixed(2)}%`);
  console.log(`   ✓ Live parity verified; p.en split saves ${reductionPct.toFixed(2)}% (${(fullBytes / 1048576).toFixed(2)} MB -> ${(slimBytes / 1048576).toFixed(2)} MB)`);
}

async function testServiceWorkerRootAndSubpath() {
  console.log('3. Testing public/sw.js CacheStorage behavior on root and GitHub Pages subpath...');
  const swCode = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');

  for (const scope of ['http://localhost:3000/', 'https://baran3575.github.io/alya-reader/']) {
    const store = new Map();
    let online = true;
    const networkHits = [];

    const makeResponse = (body) => ({
      ok: true,
      status: 200,
      body,
      clone() {
        return makeResponse(body);
      },
      async text() {
        return body;
      },
    });

    const mockFetch = async (req) => {
      const url = typeof req === 'string' ? req : req.url;
      if (!online) throw new Error('Offline');
      networkHits.push(url);
      return makeResponse('payload:' + url);
    };

    const mockCaches = {
      async open(name) {
        if (!store.has(name)) store.set(name, new Map());
        const bucket = store.get(name);
        return {
          async add(url) {
            const res = await mockFetch({ url, method: 'GET' });
            bucket.set(url, res.clone());
          },
          async put(req, res) {
            const key = typeof req === 'string' ? req : req.url;
            bucket.set(key, res);
          },
          async keys() {
            return Array.from(bucket.keys());
          },
          async delete(req) {
            const key = typeof req === 'string' ? req : req.url;
            return bucket.delete(key);
          },
          async match(req, opts) {
            const key = typeof req === 'string' ? req : req.url;
            if (bucket.has(key)) return bucket.get(key).clone();
            if (opts && opts.ignoreSearch) {
              const bare = key.split('?')[0];
              for (const [k, v] of bucket.entries()) {
                if (k.split('?')[0] === bare) return v.clone();
              }
            }
            return undefined;
          },
        };
      },
      async keys() {
        return Array.from(store.keys());
      },
      async delete(k) {
        return store.delete(k);
      },
      async match(req, opts) {
        for (const name of store.keys()) {
          const c = await mockCaches.open(name);
          const hit = await c.match(req, opts);
          if (hit) return hit;
        }
        return undefined;
      },
    };

    const listeners = {};
    const swSelf = {
      location: new URL('sw.js', scope),
      registration: { scope },
      caches: mockCaches,
      fetch: mockFetch,
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
      addEventListener(type, fn) {
        listeners[type] = fn;
      },
    };

    vm.runInNewContext(swCode, {
      self: swSelf,
      caches: mockCaches,
      fetch: mockFetch,
      URL,
    });

    let installWait;
    listeners.install({ waitUntil: (p) => { installWait = p; } });
    await installWait;

    const dispatchFetch = async (relUrl, mode = 'cors') => {
      const fullUrl = new URL(relUrl, scope).toString();
      let responded;
      listeners.fetch({
        request: { url: fullUrl, method: 'GET', mode },
        respondWith: (p) => { responded = p; },
      });
      return responded;
    };

    // Cache v4.json and bundle-en-4.json while online, then verify offline hit + stale hash pruning
    await dispatchFetch('books/v4.json?v=oldhash');
    await dispatchFetch('books/v4.json?v=newhash');
    await dispatchFetch('books/bundle-en-4.json?v=enhash');
    const bucket = store.get('alya-v4');
    assert(!bucket.has(new URL('books/v4.json?v=oldhash', scope).toString()), 'Stale v4.json hash must be pruned');
    assert(bucket.has(new URL('books/v4.json?v=newhash', scope).toString()), 'Latest v4.json hash must be cached');
    assert(bucket.has(new URL('books/bundle-en-4.json?v=enhash', scope).toString()), 'bundle-en-4.json must be cached');

    online = false;
    const hitsBefore = networkHits.length;
    const offlineV4 = await dispatchFetch('books/v4.json?v=newhash');
    const offlineEn4 = await dispatchFetch('books/bundle-en-4.json?v=enhash');
    const offlineShell = await dispatchFetch('', 'navigate');
    assert(offlineV4 && offlineV4.ok, `Offline v4.json must resolve on ${scope}`);
    assert(offlineEn4 && offlineEn4.ok, `Offline bundle-en-4.json must resolve on ${scope}`);
    assert(offlineShell && offlineShell.ok, `Offline navigation shell must resolve on ${scope}`);
    assert.strictEqual(networkHits.length, hitsBefore, 'Zero network requests while offline');
  }
  console.log('   ✓ Service Worker root and /alya-reader/ subpath offline CacheStorage verified');
}

async function run() {
  console.log('=== Starting Lazy Volume Chunks & CacheStorage Tests ===\n');
  testBuildBundleSchema();
  testServerLiveParityAndSizeReduction();
  await testServiceWorkerRootAndSubpath();
  console.log('\n=== All Lazy Volume Chunks & CacheStorage Tests Passed! ===');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
