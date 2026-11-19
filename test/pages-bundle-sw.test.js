// Automated tests for static bundle art preservation, subpath service worker,
// Pages deployment workflow configuration, and local /api/book serving.
const { execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
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

function testBackupExclusionAndPackageConfig() {
  console.log('Testing backup (.bak) cleanup, .gitignore rules, and package.json...');
  const pubFiles = fs.readdirSync(path.join(ROOT, 'public'));
  const bakFiles = pubFiles.filter((f) => f.endsWith('.bak'));
  assert.deepStrictEqual(bakFiles, [], 'public/ must contain zero .bak files');

  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert(gitignore.split(/\r?\n/).includes('*.bak'), '.gitignore must exclude *.bak');
  assert(gitignore.split(/\r?\n/).includes('public/pages/'), '.gitignore must keep public/pages/ excluded');
  assert(gitignore.split(/\r?\n/).includes('public/pages45/'), '.gitignore must keep public/pages45/ excluded');

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.scripts.build, 'node scripts/build_bundle.js', 'package.json must expose build script');
  assert.strictEqual(pkg.dependencies, undefined, 'package.json must preserve zero dependencies');
  assert.strictEqual(pkg.devDependencies, undefined, 'package.json must preserve zero devDependencies');
  console.log('  ✓ Backup cleanup, .gitignore, and package.json verified');
}

