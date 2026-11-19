// Automated tests for clean-checkout embedded art preservation, subpath service worker,
// and scan fallback guards across Volumes 4–12.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function testCleanCheckoutPreservesArtChunksAndStampsSw() {
  console.log('Testing clean checkout bundle rebuild without public/pages*/...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alya-clean-checkout-'));
  try {
    fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(tmpDir, 'server.js'));
    fs.mkdirSync(path.join(tmpDir, 'scripts', 'lib'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts', 'build_bundle.js'), path.join(tmpDir, 'scripts', 'build_bundle.js'));
    fs.copyFileSync(path.join(ROOT, 'scripts', 'lib', 'volumes.js'), path.join(tmpDir, 'scripts', 'lib', 'volumes.js'));
    copyDirRecursive(path.join(ROOT, 'data'), path.join(tmpDir, 'data'));
    copyDirRecursive(path.join(ROOT, 'data45'), path.join(tmpDir, 'data45'));

    fs.mkdirSync(path.join(tmpDir, 'public', 'books'), { recursive: true });
    for (const rel of ['index.html', 'style.css', 'app.js', 'sw.js', 'bundle.js', 'bundle-art.js']) {
      fs.copyFileSync(path.join(ROOT, 'public', rel), path.join(tmpDir, 'public', rel));
    }
    fs.copyFileSync(path.join(ROOT, 'public', 'books', 'art-4.json'), path.join(tmpDir, 'public', 'books', 'art-4.json'));
    fs.copyFileSync(path.join(ROOT, 'public', 'books', 'art-4.5.json'), path.join(tmpDir, 'public', 'books', 'art-4.5.json'));

    // Stamp placeholder VERSION in sw.js to verify build_bundle.js updates it
    const tmpSwPath = path.join(tmpDir, 'public', 'sw.js');
    const swOrig = fs.readFileSync(tmpSwPath, 'utf8');
    fs.writeFileSync(tmpSwPath, swOrig.replace(/^const VERSION = ['"][^'"]*['"];/m, "const VERSION = 'alya-placeholder';"));

    execFileSync(process.execPath, [path.join(tmpDir, 'scripts', 'build_bundle.js')], {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    const art4 = JSON.parse(fs.readFileSync(path.join(tmpDir, 'public', 'books', 'art-4.json'), 'utf8'));
    const art45 = JSON.parse(fs.readFileSync(path.join(tmpDir, 'public', 'books', 'art-4.5.json'), 'utf8'));
    assert.strictEqual(Object.keys(art4).length, 16, 'Volume 4 art-4.json must retain all 16 embedded illustrations');
    assert.strictEqual(Object.keys(art45).length, 15, 'Volume 4.5 art-4.5.json must retain all 15 embedded illustrations');

    const v4 = JSON.parse(fs.readFileSync(path.join(tmpDir, 'public', 'books', 'v4.json'), 'utf8'));
    const v45 = JSON.parse(fs.readFileSync(path.join(tmpDir, 'public', 'books', 'v4.5.json'), 'utf8'));
    assert.strictEqual(v4.scansAvailable, false, 'v4.json scansAvailable must be false without public/pages/');
    assert.strictEqual(v45.scansAvailable, false, 'v4.5.json scansAvailable must be false without public/pages45/');

    const updatedSw = fs.readFileSync(tmpSwPath, 'utf8');
    const verMatch = updatedSw.match(/^const VERSION = '(alya-[0-9a-f]{12})';/m);
    assert(verMatch, 'build_bundle.js must stamp a deterministic alya-<12hex> VERSION in public/sw.js');

    // Verify build fails if embedded art chunks are emptied when scans are absent
    fs.unlinkSync(path.join(tmpDir, 'public', 'books', 'art-4.json'));
    let failedAsExpected = false;
    try {
      execFileSync(process.execPath, [path.join(tmpDir, 'scripts', 'build_bundle.js')], {
        cwd: tmpDir,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (err) {
      failedAsExpected = err.status !== 0 && String(err.stderr || err.message).includes('Cilt 4');
    }
    assert(failedAsExpected, 'build_bundle.js must fail if embedded art vanishes on a clean checkout');
    console.log('  ✓ Clean checkout art-*.json preservation (31 illustrations), scansAvailable, and SW stamping verified');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testSubpathServiceWorker() {
  console.log('Testing public/sw.js under /alya-reader/ subpath scope...');
  const swCode = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
  const versionMatch = swCode.match(/^const VERSION = '([^']+)';/m);
  assert(versionMatch && /^alya-[0-9a-f]{12}$/.test(versionMatch[1]), 'public/sw.js must carry stamped VERSION');
  const expectedVersion = versionMatch[1];

  const listeners = {};
  const stores = new Map();
  let networkOnline = true;
  const networkHits = [];

  function normKey(reqOrUrl) {
    return typeof reqOrUrl === 'string' ? reqOrUrl : reqOrUrl.url;
  }

  function getBucket(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const map = stores.get(name);
    return {
      async addAll(urls) {
        for (const u of urls) {
          map.set(normKey(u), {
            ok: true,
            status: 200,
            url: normKey(u),
            body: 'cached:' + normKey(u),
            clone() {
              return { ...this };
            },
          });
        }
      },
      async match(req) {
        return map.get(normKey(req)) || undefined;
      },
      async put(req, res) {
        map.set(normKey(req), res);
      },
    };
  }

  stores.set('alya-stale-v0', new Map([['https://baran3575.github.io/alya-reader/index.html', { ok: true }]]));

  const selfObj = {
    location: new URL('https://baran3575.github.io/alya-reader/sw.js'),
    registration: { scope: 'https://baran3575.github.io/alya-reader/' },
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };

  const ctx = {
    self: selfObj,
    URL,
    Response: { error: () => ({ ok: false, status: 0, type: 'error' }) },
    caches: {
      async open(name) {
        return getBucket(name);
      },
      async keys() {
        return Array.from(stores.keys());
      },
      async delete(name) {
        return stores.delete(name);
      },
      async match(req) {
        for (const map of stores.values()) {
          if (map.has(normKey(req))) return map.get(normKey(req));
        }
        return undefined;
      },
    },
    fetch: async (req) => {
      const u = normKey(req);
      networkHits.push(u);
      if (!networkOnline) throw new Error('offline');
      return {
        ok: true,
        status: 200,
        url: u,
        body: 'net:' + u,
        clone() {
          return { ...this };
        },
      };
    },
  };

  vm.runInNewContext(swCode, ctx);

  // 1. Install caches all scope-resolved SHELL URLs
  let installPromise;
  listeners.install({ waitUntil: (p) => { installPromise = p; } });
  await installPromise;

  const activeCache = stores.get(expectedVersion);
  assert(activeCache, 'Install must create cache with stamped VERSION');
  for (const rel of ['', 'index.html', 'style.css', 'app.js', 'bundle.js', 'bundle-art.js']) {
    const expected = 'https://baran3575.github.io/alya-reader/' + rel;
    assert(activeCache.has(expected), 'Service worker SHELL must cache ' + expected);
  }

  // 2. Activate prunes stale caches
  let activatePromise;
  listeners.activate({ waitUntil: (p) => { activatePromise = p; } });
  await activatePromise;
  assert(!stores.has('alya-stale-v0'), 'Activate must delete outdated caches');
  assert(stores.has(expectedVersion), 'Activate must retain current VERSION cache');

  // 3. Cache-first for v<vol>.json, art-<vol>.json, <vol>.json, and pages*/ under /alya-reader/
  const cacheFirstUrls = [
    'https://baran3575.github.io/alya-reader/books/v9.5.json',
    'https://baran3575.github.io/alya-reader/books/art-4.json',
    'https://baran3575.github.io/alya-reader/books/4.5.json',
    'https://baran3575.github.io/alya-reader/pages5/001.webp',
  ];
  networkOnline = true;
  for (const u of cacheFirstUrls) {
    let p;
    listeners.fetch({ request: { method: 'GET', url: u }, respondWith: (pr) => { p = pr; } });
    await p;
  }

  networkOnline = false;
  networkHits.length = 0;
  for (const u of cacheFirstUrls) {
    let p;
    listeners.fetch({ request: { method: 'GET', url: u }, respondWith: (pr) => { p = pr; } });
    const res = await p;
    assert(res && res.body === 'net:' + u, u + ' must resolve from cacheFirst when offline');
  }
  assert.strictEqual(networkHits.length, 0, 'cacheFirst offline hits must not hit network');

  // 4. Offline navigation fallback to scope-resolved ./index.html
  let navPromise;
  listeners.fetch({
    request: { method: 'GET', mode: 'navigate', url: 'https://baran3575.github.io/alya-reader/?vol=9.5' },
    respondWith: (p) => { navPromise = p; },
  });
  const navRes = await navPromise;
  assert.strictEqual(
    navRes && navRes.url,
    'https://baran3575.github.io/alya-reader/index.html',
    'Offline navigation under /alya-reader/ must fall back to /alya-reader/index.html',
  );

  // 5. Uncached non-HTML asset offline returns Response.error()
  let errPromise;
  listeners.fetch({
    request: { method: 'GET', mode: 'cors', url: 'https://baran3575.github.io/alya-reader/missing.js' },
    respondWith: (p) => { errPromise = p; },
  });
  const errRes = await errPromise;
  assert.strictEqual(errRes && errRes.type, 'error', 'Uncached non-HTML asset offline must return Response.error()');

  // 6. Out-of-scope path on same origin is ignored
  let outOfScopeHandled = false;
  listeners.fetch({
    request: { method: 'GET', url: 'https://baran3575.github.io/other-project/index.html' },
    respondWith: () => { outOfScopeHandled = true; },
  });
  assert.strictEqual(outOfScopeHandled, false, 'Requests outside self.registration.scope must be ignored');
  console.log('  ✓ Subpath service worker scope, chunk caching, and offline fallback verified');
}

function testReaderScanFallbackContract() {
  console.log('Testing public/app.js scan guards and fallback card contract...');
  const appJs = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert(appJs.includes('function canLoadScan('), 'public/app.js must define canLoadScan');
  assert(appJs.includes('function scanFallbackCard('), 'public/app.js must define scanFallbackCard');
  assert(appJs.includes('scan-fallback'), 'public/app.js must render .scan-fallback card for unembedded scans');

  const styleCss = fs.readFileSync(path.join(ROOT, 'public', 'style.css'), 'utf8');
  assert(styleCss.includes('.scan-fallback'), 'public/style.css must style .scan-fallback');
  console.log('  ✓ Reader scan guards and fallback card contract verified');
}

async function run() {
  console.log('=== Starting Subpath SW & Scan Fallback Verification Tests ===\n');
  testCleanCheckoutPreservesArtChunksAndStampsSw();
  await testSubpathServiceWorker();
  testReaderScanFallbackContract();
  console.log('\n=== All Subpath SW & Scan Fallback Tests Passed! ===');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
