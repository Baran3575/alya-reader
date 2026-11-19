// Automated verification of lazy volume chunks (book-<vol>.json + bundle-en-<vol>.json),
// manifest size across all 11 volumes, p.en separation, localStorage quota safety,
// file:// fallback, and Service Worker subpath caching.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { buildBook, buildBookEn, VOLUMES, VOLUME_KEYS } = require('../server.js');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const BUNDLES_DIR = path.join(PUB, 'bundles');
const BUILD_SCRIPT = path.join(ROOT, 'scripts', 'build_bundle.js');

function testBuildAndManifestMetrics() {
  console.log('Testing scripts/build_bundle.js output across all 11 volumes, manifest size, TR/EN chunks, and WebP assets...');
  execFileSync(process.execPath, [BUILD_SCRIPT], { cwd: ROOT, encoding: 'utf8' });

  assert(!fs.existsSync(path.join(PUB, 'bundle.js')), 'Legacy public/bundle.js must not exist');
  assert(!fs.existsSync(path.join(PUB, 'bundle-art.js')), 'Legacy public/bundle-art.js must not exist');

  const manifestPath = path.join(BUNDLES_DIR, 'manifest.js');
  assert(fs.existsSync(manifestPath), 'public/bundles/manifest.js must exist');
  const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
  const manifestBytes = Buffer.byteLength(manifestRaw, 'utf8');
  assert(manifestBytes < 10 * 1024, `manifest.js across all 11 volumes must be < 10 KB, got ${manifestBytes} B`);

  const sandbox = { window: {} };
  vm.runInNewContext(manifestRaw, sandbox);
  const manifest = sandbox.window.ALYA_MANIFEST;
  assert(manifest && manifest.version && manifest.volumes, 'window.ALYA_MANIFEST must be defined');
  assert.deepStrictEqual(
    Array.from(manifest.order),
    VOLUME_KEYS,
    'Manifest order must list all 11 canonical volumes in chronological order',
  );
  for (const k of VOLUME_KEYS) {
    assert(manifest.volumes[k], `Manifest volumes must include ${k}`);
  }

  let v4And45WebpCount = 0;
  let allWebpCount = 0;

  for (const volKey of VOLUME_KEYS) {
    const jsonPath = path.join(BUNDLES_DIR, `book-${volKey}.json`);
    const jsPath = path.join(BUNDLES_DIR, `book-${volKey}.js`);
    const enJsonPath = path.join(BUNDLES_DIR, `bundle-en-${volKey}.json`);
    const enJsPath = path.join(BUNDLES_DIR, `bundle-en-${volKey}.js`);
    assert(fs.existsSync(jsonPath), `${jsonPath} must exist`);
    assert(fs.existsSync(jsPath), `${jsPath} must exist`);
    assert(fs.existsSync(enJsonPath), `${enJsonPath} must exist`);
    assert(fs.existsSync(enJsPath), `${enJsPath} must exist`);

    const book = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const bookEn = JSON.parse(fs.readFileSync(enJsonPath, 'utf8'));
    assert(Array.isArray(book.pages) && book.pages.length > 0, `Vol ${volKey} pages must be non-empty`);
    assert(Array.isArray(book.chapters) && book.chapters.length > 1, `Vol ${volKey} chapters must be extracted`);
    assert(
      bookEn && typeof bookEn.pages === 'object' && Object.keys(bookEn.pages).length > 0,
      `bundle-en-${volKey}.json must retain English source pages for Orijinal mode`,
    );

    for (const p of book.pages) {
      assert(!('en' in p), `Page ${p.n} in book-${volKey}.json must not include p.en`);
      assert(typeof p.img === 'string' && !p.img.startsWith('/'), `Page ${p.n} img path must be relative: ${p.img}`);
      if (p.art) {
        const webpFile = path.join(PUB, p.img);
        assert(fs.existsSync(webpFile), `WebP illustration must exist: ${webpFile}`);
        const buf = fs.readFileSync(webpFile);
        assert.strictEqual(buf.slice(0, 4).toString('ascii'), 'RIFF', 'WebP must start with RIFF');
        assert.strictEqual(buf.slice(8, 12).toString('ascii'), 'WEBP', 'WebP must have WEBP signature');
        allWebpCount += 1;
        if (volKey === '4' || volKey === '4.5') v4And45WebpCount += 1;
      }
    }

    // Verify book-<vol>.js and bundle-en-<vol>.js script fallbacks evaluate identically
    const chunkBox = { window: {} };
    vm.runInNewContext(fs.readFileSync(jsPath, 'utf8'), chunkBox);
    vm.runInNewContext(fs.readFileSync(enJsPath, 'utf8'), chunkBox);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(chunkBox.window.ALYA_CHUNKS[volKey])),
      book,
      `book-${volKey}.js fallback must match book-${volKey}.json`,
    );
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(chunkBox.window.ALYA_EN_CHUNKS[volKey])),
      bookEn,
      `bundle-en-${volKey}.js fallback must match bundle-en-${volKey}.json`,
    );
  }
  assert.strictEqual(v4And45WebpCount, 31, 'All 31 WebP illustrations across Vol 4 and Vol 4.5 must be preserved');
  assert(allWebpCount >= 150, `Expected >=150 total WebP illustrations across 11 volumes, got ${allWebpCount}`);
  console.log(`  ✓ 11-volume manifest (${manifestBytes} B < 10 KB), TR + EN chunks, and ${allWebpCount} WebPs verified`);
}