function testCleanCheckoutPreservesIllustrationsAndStampsSw() {
  console.log('Testing clean checkout bundle rebuild without public/pages*/...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alya-clean-checkout-'));
  try {
    fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(tmpDir, 'server.js'));
    fs.mkdirSync(path.join(tmpDir, 'scripts'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts', 'build_bundle.js'), path.join(tmpDir, 'scripts', 'build_bundle.js'));
    copyDirRecursive(path.join(ROOT, 'data'), path.join(tmpDir, 'data'));
    copyDirRecursive(path.join(ROOT, 'data45'), path.join(tmpDir, 'data45'));
    copyDirRecursive(path.join(ROOT, 'public'), path.join(tmpDir, 'public'));

    // Ensure raw scan directories are completely absent
    fs.rmSync(path.join(tmpDir, 'public', 'pages'), { recursive: true, force: true });
    fs.rmSync(path.join(tmpDir, 'public', 'pages45'), { recursive: true, force: true });

    // Stamp a placeholder VERSION in sw.js to verify build_bundle.js updates it
    const tmpSwPath = path.join(tmpDir, 'public', 'sw.js');
    const swOrig = fs.readFileSync(tmpSwPath, 'utf8');
    fs.writeFileSync(tmpSwPath, swOrig.replace(/^const VERSION = ['"][^'"]*['"];/m, "const VERSION = 'alya-placeholder';"));

    execFileSync(process.execPath, [path.join(tmpDir, 'scripts', 'build_bundle.js')], {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    const ctx = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(tmpDir, 'public', 'bundle.js'), 'utf8'), ctx);
    vm.runInNewContext(fs.readFileSync(path.join(tmpDir, 'public', 'bundle-art.js'), 'utf8'), ctx);

    const art4 = Object.keys(ctx.window.ALYA_ART['4'] || {});
    const art45 = Object.keys(ctx.window.ALYA_ART['4.5'] || {});
    assert.strictEqual(art4.length, 16, 'Volume 4 must retain all 16 embedded illustrations');
    assert.strictEqual(art45.length, 15, 'Volume 4.5 must retain all 15 embedded illustrations');
    assert.strictEqual(art4.length + art45.length, 31, 'Clean build must retain all 31 illustrations');

    assert.strictEqual(ctx.window.ALYA_BUNDLE.vols['4'].scansAvailable, false, 'Vol 4 scansAvailable must be false without public/pages/');
    assert.strictEqual(ctx.window.ALYA_BUNDLE.vols['4.5'].scansAvailable, false, 'Vol 4.5 scansAvailable must be false without public/pages45/');

    const updatedSw = fs.readFileSync(tmpSwPath, 'utf8');
    const verMatch = updatedSw.match(/^const VERSION = '(alya-[0-9a-f]{12})';/m);
    assert(verMatch, 'build_bundle.js must stamp a deterministic alya-<12hex> VERSION in public/sw.js');

    // Verify build fails if an existing illustration vanishes when scans are absent
    const brokenArt = {
      '4': { ...ctx.window.ALYA_ART['4'] },
      '4.5': { ...ctx.window.ALYA_ART['4.5'] },
    };
    delete brokenArt['4']['004'];
    fs.writeFileSync(
      path.join(tmpDir, 'public', 'bundle-art.js'),
      'window.ALYA_ART=' + JSON.stringify(brokenArt) + ';\n',
    );

    let failedAsExpected = false;
    try {
      execFileSync(process.execPath, [path.join(tmpDir, 'scripts', 'build_bundle.js')], {
        cwd: tmpDir,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (err) {
      failedAsExpected = err.status !== 0 && String(err.stderr || err.message).includes('Cilt 4 s.004');
    }
    assert(failedAsExpected, 'build_bundle.js must fail if an illustration is missing on a clean checkout');
    console.log('  ✓ Clean checkout art preservation (31 illustrations), scansAvailable, and failure guard verified');
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
          map.set(normKey(u), { ok: true, status: 200, url: normKey(u), body: 'cached:' + normKey(u), clone() { return { ...this }; } });
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

  // Pre-seed a stale cache to verify activate cleanup
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

  // 1. Install
  let installPromise;
  listeners.install({ waitUntil: (p) => { installPromise = p; } });
  await installPromise;

  const activeCache = stores.get(expectedVersion);
  assert(activeCache, 'Install must create cache with stamped VERSION');
  const expectedUrls = [
    'https://baran3575.github.io/alya-reader/',
    'https://baran3575.github.io/alya-reader/index.html',
    'https://baran3575.github.io/alya-reader/style.css',
    'https://baran3575.github.io/alya-reader/app.js',
    'https://baran3575.github.io/alya-reader/bundle.js',
    'https://baran3575.github.io/alya-reader/bundle-art.js',
  ];
  for (const u of expectedUrls) {
    assert(activeCache.has(u), 'Service worker SHELL must cache ' + u);
  }

  // 2. Activate prunes stale cache
  let activatePromise;
  listeners.activate({ waitUntil: (p) => { activatePromise = p; } });
  await activatePromise;
  assert(!stores.has('alya-stale-v0'), 'Activate must delete outdated caches');
  assert(stores.has(expectedVersion), 'Activate must retain current VERSION cache');

  // 3. Offline cacheFirst for bundle-art.js and bundle.js
  networkOnline = false;
  networkHits.length = 0;
  let artResponsePromise;
  listeners.fetch({
    request: { method: 'GET', url: 'https://baran3575.github.io/alya-reader/bundle-art.js' },
    respondWith: (p) => { artResponsePromise = p; },
  });
  const artRes = await artResponsePromise;
  assert(artRes && artRes.body.startsWith('cached:'), 'bundle-art.js must resolve from cacheFirst offline');
  assert.strictEqual(networkHits.length, 0, 'cacheFirst hit must not hit network');

  // 4. Offline navigation fallback to ./index.html under /alya-reader/
  let navResponsePromise;
  listeners.fetch({
    request: { method: 'GET', mode: 'navigate', url: 'https://baran3575.github.io/alya-reader/?vol=4.5' },
    respondWith: (p) => { navResponsePromise = p; },
  });
  const navRes = await navResponsePromise;
  assert.strictEqual(
    navRes && navRes.url,
    'https://baran3575.github.io/alya-reader/index.html',
    'Offline navigation under /alya-reader/ must fall back to /alya-reader/index.html',
  );

  // 4b. Uncached non-HTML asset offline returns Response.error() instead of HTML
  let missingJsPromise;
  listeners.fetch({
    request: { method: 'GET', mode: 'cors', url: 'https://baran3575.github.io/alya-reader/unknown.js' },
    respondWith: (p) => { missingJsPromise = p; },
  });
  const missingJsRes = await missingJsPromise;
  assert.strictEqual(missingJsRes && missingJsRes.type, 'error', 'Uncached non-HTML asset offline must return error response');

  // 5. Out-of-scope path on same origin is ignored
  let outOfScopeHandled = false;
  listeners.fetch({
    request: { method: 'GET', url: 'https://baran3575.github.io/other-project/index.html' },
    respondWith: () => { outOfScopeHandled = true; },
  });
  assert.strictEqual(outOfScopeHandled, false, 'Requests outside self.registration.scope must be ignored');
  console.log('  ✓ Subpath service worker caching, cacheFirst, and offline fallback verified');
}

function testWorkflowAndReaderContract() {
  console.log('Testing deploy-pages.yml workflow permissions and app.js scan guards...');
  const deployWf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-pages.yml'), 'utf8');
  assert(deployWf.includes('pages: write'), 'deploy-pages.yml must declare pages: write');
  assert(deployWf.includes('id-token: write'), 'deploy-pages.yml must declare id-token: write');
  assert(deployWf.includes('actions/upload-pages-artifact'), 'deploy-pages.yml must upload Pages artifact');
  assert(deployWf.includes('actions/deploy-pages'), 'deploy-pages.yml must deploy Pages artifact');
  assert(deployWf.includes('npm test'), 'deploy-pages.yml must gate deployment on npm test');
  assert(deployWf.includes('*.bak'), 'deploy-pages.yml must strip/verify zero .bak files');
  assert(!/^\s*pull_request\s*:/m.test(deployWf), 'deploy-pages.yml must not run on pull_request');

  const qcMatrixWf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'qc-matrix.yml'), 'utf8');
  assert(!qcMatrixWf.includes('pages: write') && !qcMatrixWf.includes('id-token: write'), 'qc-matrix.yml must remain without write permissions');

  const appJs = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert(appJs.includes('function hasArt('), 'public/app.js must define hasArt');
  assert(appJs.includes('function canLoadScan('), 'public/app.js must define canLoadScan');
  assert(appJs.includes('scan-fallback'), 'public/app.js must render scan-fallback card for unembedded pages');
  console.log('  ✓ Workflow isolation and reader scan fallback contract verified');
}

async function testLocalApiBookEndpoint() {
  console.log('Testing local server.js /api/book serving...');
  const { getBook } = require('../server.js');
  const b4 = getBook('4').book;
  const b45 = getBook('4.5').book;
  assert.strictEqual(b4.total, 282, 'Local server Volume 4 must have 282 pages');
  assert.strictEqual(b45.total, 347, 'Local server Volume 4.5 must have 347 pages');

  // Verify HTTP endpoint via ephemeral child server
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/api/book') {
      const v = u.searchParams.get('v') === '4.5' ? '4.5' : '4';
      const payload = getBook(v).json;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(payload);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  try {
    const port = srv.address().port;
    const body = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/api/book?v=4.5`, (res) => {
        assert.strictEqual(res.statusCode, 200);
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }).on('error', reject);
    });
    const parsed = JSON.parse(body);
    assert.strictEqual(parsed.volume, 'Cilt 4.5');
    assert.strictEqual(parsed.pages.length, 347);
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
  console.log('  ✓ Local /api/book endpoint verified');
}

async function run() {
  console.log('=== Starting Pages, Bundle Art & Subpath SW Verification Tests ===\n');
  testBackupExclusionAndPackageConfig();
  testCleanCheckoutPreservesIllustrationsAndStampsSw();
  await testSubpathServiceWorker();
  testWorkflowAndReaderContract();
  await testLocalApiBookEndpoint();
  console.log('\n=== All Pages, Bundle Art & Subpath SW Tests Passed! ===');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
