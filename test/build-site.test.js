// Automated verification for scripts/build_site.js, Service Worker subpath scoping, and static book fallbacks
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { VOLUMES } = require('../server.js');
const { buildSite } = require('../scripts/build_site.js');

const ROOT = path.join(__dirname, '..');

function listAllFiles(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? prefix + '/' + entry.name : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listAllFiles(full, rel));
    else out.push(rel);
  }
  return out;
}

function testCleanCheckoutBuildPreservesArtAndExcludesBackups() {
  console.log('Testing clean-checkout build_site.js staging, .nojekyll, 31 illustrations, and .bak exclusion...');
  const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), 'alya-dist-test-'));
  try {
    // Verify clean checkout condition: public/pages and public/pages45 are absent
    assert(!fs.existsSync(path.join(ROOT, 'public', 'pages')), 'public/pages should be absent in clean checkout');
    assert(!fs.existsSync(path.join(ROOT, 'public', 'pages45')), 'public/pages45 should be absent in clean checkout');

    const info = buildSite({ distDir: tmpDist, quiet: true });
    const files = listAllFiles(tmpDist);

    assert(files.includes('.nojekyll'), 'dist/.nojekyll must exist');
    assert(files.includes('index.html'), 'dist/index.html must exist');
    assert(files.includes('style.css'), 'dist/style.css must exist');
    assert(files.includes('app.js'), 'dist/app.js must exist');
    assert(files.includes('bundle.js'), 'dist/bundle.js must exist');
    assert(files.includes('bundle-art.js'), 'dist/bundle-art.js must exist');
    assert(files.includes('sw.js'), 'dist/sw.js must exist');

    const bakFiles = files.filter((f) => f.endsWith('.bak'));
    assert.strictEqual(bakFiles.length, 0, 'dist/ must contain zero *.bak files');

    // Verify all registered volumes have books/<vol>.json
    for (const volKey of Object.keys(VOLUMES)) {
      const rel = 'books/' + volKey + '.json';
      assert(files.includes(rel), 'dist/' + rel + ' must exist');
      const parsed = JSON.parse(fs.readFileSync(path.join(tmpDist, rel), 'utf8'));
      assert(parsed.total > 0 && Array.isArray(parsed.pages), rel + ' must contain valid book payload');
      assert(!parsed.pages[0].img.startsWith('/'), rel + ' page image paths must be relative for subpath hosting');
      if (volKey !== '4' && volKey !== '4.5') {
        for (const p of parsed.pages) {
          if (p.art) {
            assert(files.includes(p.img), 'dist/' + p.img + ' WebP illustration must be staged for Vol ' + volKey);
          }
        }
      }
    }

    // Verify all 31 illustrations (> 4 MB) are preserved
    const artBytes = fs.statSync(path.join(tmpDist, 'bundle-art.js')).size;
    assert(artBytes > 4000000, 'dist/bundle-art.js must exceed 4 MB, got ' + artBytes);
    const ctx = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(tmpDist, 'bundle-art.js'), 'utf8'), ctx);
    assert.strictEqual(Object.keys(ctx.window.ALYA_ART['4']).length, 16, 'Vol 4 must preserve 16 illustrations');
    assert.strictEqual(Object.keys(ctx.window.ALYA_ART['4.5']).length, 15, 'Vol 4.5 must preserve 15 illustrations');
    assert.strictEqual(info.artCount, 31, 'Total preserved illustration count must be 31');

    // Verify SHA-1 content hash in dist/sw.js
    const swText = fs.readFileSync(path.join(tmpDist, 'sw.js'), 'utf8');
    assert(/^alya-[0-9a-f]{12}$/.test(info.swVersion), 'swVersion must be alya-<12 hex chars>');
    assert(swText.includes("const VERSION = '" + info.swVersion + "';"), 'dist/sw.js must contain hashed VERSION');
    assert(!swText.includes('alya-v3') && !swText.includes('alya-v4'), 'dist/sw.js must replace static VERSION');
    console.log('  ✓ Staged dist/ verified (' + info.artCount + ' illustrations, ' + (artBytes / 1e6).toFixed(2) + ' MB, ' + info.swVersion + ')');
  } finally {
    fs.rmSync(tmpDist, { recursive: true, force: true });
  }
}