function testServerBuildBookSeparatesEn() {
  console.log('Testing server.js buildBook omits p.en while buildBookEn preserves English source...');
  const v4 = buildBook(VOLUMES['4']);
  const v45 = buildBook(VOLUMES['4.5']);
  const v4En = buildBookEn(VOLUMES['4']);

  assert.strictEqual(v4.chapters.length, 13, 'Vol 4 must retain all 13 chapter entries');
  assert.strictEqual(v45.chapters.length, 14, 'Vol 4.5 must retain all 14 chapter entries');
  assert(v4.pages.every((p) => !('en' in p)), 'server.js buildBook(4) must omit p.en');
  assert(v45.pages.every((p) => !('en' in p)), 'server.js buildBook(4.5) must omit p.en');
  assert(Array.isArray(v4En.pages['14']) && v4En.pages['14'].length > 0, 'buildBookEn(4) must preserve English text');

  // Measure size reduction vs including English source paragraphs across all 11 volumes
  const withEnAll = {};
  const slimAll = {};
  for (const k of VOLUME_KEYS) {
    withEnAll[k] = buildBook({ ...VOLUMES[k], includeEn: true });
    slimAll[k] = buildBook(VOLUMES[k]);
  }
  const withEnStr = JSON.stringify({ vols: withEnAll });
  const slimStr = JSON.stringify({ vols: slimAll });
  const charReductionPct = (1 - slimStr.length / withEnStr.length) * 100;
  const byteReductionPct = (1 - Buffer.byteLength(slimStr) / Buffer.byteLength(withEnStr)) * 100;
  assert(charReductionPct > 45, `Expected >45% 11-volume JSON char reduction, got ${charReductionPct.toFixed(2)}%`);
  assert(byteReductionPct > 44, `Expected >44% 11-volume UTF-8 byte reduction, got ${byteReductionPct.toFixed(2)}%`);
  console.log(
    `  ✓ buildBook separates p.en cleanly (${charReductionPct.toFixed(2)}% char / ${byteReductionPct.toFixed(2)}% UTF-8 reduction across 11 volumes)`,
  );
}

function testIndexHtmlNoBlockingBundles() {
  console.log('Testing public/index.html script tags...');
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert(!html.includes('bundle.js"'), 'index.html must not load monolithic bundle.js');
  assert(!html.includes('bundle-art.js'), 'index.html must not load monolithic bundle-art.js');
  const manifestIdx = html.indexOf('<script src="bundles/manifest.js"></script>');
  const appIdx = html.indexOf('<script src="app.js"></script>');
  assert(manifestIdx > 0 && appIdx > manifestIdx, 'index.html must load bundles/manifest.js before app.js');
  console.log('  ✓ public/index.html loads only bundles/manifest.js and app.js');
}