function testDynamicVolumeScalingAndHashRotation() {
  console.log('Testing dynamic volume scaling (Volumes 5-12) and SW VERSION hash rotation...');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alya-vol5-test-'));
  try {
    const pubDir = path.join(tmpRoot, 'public');
    const dist1 = path.join(tmpRoot, 'dist1');
    const dist2 = path.join(tmpRoot, 'dist2');
    fs.mkdirSync(pubDir, { recursive: true });
    for (const f of ['index.html', 'style.css', 'app.js', 'sw.js']) {
      fs.copyFileSync(path.join(ROOT, 'public', f), path.join(pubDir, f));
    }
    fs.writeFileSync(path.join(pubDir, 'app.js.bak'), '// synthetic backup file');
    fs.writeFileSync(path.join(pubDir, 'bundle-art.js'), 'window.ALYA_ART={"4":{"004":"data:image/webp;base64,AAAA"}};\n');
    fs.mkdirSync(path.join(pubDir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(pubDir, 'pages', '001.webp'), 'scan');
    fs.mkdirSync(path.join(pubDir, 'pages45'), { recursive: true });
    fs.writeFileSync(path.join(pubDir, 'pages45', '001.webp'), 'scan45');
    fs.mkdirSync(path.join(pubDir, 'pages5'), { recursive: true });
    fs.writeFileSync(path.join(pubDir, 'pages5', '001.webp'), 'vol5art');

    for (const dir of ['data', 'data5']) {
      fs.mkdirSync(path.join(tmpRoot, dir), { recursive: true });
      fs.writeFileSync(
        path.join(tmpRoot, dir, 'source.json'),
        JSON.stringify([{ page: 1, text: 'Chapter 1: Test Start one two three four five six seven' }]),
      );
      fs.writeFileSync(
        path.join(tmpRoot, dir, 'paragraphs_final.json'),
        JSON.stringify({ '1': ['Birinci paragraf metni burada yer alıyor.'] }),
      );
      fs.writeFileSync(path.join(tmpRoot, dir, 'chapters.json'), JSON.stringify({ 'Chapter 1': 'Deneme Bölümü' }));
    }

    const customVolumes = {
      '4': { dataDir: 'data', imgPrefix: '/pages/', volume: 'Cilt 4' },
      '5': { dataDir: 'data5', imgPrefix: '/pages5/', volume: 'Cilt 5' },
    };

    const res1 = buildSite({ rootDir: tmpRoot, publicDir: pubDir, distDir: dist1, volumes: customVolumes, quiet: true });
    assert(!fs.existsSync(path.join(dist1, 'pages')), 'Gitignored public/pages scan directory must not be copied into dist/');
    assert(!fs.existsSync(path.join(dist1, 'pages45')), 'Gitignored public/pages45 scan directory must not be copied into dist/');
    assert(fs.existsSync(path.join(dist1, 'pages5', '001.webp')), 'Tracked public/pages5 WebP illustrations must be copied into dist/');
    assert(fs.existsSync(path.join(dist1, 'books', '5.json')), 'Volume 5 static JSON must be emitted automatically');
    const vol5Book = JSON.parse(fs.readFileSync(path.join(dist1, 'books', '5.json'), 'utf8'));
    assert.strictEqual(vol5Book.volume, 'Cilt 5');
    assert.strictEqual(vol5Book.pages[0].img, 'pages5/001.webp');

    // Modify Volume 5 translation and verify SW VERSION hash rotates
    fs.writeFileSync(
      path.join(tmpRoot, 'data5', 'paragraphs_final.json'),
      JSON.stringify({ '1': ['Güncellenmiş paragraf metni burada yer alıyor.'] }),
    );
    const res2 = buildSite({ rootDir: tmpRoot, publicDir: pubDir, distDir: dist2, volumes: customVolumes, quiet: true });
    assert.notStrictEqual(res1.swVersion, res2.swVersion, 'SW VERSION must rotate when book content changes');
    console.log('  ✓ Dynamic Volume 5 build and SW VERSION hash rotation verified');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

async function testServiceWorkerSubpathResolutionAndCacheCleanup() {
  console.log('Testing Service Worker /alya-reader/ subpath caching, offline fallback, and cache eviction...');
  const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), 'alya-sw-test-'));
  try {
    const info = buildSite({ distDir: tmpDist, quiet: true });
    const swCode = fs.readFileSync(path.join(tmpDist, 'sw.js'), 'utf8');

    const listeners = {};
    const store = new Map();
    store.set('alya-v3', new Map([['https://baran3575.github.io/index.html', { ok: true, body: 'stale' }]]));
    store.set('alya-v4', new Map([['https://baran3575.github.io/alya-reader/index.html', { ok: true, body: 'stale-v4' }]]));

    const cachesMock = {
      async open(name) {
        if (!store.has(name)) store.set(name, new Map());
        const bucket = store.get(name);
        return {
          async addAll(urls) {
            for (const u of urls) {
              bucket.set(u, { ok: true, url: u, clone() { return this; } });
            }
          },
          async put(req, res) {
            const key = typeof req === 'string' ? req : req.url;
            bucket.set(key, res);
          },
        };
      },
      async keys() {
        return Array.from(store.keys());
      },
      async delete(name) {
        return store.delete(name);
      },
      async match(req) {
        const key = typeof req === 'string' ? req : req.url;
        for (const bucket of store.values()) {
          if (bucket.has(key)) return bucket.get(key);
        }
        return undefined;
      },
    };

    let networkAvailable = true;
    const networkCalls = [];
    const fetchMock = async (req) => {
      const url = typeof req === 'string' ? req : req.url;
      networkCalls.push(url);
      if (!networkAvailable) throw new Error('offline');
      return {
        ok: true,
        url,
        clone() {
          return { ok: true, url, clone: this.clone };
        },
      };
    };

    const selfMock = {
      location: new URL('https://baran3575.github.io/alya-reader/sw.js'),
      registration: { scope: 'https://baran3575.github.io/alya-reader/' },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
      addEventListener(type, fn) {
        listeners[type] = fn;
      },
    };

    vm.runInNewContext(swCode, {
      self: selfMock,
      caches: cachesMock,
      fetch: fetchMock,
      URL,
      Response: { error: () => ({ ok: false, status: 0 }) },
    });

    // 1. Install: every cached SHELL URL must stay under /alya-reader/
    let installPromise;
    listeners.install({ waitUntil: (p) => { installPromise = p; } });
    await installPromise;
    const activeBucket = store.get(info.swVersion);
    assert(activeBucket, 'Active version cache bucket must be created');
    const cachedShellUrls = Array.from(activeBucket.keys());
    assert(cachedShellUrls.length >= 6, 'All shell assets must be pre-cached');
    for (const u of cachedShellUrls) {
      assert(
        u.startsWith('https://baran3575.github.io/alya-reader/'),
        'Cached shell URL escaped /alya-reader/ scope: ' + u,
      );
    }

    // 2. Activate: old alya-v3 cache must be deleted
    let activatePromise;
    listeners.activate({ waitUntil: (p) => { activatePromise = p; } });
    await activatePromise;
    assert(!store.has('alya-v3') && !store.has('alya-v4'), 'Old static alya-v3/alya-v4 caches must be deleted on activate');
    assert(store.has(info.swVersion), 'Current hashed cache must remain');

    // 3. Cache-first for /alya-reader/books/4.json
    let responsePromise;
    listeners.fetch({
      request: { method: 'GET', url: 'https://baran3575.github.io/alya-reader/books/4.json' },
      respondWith: (p) => { responsePromise = p; },
    });
    const firstBookRes = await responsePromise;
    assert(firstBookRes && firstBookRes.ok, 'First book fetch should succeed and populate cache');

    networkAvailable = false;
    const callsBeforeOfflineHit = networkCalls.length;
    listeners.fetch({
      request: { method: 'GET', url: 'https://baran3575.github.io/alya-reader/books/4.json' },
      respondWith: (p) => { responsePromise = p; },
    });
    const cachedBookRes = await responsePromise;
    assert(cachedBookRes && cachedBookRes.ok, 'Offline cache-first book fetch must resolve from cache');
    assert.strictEqual(networkCalls.length, callsBeforeOfflineHit, 'Cache-first hit must not hit network');

    // 4. Offline navigation fallback resolves /alya-reader/index.html
    listeners.fetch({
      request: { method: 'GET', url: 'https://baran3575.github.io/alya-reader/unknown-route' },
      respondWith: (p) => { responsePromise = p; },
    });
    const fallbackRes = await responsePromise;
    assert(fallbackRes && fallbackRes.url === 'https://baran3575.github.io/alya-reader/index.html', 'Fallback must resolve scoped ./index.html');
    console.log('  ✓ Service Worker subpath scoping, cache-first, offline fallback, and cache cleanup verified');
  } finally {
    fs.rmSync(tmpDist, { recursive: true, force: true });
  }
}