async function testServiceWorkerRootAndSubpath() {
  console.log('Testing public/sw.js caching of TR chunks, EN chunks, and WebPs on root and subpath scopes...');
  const swCode = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');

  for (const scope of ['http://localhost:3000/', 'https://baran3575.github.io/alya-reader/']) {
    const store = new Map();
    let online = true;
    const networkHits = [];

    const mockCaches = {
      async open(name) {
        if (!store.has(name)) store.set(name, new Map());
        const bucket = store.get(name);
        return {
          async add(url) {
            const res = await mockFetch({ url, method: 'GET' });
            if (!res.ok) throw new Error('Failed add ' + url);
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
      Promise,
    });

    let installPromise;
    listeners.install({ waitUntil: (p) => (installPromise = p) });
    await installPromise;

    const bucket = store.get('alya-v4');
    assert(bucket, `Cache bucket alya-v4 must be created for ${scope}`);
    assert(bucket.has(new URL('index.html', scope).href), `Scoped index.html must be cached for ${scope}`);
    assert(
      bucket.has(new URL('bundles/manifest.js', scope).href),
      `Scoped bundles/manifest.js must be cached for ${scope}`,
    );

    const dispatchFetch = async (rel, mode = 'cors') => {
      let responded;
      const req = { url: new URL(rel, scope).href, method: 'GET', mode };
      listeners.fetch({
        request: req,
        respondWith: (p) => {
          responded = p;
        },
      });
      assert(responded, `sw.js must handle ${req.url}`);
      return responded;
    };

    const chunkRes1 = await dispatchFetch('bundles/book-4.json?v=abc123');
    assert.strictEqual(await chunkRes1.text(), 'payload:' + new URL('bundles/book-4.json?v=abc123', scope).href);
    const enChunkRes1 = await dispatchFetch('bundles/bundle-en-4.json?v=en123');
    assert.strictEqual(await enChunkRes1.text(), 'payload:' + new URL('bundles/bundle-en-4.json?v=en123', scope).href);
    const webpRes1 = await dispatchFetch('bundles/art/4/004.webp');
    assert.strictEqual(await webpRes1.text(), 'payload:' + new URL('bundles/art/4/004.webp', scope).href);

    // Go offline -> shell, manifest, TR chunk, EN chunk, and WebP all serve from CacheStorage!
    online = false;
    const hitsBeforeOffline = networkHits.length;
    const offlineNav = await dispatchFetch('', 'navigate');
    assert(offlineNav && offlineNav.ok, `Offline navigation must succeed on ${scope}`);
    const offlineManifest = await dispatchFetch('bundles/manifest.js');
    assert(offlineManifest && offlineManifest.ok, `Offline manifest must succeed on ${scope}`);
    const offlineChunk = await dispatchFetch('bundles/book-4.json?v=abc123');
    assert(offlineChunk && offlineChunk.ok, `Offline volume TR chunk must succeed on ${scope}`);
    const offlineEnChunk = await dispatchFetch('bundles/bundle-en-4.json?v=en123');
    assert(offlineEnChunk && offlineEnChunk.ok, `Offline volume EN chunk must succeed on ${scope}`);
    const offlineWebp = await dispatchFetch('bundles/art/4/004.webp');
    assert(offlineWebp && offlineWebp.ok, `Offline WebP asset must succeed on ${scope}`);
    assert.strictEqual(networkHits.length, hitsBeforeOffline, 'Zero network hits while offline');
  }
  console.log('  ✓ Service Worker root and GitHub Pages subpath caching verified for TR, EN, and WebP assets');
}

async function testAppMultiVolumeLazyEnAndFileFallback() {
  console.log('Testing app.js legacy purge, 11-volume localStorage bounds, lazy bundle-en loading, and file:// fallback...');
  const appCode = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
  const v4Book = JSON.parse(fs.readFileSync(path.join(BUNDLES_DIR, 'book-4.json'), 'utf8'));
  const v4En = JSON.parse(fs.readFileSync(path.join(BUNDLES_DIR, 'bundle-en-4.json'), 'utf8'));

  const volNames = VOLUME_KEYS;
  const manifest = { version: 'test11', defaultVol: '4', order: [...volNames], volumes: {} };
  for (const v of volNames) {
    manifest.volumes[v] = {
      volume: 'Cilt ' + v,
      total: v4Book.total,
      chapters: v4Book.chapters.length,
      fullScans: false,
      hash: 'h' + v,
      enHash: 'eh' + v,
      json: `bundles/book-${v}.json`,
      js: `bundles/book-${v}.js`,
      enJson: `bundles/bundle-en-${v}.json`,
      enJs: `bundles/bundle-en-${v}.js`,
    };
  }

  function makeStorage(quotaBytes = 5 * 1024 * 1024) {
    const map = new Map();
    const usedBytes = () => {
      let total = 0;
      for (const [k, v] of map.entries()) total += (k.length + v.length) * 2;
      return total;
    };
    return {
      map,
      usedBytes,
      get length() {
        return map.size;
      },
      key(i) {
        return Array.from(map.keys())[i] ?? null;
      },
      getItem(k) {
        return map.has(k) ? map.get(k) : null;
      },
      setItem(k, v) {
        const str = String(v);
        const prev = map.get(k) || '';
        const nextBytes = usedBytes() - (map.has(k) ? (k.length + prev.length) * 2 : 0) + (k.length + str.length) * 2;
        if (nextBytes > quotaBytes) {
          const err = new Error('QuotaExceededError');
          err.name = 'QuotaExceededError';
          throw err;
        }
        map.set(k, str);
      },
      removeItem(k) {
        map.delete(k);
      },
    };
  }

  function createEnv({ protocol, failFetch, initialPage = 14 }) {
    const storage = makeStorage();
    storage.map.set('alya4:book:4', JSON.stringify(v4Book));
    storage.map.set('alya4:bookver:4', '"legacy"');
    storage.map.set('alya4:book:4.5', '{"legacy":true}');
    storage.map.set('alya4:page', JSON.stringify(initialPage));

    const elements = new Map();
    const makeEl = (tag, id = '') => {
      const listeners = {};
      let _text = '';
      const el = {
        tagName: String(tag).toUpperCase(),
        id,
        className: '',
        hidden: false,
        disabled: false,
        value: '1',
        max: '13',
        dataset: {},
        style: { setProperty() {} },
        children: [],
        get textContent() {
          if (this.children.length === 0) return _text;
          return _text + this.children.map((c) => c.textContent || '').join('');
        },
        set textContent(v) {
          _text = String(v);
          this.children = [];
        },
        get innerHTML() {
          return '';
        },
        set innerHTML(_v) {
          _text = '';
          this.children = [];
        },
        classList: {
          _set: new Set(),
          add(c) {
            this._set.add(c);
          },
          remove(c) {
            this._set.delete(c);
          },
          toggle(c, force) {
            if (force === undefined) {
              if (this._set.has(c)) this._set.delete(c);
              else this._set.add(c);
            } else if (force) this._set.add(c);
            else this._set.delete(c);
          },
          contains(c) {
            return this._set.has(c);
          },
        },
        setAttribute(k, v) {
          this[k] = v;
        },
        getAttribute(k) {
          return this[k] || null;
        },
        removeAttribute(k) {
          delete this[k];
        },
        addEventListener(ev, fn) {
          (listeners[ev] = listeners[ev] || []).push(fn);
        },
        click() {
          (listeners.click || []).forEach((fn) => fn({ preventDefault() {}, stopPropagation() {}, target: el }));
        },
        append(...nodes) {
          nodes.forEach((n) => this.appendChild(n));
        },
        appendChild(child) {
          if (child && child._isFrag) {
            child.children.forEach((c) => this.children.push(c));
          } else if (child) {
            this.children.push(child);
            if (child.id) elements.set(child.id, child);
            if (this.tagName === 'HEAD' && child.tagName === 'SCRIPT' && child.src) {
              setImmediate(() => {
                const trM = child.src.match(/bundles\/book-(.+)\.js$/);
                const enM = child.src.match(/bundles\/bundle-en-(.+)\.js$/);
                if (trM) {
                  const v = trM[1];
                  (win.ALYA_CHUNKS = win.ALYA_CHUNKS || {})[v] = { ...v4Book, volume: 'Cilt ' + v };
                  if (child.onload) child.onload();
                } else if (enM) {
                  const v = enM[1];
                  (win.ALYA_EN_CHUNKS = win.ALYA_EN_CHUNKS || {})[v] = { ...v4En, volume: 'Cilt ' + v };
                  if (child.onload) child.onload();
                } else if (child.onerror) {
                  child.onerror();
                }
              });
            }
          }
          return child;
        },
        replaceChildren(...nodes) {
          this.children = [];
          this.append(...nodes);
        },
        remove() {},
        contains() {
          return false;
        },
        querySelector(sel) {
          if (sel === 'img') return makeEl('img');
          return null;
        },
        querySelectorAll() {
          return this.children;
        },
        getBoundingClientRect() {
          return { top: 0, height: 1000 };
        },
        scrollIntoView() {},
      };
      if (id) elements.set(id, el);
      return el;
    };

    for (const id of [
      'reader',
      'offline',
      'progressBar',
      'homeBtn',
      'brandSub',
      'volSelector',
      'vol4',
      'vol45',
      'tocBtn',
      'tocLabel',
      'modeText',
      'modePage',
      'fontDown',
      'fontUp',
      'chPct',
      'modeBtn',
      'themeBtn',
      'tocPanel',
      'tocList',
      'prevBtn',
      'navChapter',
      'navPages',
      'pageRange',
      'nextBtn',
      'lightbox',
    ]) {
      makeEl('div', id);
    }
    elements.get('tocPanel').hidden = true;
    elements.get('lightbox').hidden = true;

    const head = makeEl('head');
    const body = makeEl('body');
    const documentElement = makeEl('html');
    const doc = {
      title: '',
      head,
      body,
      documentElement,
      getElementById(id) {
        return elements.get(id) || makeEl('div', id);
      },
      createElement(tag) {
        return makeEl(tag);
      },
      createTextNode(str) {
        return { textContent: String(str), children: [] };
      },
      createDocumentFragment() {
        return { _isFrag: true, children: [], appendChild(c) { this.children.push(c); } };
      },
      querySelector(sel) {
        if (sel === '.seg-vol') return elements.get('volSelector');
        return makeEl('meta');
      },
      querySelectorAll(sel) {
        if (sel === '.seg-vol .seg-btn') return elements.get('volSelector').children;
        return [];
      },
      addEventListener() {},
    };

    const fetchCalls = [];
    const win = {
      ALYA_MANIFEST: manifest,
      document: doc,
      localStorage: storage,
      navigator: { onLine: true },
      location: {
        protocol,
        search: '',
        href: protocol === 'file:' ? 'file:///app/public/index.html' : 'https://example.github.io/alya-reader/',
      },
      scrollY: 0,
      innerHeight: 800,
      matchMedia: () => ({ matches: false }),
      addEventListener() {},
      scrollTo() {},
      requestAnimationFrame: (cb) => {
        cb();
        return 1;
      },
      Image: function () {},
      fetch: async (url) => {
        fetchCalls.push(url);
        if (failFetch) throw new TypeError('Failed to fetch');
        const trM = String(url).match(/bundles\/book-([^?]+)\.json/);
        if (trM) {
          const payload = JSON.stringify({ ...v4Book, volume: 'Cilt ' + trM[1] });
          return {
            ok: true,
            status: 200,
            clone() {
              return this;
            },
            async json() {
              return JSON.parse(payload);
            },
          };
        }
        const enM = String(url).match(/bundles\/bundle-en-([^?]+)\.json/);
        if (enM) {
          const payload = JSON.stringify({ ...v4En, volume: 'Cilt ' + enM[1] });
          return {
            ok: true,
            status: 200,
            clone() {
              return this;
            },
            async json() {
              return JSON.parse(payload);
            },
          };
        }
        return { ok: false, status: 404 };
      },
    };
    win.window = win;

    vm.runInNewContext(appCode, {
      window: win,
      document: doc,
      localStorage: storage,
      navigator: win.navigator,
      location: win.location,
      fetch: win.fetch,
      URL,
      URLSearchParams,
      Map,
      Set,
      Promise,
      Image: win.Image,
      requestAnimationFrame: win.requestAnimationFrame,
    });

    return { storage, elements, doc, fetchCalls };
  }

  // 1. HTTP/GitHub Pages mode: startup fetches ONLY book-4.json (zero bundle-en-* in Çeviri mode)
  const httpEnv = createEnv({ protocol: 'https:', failFetch: false });
  await new Promise((r) => setTimeout(r, 30));

  for (const k of httpEnv.storage.map.keys()) {
    assert(!k.startsWith('alya4:book:'), `Legacy key ${k} must be purged on startup`);
    assert(!k.startsWith('alya4:bookver:'), `Legacy key ${k} must be purged on startup`);
  }
  assert.strictEqual(httpEnv.fetchCalls.length, 1, 'Initial startup must fetch only the active TR volume chunk');
  assert(
    !httpEnv.fetchCalls.some((u) => String(u).includes('bundle-en-')),
    'bundle-en-<vol>.json must NOT be fetched in default Çeviri mode',
  );

  // Verify volume switcher buttons render in chronological order (4, 4.5, 5..9, 9.5, 10..12)
  const renderedVolOrder = httpEnv.elements.get('volSelector').children.map((b) => b.dataset.vol);
  assert.deepStrictEqual(
    renderedVolOrder,
    VOLUME_KEYS,
    'Header volume buttons must preserve chronological reading order (including 4.5 and 9.5)',
  );

  // Switch across all 11 volumes in Çeviri mode
  for (const v of volNames) {
    const btnId = 'vol' + v.replace(/[^a-zA-Z0-9]/g, '');
    const btn = httpEnv.elements.get(btnId);
    assert(btn, `Volume button #${btnId} must exist`);
    btn.click();
    await new Promise((r) => setTimeout(r, 15));
    assert.strictEqual(httpEnv.elements.get('brandSub').textContent, `Cilt ${v} · Türkçe`);
  }
  assert(
    !httpEnv.fetchCalls.some((u) => String(u).includes('bundle-en-')),
    'Switching across all 11 volumes in Çeviri mode must fetch zero bundle-en-* chunks',
  );

  // Jump to Chapter 1 (text page) and switch to Orijinal mode on Vol 12 -> lazily fetches ONLY bundle-en-12.json!
  const ch1Page = String(v4Book.chapters[1].page);
  httpEnv.elements.get('homeBtn').click();
  httpEnv.elements.get('modePage').click();
  await new Promise((r) => setTimeout(r, 30));
  const enFetches = httpEnv.fetchCalls.filter((u) => String(u).includes('bundle-en-'));
  assert.strictEqual(enFetches.length, 1, 'Orijinal mode must lazily fetch only the active volume bundle-en chunk');
  assert(String(enFetches[0]).includes('bundle-en-12.json'), 'Must fetch bundle-en-12.json');
  assert(
    httpEnv.elements.get('reader').textContent.includes(v4En.pages[ch1Page][0].slice(0, 20)),
    'Orijinal mode must render English prose from bundle-en chunk',
  );

  for (const k of httpEnv.storage.map.keys()) {
    assert(!k.startsWith('alya4:book:'), `Zero alya4:book:* keys allowed after opening 11 volumes, found ${k}`);
    assert(!k.startsWith('alya4:bookver:'), `Zero alya4:bookver:* keys allowed, found ${k}`);
  }
  const lsBytes = httpEnv.storage.usedBytes();
  assert(lsBytes < 5 * 1024, `localStorage usage across 11 volumes must stay < 5 KB, got ${lsBytes} B`);

  // 2. file:// mode: fetch fails -> falls back to book-<vol>.js AND bundle-en-<vol>.js!
  const fileEnv = createEnv({ protocol: 'file:', failFetch: true });
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(fileEnv.elements.get('brandSub').textContent, 'Cilt 4 · Türkçe');
  fileEnv.elements.get('homeBtn').click();
  fileEnv.elements.get('modePage').click();
  await new Promise((r) => setTimeout(r, 30));
  assert(
    fileEnv.elements.get('reader').textContent.includes(v4En.pages[ch1Page][0].slice(0, 20)),
    'file:// Orijinal mode must load English prose via bundle-en-4.js fallback',
  );
  fileEnv.elements.get('modeText').click();
  fileEnv.elements.get('vol45').click();
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(fileEnv.elements.get('brandSub').textContent, 'Cilt 4.5 · Türkçe');

  console.log(`  ✓ Legacy purge, 11-volume localStorage (${lsBytes} B < 5 KB), lazy bundle-en loading, and file:// fallback verified`);
}

async function runAll() {
  console.log('=== Starting Lazy Volume Chunks & CacheStorage Verification Tests ===\n');
  testBuildAndManifestMetrics();
  testServerBuildBookSeparatesEn();
  testIndexHtmlNoBlockingBundles();
  await testServiceWorkerRootAndSubpath();
  await testAppMultiVolumeLazyEnAndFileFallback();
  console.log('\n=== All Lazy Bundle & CacheStorage Tests Passed! ===');
}

runAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