async function testReadBookStaticFallbackOn404() {
  console.log('Testing public/app.js readBook res.ok check and ./books/<vol>.json fallback on HTTP 404...');
  const appCode = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');

  function makeElement() {
    const el = {
      dataset: {},
      style: { setProperty() {} },
      classList: { toggle() {}, add() {}, remove() {} },
      children: [],
      hidden: true,
      textContent: '',
      innerHTML: '',
      value: '1',
      max: '1',
      disabled: false,
      append(...nodes) { this.children.push(...nodes); },
      appendChild(node) { this.children.push(node); return node; },
      addEventListener() {},
      setAttribute() {},
      removeAttribute() {},
      querySelector() { return makeElement(); },
      querySelectorAll() { return []; },
      contains() { return false; },
      getBoundingClientRect() { return { top: 0, height: 100 }; },
      scrollIntoView() {},
    };
    return el;
  }

  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };

  const fetchedUrls = [];
  let jsonCalledOn404 = false;
  const sampleBook4 = {
    title: 'Alya Bazen Duygularını Rusça Saklar',
    volume: 'Cilt 4',
    total: 1,
    chapters: [{ page: 1, label: 'Bölüm 1', title: 'Test Başlığı' }],
    pages: [{ n: 1, img: 'pages/001.webp', tr: ['Test paragrafı.'], en: ['Test paragraph.'], art: false }],
  };

  const storage = new Map();
  const windowObj = {
    ALYA_BUNDLE: null,
    ALYA_ART: {},
    ALYA_BUNDLE_VERSION: 'testver',
    innerHeight: 800,
    scrollY: 0,
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    scrollTo() {},
    requestAnimationFrame: (cb) => { cb(); return 1; },
  };

  const context = {
    window: windowObj,
    document: {
      title: '',
      body: makeElement(),
      documentElement: makeElement(),
      getElementById: getEl,
      querySelector: () => makeElement(),
      querySelectorAll: () => [],
      createElement: () => makeElement(),
      createTextNode: (t) => ({ textContent: String(t) }),
      createDocumentFragment: () => makeElement(),
      addEventListener() {},
    },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
    },
    navigator: { onLine: true },
    location: { protocol: 'https:', search: '' },
    URLSearchParams,
    Image: function Image() {},
    encodeURIComponent,
    fetch: async (url) => {
      fetchedUrls.push(url);
      if (url.includes('api/book')) {
        return {
          ok: false,
          status: 404,
          async json() {
            jsonCalledOn404 = true;
            throw new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON");
          },
        };
      }
      if (url === './books/4.json') {
        return {
          ok: true,
          status: 200,
          async json() {
            return sampleBook4;
          },
        };
      }
      return { ok: false, status: 404, async json() { throw new Error('unexpected'); } };
    },
  };
  windowObj.fetch = context.fetch;
  windowObj.localStorage = context.localStorage;
  windowObj.navigator = context.navigator;
  windowObj.location = context.location;

  vm.runInNewContext(appCode, context);
  await new Promise((r) => setTimeout(r, 30));

  assert.strictEqual(jsonCalledOn404, false, 'readBook must check res.ok and never call res.json() on HTTP 404');
  assert(fetchedUrls.some((u) => u.includes('api/book?v=4')), 'readBook should attempt api/book first');
  assert(fetchedUrls.includes('./books/4.json'), 'readBook must fall back to ./books/4.json');
  assert.strictEqual(getEl('brandSub').textContent, 'Cilt 4 · Türkçe', 'Reader UI must render fallback book metadata');
  console.log('  ✓ readBook checks res.ok and loads ./books/4.json cleanly without JSON errors on HTTP 404');
}

async function main() {
  console.log('=== Starting Site Build & Pages Deployment Verification Tests ===\n');
  testCleanCheckoutBuildPreservesArtAndExcludesBackups();
  testDynamicVolumeScalingAndHashRotation();
  await testServiceWorkerSubpathResolutionAndCacheCleanup();
  await testReadBookStaticFallbackOn404();
  console.log('\n=== All Site Build & Pages Tests Passed Successfully! ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
