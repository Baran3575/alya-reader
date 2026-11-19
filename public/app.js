(() => {
  const RU_ROMANIZED = {
    'Sen daha güzelsin.': 'Ty krasivaya.',
  };

  function renderParagraph(t, doc, glosses = RU_ROMANIZED) {
    const d = doc || document;
    const el = d.createElement('p');
    if (/^[“"—–{-]/.test(t)) {
      el.className = t[0] === '{' ? 'dialog dialog-ru' : 'dialog';
    } else if (/^[(\[]/.test(t)) {
      el.className = 'thought';
    }
    let pos = 0;
    while (pos < t.length) {
      const open = t.indexOf('{', pos);
      if (open === -1) {
        el.appendChild(d.createTextNode(t.slice(pos)));
        break;
      }
      if (open > pos) {
        el.appendChild(d.createTextNode(t.slice(pos, open)));
      }
      const close = t.indexOf('}', open + 1);
      if (close === -1) {
        el.appendChild(d.createTextNode(t.slice(open)));
        break;
      }
      const nextOpen = t.indexOf('{', open + 1);
      if (nextOpen !== -1 && nextOpen < close) {
        el.appendChild(d.createTextNode(t.slice(open, nextOpen)));
        pos = nextOpen;
        continue;
      }
      const inner = t.slice(open + 1, close);
      if (!inner) {
        el.appendChild(d.createTextNode('{}'));
        pos = close + 1;
        continue;
      }
      el.appendChild(d.createTextNode('{'));
      const span = d.createElement('span');
      span.className = 'ru-dialog';
      span.appendChild(d.createTextNode(inner));
      const roma = glosses && Object.prototype.hasOwnProperty.call(glosses, inner) ? glosses[inner] : '';
      if (roma) {
        span.dataset.ru = roma;
        span.title = roma;
      }
      el.appendChild(span);
      el.appendChild(d.createTextNode('}'));
      pos = close + 1;
    }
    return el;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderParagraph, RU_ROMANIZED };
  }
  if (typeof window !== 'undefined') {
    window.ALYA_RENDER_PARAGRAPH = renderParagraph;
  }
  if (typeof document === 'undefined') return;

  const $ = (id) => document.getElementById(id);
  const reader = $('reader');

  const CACHE_NAME = 'alya-v4';
  const bookCache = new Map();
  const inflightBooks = new Map();
  const enCache = new Map();
  const inflightEn = new Map();
  const enFailed = new Set();
  let loadSeq = 0;

  const LS = {
    get(k, d) {
      try {
        const v = localStorage.getItem('alya4:' + k);
        return v === null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('alya4:' + k, JSON.stringify(v));
      } catch {}
    },
  };

  function purgeLegacyBooks() {
    try {
      const stale = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('alya4:book:') || k.startsWith('alya4:bookver:'))) {
          stale.push(k);
        }
      }
      for (const k of stale) localStorage.removeItem(k);
    } catch {}
  }
  purgeLegacyBooks();

  const manifest = () => window.ALYA_MANIFEST || { defaultVol: '4', volumes: {} };

  // URL sorgusu (?vol=9.5&page=12) ile doğrudan cilt/sayfa açma desteği
  const searchStr = (window.location && window.location.search) || '';
  const urlParams = typeof URLSearchParams !== 'undefined' ? new URLSearchParams(searchStr) : null;
  const initialUrlVol = urlParams ? urlParams.get('vol') || urlParams.get('v') : null;
  const initialUrlPage = urlParams ? Number(urlParams.get('page') || urlParams.get('p') || 0) : 0;

  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  const state = {
    page: initialUrlPage > 0 ? initialUrlPage : LS.get('page', 1),
    mode: LS.get('mode', 'text'),
    theme: LS.get('theme', prefersLight ? 'light' : 'dark'),
    size: LS.get('size', 1.06),
    vol: initialUrlVol || LS.get('vol', manifest().defaultVol || '4'),
    book: null,
    chapter: 0,
  };
  if (manifest().volumes && Object.keys(manifest().volumes).length > 0 && !manifest().volumes[state.vol]) {
    state.vol = manifest().defaultVol || Object.keys(manifest().volumes)[0] || '4';
  }

  /* ---------------- cilt ---------------- */
  function switchVolume(v, targetPage) {
    const key = String(v);
    if (key === String(state.vol)) {
      if (targetPage && targetPage > 0) goPage(targetPage);
      return Promise.resolve();
    }
    LS.set('page:' + state.vol, state.page);
    state.vol = key;
    LS.set('vol', key);
    state.page = targetPage && targetPage > 0 ? targetPage : LS.get('page:' + key, 1);
    return load().catch((err) => {
      const p = document.createElement('p');
      p.className = 'empty-note';
      p.textContent = 'Cilt ' + key + ' yüklenemedi: ' + err.message;
      reader.replaceChildren(p);
    });
  }

  function measureChrome() {
    const bar = document.querySelector('.bar');
    if (!bar) return;
    const h = bar.offsetHeight;
    if (h > 20) document.documentElement.style.setProperty('--bar-h', h + 'px');
  }
  window.addEventListener('resize', measureChrome);
  window.addEventListener('orientationchange', () => setTimeout(measureChrome, 120));

  /* ---------------- cilt / bölüm seçimi + okundu işaretleri ---------------- */
  const volTitle = {
    '4': 'Cilt 4', '4.5': 'Cilt 4.5', '5': 'Cilt 5', '6': 'Cilt 6', '7': 'Cilt 7',
    '8': 'Cilt 8', '9': 'Cilt 9', '9.5': 'Cilt 9.5', '10': 'Cilt 10', '11': 'Cilt 11', '12': 'Cilt 12',
  };

  function orderedVolumeKeys() {
    const m = manifest();
    const vols = m.volumes || {};
    if (Array.isArray(m.order) && m.order.length > 0) {
      return m.order.filter((k) => Boolean(vols[k]));
    }
    const keys = Object.keys(vols);
    if (keys.length > 0) return keys.sort((a, b) => parseFloat(a) - parseFloat(b));
    return Object.keys(volTitle);
  }

  function getVolChapters(volKey) {
    const k = String(volKey);
    if (state.book && String(state.vol) === k && Array.isArray(state.book.chapters)) {
      return state.book.chapters;
    }
    if (bookCache.has(k) && Array.isArray(bookCache.get(k).chapters)) {
      return bookCache.get(k).chapters;
    }
    const entry = manifest().volumes && manifest().volumes[k];
    if (entry && Array.isArray(entry.toc)) {
      return entry.toc.map((row) => {
        const label = typeof row[1] === 'number' ? 'Bölüm ' + row[1] : String(row[1] || '');
        return {
          page: row[0],
          label,
          title: row[2] || '',
          ...(row[3] ? { pending: true } : {}),
        };
      });
    }
    return [];
  }

  function getVolTotalPages(volKey) {
    const k = String(volKey);
    if (state.book && String(state.vol) === k) return state.book.total;
    if (bookCache.has(k)) return bookCache.get(k).total;
    const entry = manifest().volumes && manifest().volumes[k];
    return (entry && entry.total) || 0;
  }

  function getVolContainer() {
    return $('volSelector') || $('volSeg') || document.querySelector('.seg-vol');
  }

  function initVolumeButtons() {
    const seg = getVolContainer();
    if (!seg) return;
    const vols = manifest().volumes || {};
    const keys = orderedVolumeKeys();
    if (keys.length > 0) {
      seg.innerHTML = '';
      for (const k of keys) {
        const btn = document.createElement('button');
        btn.id = 'vol' + k.replace(/[^a-zA-Z0-9]/g, '');
        btn.dataset.vol = k;
        btn.className = 'seg-btn' + (k === String(state.vol) ? ' is-on' : '');
        btn.type = 'button';
        btn.title = (vols[k] && vols[k].volume) || volTitle[k] || 'Cilt ' + k;
        btn.textContent = k;
        btn.addEventListener('click', () => switchVolume(k));
        seg.appendChild(btn);
      }
      return;
    }
    seg.querySelectorAll('[data-vol]').forEach((btn) => {
      btn.addEventListener('click', () => switchVolume(btn.dataset.vol));
    });
  }
  initVolumeButtons();

  function readSet(vol) {
    const v = LS.get('read:' + vol, []);
    return Array.isArray(v) ? v : [];
  }
  function isRead(vol, i) {
    return readSet(vol).includes(i);
  }
  function setRead(vol, i, on) {
    const set = new Set(readSet(vol));
    if (on) set.add(i);
    else set.delete(i);
    LS.set('read:' + vol, [...set].sort((x, y) => x - y));
  }
  function readCount(vol) {
    return readSet(vol);
  }

  const libView = $('libView');
  const libList = $('libList');
  const readerEl = $('reader');
  let libKind = 'vol';
  let libVol = String(state.vol);
  let libOpen = false;

  function showLibrary(kind, volumeKey) {
    libKind = kind;
    libVol = String(volumeKey || state.vol);
    libOpen = true;
    libView.hidden = false;
    readerEl.hidden = true;
    $('volBtn').setAttribute('aria-expanded', 'true');
    $('chBtn').setAttribute('aria-expanded', 'true');
    $('libActions').hidden = kind !== 'ch';
    $('libBack').hidden = !(kind === 'ch' && volumeKey);
    buildList(libVol);
    window.scrollTo(0, 0);
    measureChrome();
  }

  function hideLibrary() {
    libOpen = false;
    libView.hidden = true;
    readerEl.hidden = false;
    $('volBtn').setAttribute('aria-expanded', 'false');
    $('chBtn').setAttribute('aria-expanded', 'false');
    measureChrome();
  }

  function buildList(volumeKey) {
    libList.innerHTML = '';
    if (libKind === 'vol') {
      $('libTitle').textContent = 'Ciltler';
      for (const key of orderedVolumeKeys()) {
        const chs = getVolChapters(key);
        const entry = manifest().volumes && manifest().volumes[key];
        const total = chs.length || (entry && entry.chapters) || 0;
        const read = readCount(key).length;
        const card = document.createElement('button');
        card.type = 'button';
        card.dataset.vol = key;
        card.className = 'lib-card' + (String(state.vol) === key ? ' is-current' : '');
        const numSpan = document.createElement('span');
        numSpan.className = 'lib-num';
        numSpan.textContent = key;
        const infoSpan = document.createElement('span');
        infoSpan.className = 'lib-info';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'lib-name';
        nameSpan.textContent = (entry && entry.volume) || volTitle[key] || 'Cilt ' + key;
        const metaSpan = document.createElement('span');
        metaSpan.className = 'lib-meta';
        metaSpan.textContent = total + ' bölüm · ' + read + '/' + total + ' okundu';
        infoSpan.append(nameSpan, metaSpan);
        const goSpan = document.createElement('span');
        goSpan.className = 'lib-go';
        goSpan.setAttribute('aria-hidden', 'true');
        goSpan.textContent = '›';
        card.append(numSpan, infoSpan, goSpan);
        card.addEventListener('click', () => showLibrary('ch', key));
        libList.appendChild(card);
      }
      return;
    }

    const vk = String(volumeKey || state.vol);
    $('libTitle').textContent = volTitle[vk] || 'Cilt ' + vk;
    const list = getVolChapters(vk);
    if (list.length === 0 && !bookCache.has(vk)) {
      readBook(vk)
        .then(() => {
          if (libOpen && libKind === 'ch' && libVol === vk) chListFor(vk, getVolChapters(vk));
        })
        .catch(() => {});
      return;
    }
    chListFor(vk, list);
  }

  function chListFor(volumeKey, list) {
    libList.innerHTML = '';
    const volTotalPages = getVolTotalPages(volumeKey);
    list.forEach((c, i) => {
      const label = (c.label || 'Bölüm ' + (i + 1)).replace(/^Cilt [\d.]+ · /, '');
      const title = c.title || '';
      const read = isRead(volumeKey, i);
      const range = c.page
        ? (() => {
            const st = c.page;
            const nxt = list[i + 1];
            const en = nxt ? nxt.page - 1 : volTotalPages || st;
            return c.pending ? 'yakında' : st === en ? 's. ' + st : 's. ' + st + '–' + en;
          })()
        : '';
      const row = document.createElement('div');
      row.className =
        'lib-row' +
        (read ? ' is-read' : '') +
        (volumeKey === String(state.vol) && i === state.chapter ? ' is-current' : '');

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'lib-main';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'lib-name';
      nameSpan.textContent = label;
      main.appendChild(nameSpan);
      if (title && title !== label) {
        const subSpan = document.createElement('span');
        subSpan.className = 'lib-sub';
        subSpan.textContent = title;
        main.appendChild(subSpan);
      }
      if (range) {
        const metaSpan = document.createElement('span');
        metaSpan.className = 'lib-meta';
        metaSpan.textContent = range;
        main.appendChild(metaSpan);
      }
      main.addEventListener('click', () => {
        hideLibrary();
        if (volumeKey !== String(state.vol)) {
          switchVolume(volumeKey, c.page);
        } else {
          goChapter(i);
        }
      });

      const check = document.createElement('button');
      check.type = 'button';
      check.className = 'lib-check' + (read ? ' is-on' : '');
      check.setAttribute('aria-pressed', String(read));
      check.setAttribute('aria-label', label + ' okundu');
      check.textContent = '✓';
      check.addEventListener('click', () => {
        const next = !isRead(volumeKey, i);
        setRead(volumeKey, i, next);
        check.classList.toggle('is-on', next);
        check.setAttribute('aria-pressed', String(next));
        row.classList.toggle('is-read', next);
        markTocRead();
      });

      row.append(main, check);
      libList.appendChild(row);
    });
  }

  $('volBtn').addEventListener('click', () => {
    if (libOpen && libKind === 'vol') hideLibrary();
    else showLibrary('vol');
  });
  $('chBtn').addEventListener('click', () => {
    if (libOpen && libKind === 'ch' && libVol === String(state.vol)) hideLibrary();
    else showLibrary('ch', String(state.vol));
  });
  $('libBack').addEventListener('click', () => showLibrary('vol'));
  $('markAllBtn').addEventListener('click', () => {
    getVolChapters(libVol).forEach((c, i) => {
      if (!c.pending) setRead(libVol, i, true);
    });
    buildList(libVol);
    markTocRead();
  });
  $('clearAllBtn').addEventListener('click', () => {
    LS.set('read:' + libVol, []);
    buildList(libVol);
    markTocRead();
  });

  function syncPickers() {
    $('volLabel').textContent = (state.book && state.book.volume) || volTitle[String(state.vol)] || 'Cilt ' + state.vol;
    const ch = state.book ? chapters()[state.chapter] : null;
    $('chLabel').textContent = ch ? (ch.title ? ch.label + ' · ' + ch.title : ch.label) : 'Bölüm';
  }

  /* ---------------- tema / yazı boyutu ---------------- */
  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    $('themeBtn').textContent = state.theme === 'dark' ? '☾' : '☀';
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', state.theme === 'dark' ? '#121110' : '#fbf9f5');
  }

  function applySize() {
    document.documentElement.style.setProperty('--reader-size', state.size.toFixed(2) + 'rem');
  }

  /* ---------------- bölüm yardımcıları ---------------- */
  const chapters = () => state.book.chapters;
  const chapterIndex = (n) => {
    let idx = 0;
    chapters().forEach((c, k) => {
      if (c.page <= n) idx = k;
    });
    return idx;
  };
  const chapterRange = (i) => {
    const start = chapters()[i].page;
    const next = chapters()[i + 1];
    return [start, next ? next.page - 1 : state.book.total];
  };

  /* ---------------- veri ---------------- */
  /* görsel: göreli WebP dosya yolu */
  function imgSrc(p) {
    return p && p.img ? String(p.img).replace(/^\/+/, '') : '';
  }

  function hasFullScans(vol) {
    if (state.book && typeof state.book.fullScans === 'boolean') return state.book.fullScans;
    const entry = manifest().volumes && manifest().volumes[vol || state.vol];
    return Boolean(entry && entry.fullScans);
  }

  function loadChunkScript(globalProp, v, jsPath) {
    return new Promise((resolve, reject) => {
      const store = window[globalProp];
      if (store && store[v]) {
        const hit = store[v];
        delete store[v];
        return resolve(hit);
      }
      const s = document.createElement('script');
      s.src = jsPath;
      s.async = true;
      s.onload = () => {
        s.remove();
        const nextStore = window[globalProp];
        const hit = nextStore && nextStore[v];
        if (hit) {
          delete nextStore[v];
          resolve(hit);
        } else {
          reject(new Error('Paket verisi bulunamadı: ' + v));
        }
      };
      s.onerror = () => {
        s.remove();
        reject(new Error('Paket betiği yüklenemedi: ' + jsPath));
      };
      document.head.appendChild(s);
    });
  }

  async function fetchJsonCached(relUrl) {
    const canCache = typeof caches !== 'undefined' && location.protocol.startsWith('http');
    const absUrl = new URL(relUrl, location.href).href;
    if (canCache) {
      try {
        const cache = await caches.open(CACHE_NAME);
        const hit = await cache.match(absUrl);
        if (hit && hit.ok) return await hit.json();
      } catch {}
    }
    const res = await fetch(relUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (canCache) {
      try {
        const copy = res.clone();
        const cache = await caches.open(CACHE_NAME);
        if (typeof cache.keys === 'function' && typeof cache.delete === 'function') {
          const targetPath = new URL(absUrl).pathname;
          const keys = await cache.keys();
          await Promise.all(
            keys
              .filter((r) => {
                const u = typeof r === 'string' ? r : r.url;
                return u !== absUrl && new URL(u).pathname === targetPath;
              })
              .map((r) => cache.delete(r)),
          );
        }
        await cache.put(absUrl, copy);
      } catch {}
    }
    return await res.json();
  }

  function hydrateBookEn(v, enData) {
    const book = bookCache.get(v);
    const pageMap = (enData && enData.pages) || {};
    if (book && Array.isArray(book.pages)) {
      for (const p of book.pages) {
        const lines = pageMap[String(p.n)];
        p.en = Array.isArray(lines) ? lines : [];
      }
    }
  }

  /* veri kaynakları: bellek içi Map -> CacheStorage / tembel JSON paketi -> file:// JS yedeği -> sunucu */
  async function readBook(v) {
    const key = String(v);
    if (bookCache.has(key)) return bookCache.get(key);
    if (window.ALYA_CHUNKS && window.ALYA_CHUNKS[key]) {
      const preloaded = window.ALYA_CHUNKS[key];
      delete window.ALYA_CHUNKS[key];
      bookCache.set(key, preloaded);
      if (enCache.has(key)) hydrateBookEn(key, enCache.get(key));
      return preloaded;
    }
    if (inflightBooks.has(key)) return inflightBooks.get(key);

    const task = (async () => {
      const entry = (manifest().volumes && manifest().volumes[key]) || null;
      const jsonRel = (entry && entry.json) || 'bundles/book-' + key + '.json';
      const jsRel = (entry && entry.js) || 'bundles/book-' + key + '.js';
      const versionedJson = entry && entry.hash ? jsonRel + '?v=' + encodeURIComponent(entry.hash) : jsonRel;

      let book = null;
      try {
        book = await fetchJsonCached(versionedJson);
      } catch {
        try {
          book = await loadChunkScript('ALYA_CHUNKS', key, jsRel);
        } catch (scriptErr) {
          if (location.protocol.startsWith('http')) {
            book = await fetchJsonCached('api/book?v=' + encodeURIComponent(key));
          } else {
            throw scriptErr;
          }
        }
      }
      bookCache.set(key, book);
      if (enCache.has(key)) hydrateBookEn(key, enCache.get(key));
      return book;
    })();

    inflightBooks.set(key, task);
    try {
      return await task;
    } finally {
      inflightBooks.delete(key);
    }
  }

  /* "Orijinal" modu İngilizce metin parçası: yalnızca ihtiyaç duyulduğunda tembel yüklenir */
  async function readBookEn(v) {
    const key = String(v);
    if (enCache.has(key)) {
      const cached = enCache.get(key);
      hydrateBookEn(key, cached);
      return cached;
    }
    if (window.ALYA_EN_CHUNKS && window.ALYA_EN_CHUNKS[key]) {
      const preloaded = window.ALYA_EN_CHUNKS[key];
      delete window.ALYA_EN_CHUNKS[key];
      enCache.set(key, preloaded);
      enFailed.delete(key);
      hydrateBookEn(key, preloaded);
      return preloaded;
    }
    if (inflightEn.has(key)) return inflightEn.get(key);

    const task = (async () => {
      const entry = (manifest().volumes && manifest().volumes[key]) || null;
      const enJsonRel = (entry && entry.enJson) || 'bundles/bundle-en-' + key + '.json';
      const enJsRel = (entry && entry.enJs) || 'bundles/bundle-en-' + key + '.js';
      const versionedEnJson =
        entry && entry.enHash ? enJsonRel + '?v=' + encodeURIComponent(entry.enHash) : enJsonRel;

      let enData = null;
      try {
        enData = await fetchJsonCached(versionedEnJson);
      } catch {
        try {
          enData = await loadChunkScript('ALYA_EN_CHUNKS', key, enJsRel);
        } catch (scriptErr) {
          if (location.protocol.startsWith('http')) {
            enData = await fetchJsonCached('api/book-en?v=' + encodeURIComponent(key));
          } else {
            throw scriptErr;
          }
        }
      }
      enCache.set(key, enData);
      enFailed.delete(key);
      hydrateBookEn(key, enData);
      return enData;
    })();

    inflightEn.set(key, task);
    try {
      return await task;
    } finally {
      inflightEn.delete(key);
    }
  }

  async function load() {
    const seq = ++loadSeq;
    const targetVol = String(state.vol);
    const loadedBook = await readBook(targetVol);
    if (seq !== loadSeq) return;
    state.book = loadedBook;
    const saved = LS.get('page:' + state.vol, 1);
    if (state.page < 1 || state.page > state.book.total) state.page = saved;

    $('brandSub').textContent = state.book.volume + ' · Türkçe';
    if ($('volLabel')) $('volLabel').textContent = state.book.volume;
    const seg = getVolContainer();
    const btns = seg ? Array.from(seg.children) : Array.from(document.querySelectorAll('.seg-vol .seg-btn'));
    btns.forEach((btn) => {
      if (!btn || !btn.classList) return;
      const on = btn.dataset && btn.dataset.vol === String(state.vol);
      btn.classList.toggle('is-on', Boolean(on));
      btn.setAttribute('aria-current', on ? 'true' : 'false');
    });
    document.title = 'Alya Bazen Duygularını Rusça Saklar · ' + state.book.volume;

    $('pageRange').max = chapters().length;

    const list = $('tocList');
    list.innerHTML = '';
    chapters().forEach((ch, i) => {
      const li = document.createElement('li');
      li.dataset.page = ch.page;
      li.dataset.idx = i;
      if (ch.pending) li.classList.add('is-pending');
      const btn = document.createElement('button');
      btn.type = 'button';
      const lab = document.createElement('span');
      lab.className = 'ch-label';
      lab.textContent = ch.label;
      const ttl = document.createElement('span');
      ttl.className = 'ch-title';
      ttl.textContent = ch.title;
      const pg = document.createElement('span');
      pg.className = 'ch-page';
      const [s, e] = chapterRange(i);
      pg.textContent = ch.pending ? 'yakında' : s === e ? s : s + '–' + e;
      btn.append(lab, ttl, pg);
      btn.addEventListener('click', () => {
        toggleToc(false);
        goChapter(i);
      });
      li.appendChild(btn);
      list.appendChild(li);
    });

    if (!(state.page >= 1 && state.page <= state.book.total)) state.page = 1;
    syncPickers();
    markTocRead();
    measureChrome();
    render();
  }

  // içindekilerde okunmuş bölümleri işaretle (en ileri sayfa bazlı)
  function markTocRead() {
    for (const li of $('tocList').children) {
      const i = Number(li.dataset.idx);
      li.classList.toggle('is-read', isRead(String(state.vol), i));
    }
  }

  /* ---------------- metin temizliği ---------------- */
  function cleanHeading(paras, ch) {
    const out = paras.slice();
    if (!out[0]) return out;
    const t = out[0];
    const q = t.indexOf('“');
    const looksHeading = /^(?:\d+\.\s*)?(Bölüm|Önsöz|Sonsöz|Epilog|Prolog|Ara Bölüm|Kısa Hikâye|Başlangıç)\b/.test(t);
    if (!looksHeading) return out;
    if (q > 0 && q < 140) {
      out[0] = t.slice(q);
    } else if (ch.title) {
      const i = t.indexOf(ch.title);
      if (i >= 0) {
        const rest = t.slice(i + ch.title.length).replace(/^[:\s"”]+/, '');
        if (rest.length > 40) out[0] = rest;
        else out.shift();
      }
    }
    return out;
  }

  function createPendingNotice(ch) {
    const box = document.createElement('div');
    box.className = 'pending-card';
    const badge = document.createElement('p');
    badge.className = 'pending-badge';
    badge.textContent = 'Çeviri Beklemede · [Translation In Progress]';
    const desc = document.createElement('p');
    desc.className = 'pending-desc';
    desc.textContent =
      ch.statusNote ||
      'Bu bölümün İngilizce kaynak çevirisi henüz yayınlanmadı ([Translation In Progress]). Kaynak metin tamamlandığında Türkçe çevirisi eklenecektir.';
    box.append(badge, desc);
    return box;
  }

  const lazyImgObserver =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(
          (entries, obs) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              const img = entry.target;
              obs.unobserve(img);
              if (img.dataset.src && !img.getAttribute('src')) {
                img.src = img.dataset.src;
              }
            }
          },
          { rootMargin: '200px 0px' },
        )
      : null;

  function figureFor(p, caption, eager) {
    const fig = document.createElement('figure');
    fig.className = 'page-img';
    const src = imgSrc(p);
    const img = document.createElement('img');
    img.alt = 'Sayfa ' + p.n;
    img.decoding = 'async';
    img.addEventListener(
      'load',
      () => {
        fig.classList.add('is-loaded');
        if (
          typeof caches !== 'undefined' &&
          location.protocol.startsWith('http') &&
          !(navigator.serviceWorker && navigator.serviceWorker.controller) &&
          img.currentSrc
        ) {
          caches
            .open(CACHE_NAME)
            .then((c) => c.match(img.currentSrc).then((h) => h || c.add(img.currentSrc)))
            .catch(() => {});
        }
        scheduleProgress();
      },
      { once: true },
    );
    img.addEventListener(
      'error',
      () => {
        fig.classList.add('is-loaded');
        fig.hidden = true;
      },
      { once: true },
    );
    if (eager || !lazyImgObserver) {
      img.src = src;
    } else {
      img.loading = 'lazy';
      img.dataset.src = src;
      lazyImgObserver.observe(img);
    }
    fig.appendChild(img);
    if (caption) {
      const cap = document.createElement('figcaption');
      cap.className = 'img-cap';
      cap.textContent = 'Sayfa ' + p.n;
      fig.appendChild(cap);
    }
    fig.addEventListener('click', () => openLightbox(src, 'Sayfa ' + p.n));
    return fig;
  }

  function openLightbox(src, alt) {
    const lb = $('lightbox');
    if (!lb) return;
    const im = lb.querySelector('img');
    im.src = src;
    im.alt = alt || '';
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    const lb = $('lightbox');
    if (!lb || lb.hidden) return false;
    lb.hidden = true;
    lb.querySelector('img').removeAttribute('src');
    document.body.style.overflow = '';
    return true;
  }

  /* ---------------- çizim (tek orijinal sayfa) ---------------- */
  function renderPage() {
    const n = Math.min(Math.max(1, state.page), state.book.total);
    const p = state.book.pages[n - 1];
    const idx = chapterIndex(n);
    state.chapter = idx;
    const ch = chapters()[idx];

    reader.innerHTML = '';

    const head = document.createElement('header');
    head.className = 'ch-head ch-head--page';
    const kicker = document.createElement('p');
    kicker.className = 'kicker';
    kicker.textContent = ch.label;
    const h1 = document.createElement('h1');
    h1.className = 'chapter-title';
    h1.textContent = ch.title;
    const meta = document.createElement('p');
    meta.className = 'ch-meta';
    meta.textContent = 'Orijinal sayfa ' + n + ' / ' + state.book.total;
    head.append(kicker, h1, meta);
    reader.appendChild(head);

    const sec = document.createElement('section');
    sec.className = 'pg pg-single';
    sec.dataset.page = n;

    if (ch.pending || (p && p.pending)) {
      sec.appendChild(createPendingNotice(ch));
    } else if (p && (p.art || hasFullScans(state.vol))) {
      sec.appendChild(figureFor(p, false, true));
    } else if (p) {
      if (!enCache.has(state.vol) && !(p.en && p.en.length) && !enFailed.has(state.vol)) {
        const loadingNote = document.createElement('p');
        loadingNote.className = 'empty-note';
        loadingNote.textContent = 'Orijinal İngilizce metin yükleniyor…';
        sec.appendChild(loadingNote);
        const targetVol = state.vol;
        readBookEn(targetVol)
          .then(() => {
            if (state.vol === targetVol && state.mode === 'page') renderPage();
          })
          .catch(() => {
            enFailed.add(targetVol);
            if (state.vol === targetVol && state.mode === 'page') renderPage();
          });
      } else if (p.en && p.en.length) {
        const proseWrap = document.createElement('div');
        proseWrap.className = 'orig-prose';
        for (const line of p.en) {
          const el = document.createElement('p');
          el.textContent = line;
          proseWrap.appendChild(el);
        }
        sec.appendChild(proseWrap);
      } else if (p.tr && p.tr.length) {
        for (const line of p.tr) {
          sec.appendChild(renderParagraph(line));
        }
      } else {
        const note = document.createElement('p');
        note.className = 'empty-note';
        note.textContent = enFailed.has(state.vol)
          ? 'Orijinal İngilizce metin çevrimdışı önbellekte bulunamadı.'
          : 'Bu sayfada metin veya illüstrasyon bulunmuyor.';
        sec.appendChild(note);
      }
    }
    reader.appendChild(sec);

    const nav = document.createElement('div');
    nav.className = 'pg-nav';
    const bPrev = document.createElement('button');
    bPrev.type = 'button';
    bPrev.className = 'pg-nav-btn';
    bPrev.textContent = '← s. ' + Math.max(1, n - 1);
    bPrev.disabled = n <= 1;
    bPrev.addEventListener('click', () => goPage(n - 1));
    const label = document.createElement('span');
    label.className = 'pg-nav-num';
    label.textContent = n + ' / ' + state.book.total;
    const bNext = document.createElement('button');
    bNext.type = 'button';
    bNext.className = 'pg-nav-btn';
    bNext.textContent = 's. ' + Math.min(state.book.total, n + 1) + ' →';
    bNext.disabled = n >= state.book.total;
    bNext.addEventListener('click', () => goPage(n + 1));
    nav.append(bPrev, label, bNext);
    reader.appendChild(nav);

    $('pageRange').value = idx + 1;
    syncPickers();
    $('navChapter').textContent = ch.label;
    $('navPages').textContent = 's. ' + n + ' / ' + state.book.total;
    $('prevBtn').disabled = n <= 1;
    $('nextBtn').disabled = n >= state.book.total;
    $('tocLabel').textContent = ch.label;
    for (const li of $('tocList').children) {
      li.classList.toggle('is-current', Number(li.dataset.idx) === idx);
    }
    $('modeText').classList.toggle('is-on', false);
    $('modePage').classList.toggle('is-on', true);
    $('modeBtn').textContent = 'Orijinal';

    LS.set('page', n);
    LS.set('page:' + state.vol, n);
    LS.set('mode', state.mode);
    paintProgress();
    window.scrollTo({ top: 0 });
  }

  function goPage(n) {
    const target = Math.min(Math.max(1, n), state.book.total);
    if (target === state.page) return;
    state.page = target;
    LS.set('page', target);
    LS.set('page:' + state.vol, target);
    render();
    prefetch();
  }

  /* ---------------- çizim (bölüm akışı) ---------------- */
  function render() {
    if (!state.book) return;
    if (state.mode === 'page') return renderPage();
    const idx = chapterIndex(state.page);
    state.chapter = idx;
    const ch = chapters()[idx];
    const [startPage, endPage] = chapterRange(idx);

    reader.innerHTML = '';

    const head = document.createElement('header');
    head.className = 'ch-head';
    const kicker = document.createElement('p');
    kicker.className = 'kicker';
    kicker.textContent = ch.label;
    const h1 = document.createElement('h1');
    h1.className = 'chapter-title';
    h1.textContent = ch.title;
    const meta = document.createElement('p');
    meta.className = 'ch-meta';
    const pages = endPage - startPage + 1;
    let words = 0;
    for (let n = startPage; n <= endPage; n++) {
      const pg = state.book.pages[n - 1];
      if (pg && pg.tr) for (const t of pg.tr) words += t.split(/\s+/).length;
    }
    const mins = Math.max(1, Math.round(words / 240));
    meta.textContent = ch.pending
      ? 'Durum: Kaynak çeviri devam ediyor'
      : 'Sayfa ' + startPage + (startPage === endPage ? '' : '–' + endPage) +
        ' · ' + pages + ' sayfa · ~' + mins + ' dk';
    head.append(kicker, h1, meta);
    reader.appendChild(head);

    if (ch.pending) {
      reader.appendChild(createPendingNotice(ch));
    } else {
      const frag = document.createDocumentFragment();
      for (let n = startPage; n <= endPage; n++) {
        const p = state.book.pages[n - 1];
        if (!p) continue;
        if (p.pending) {
          frag.appendChild(createPendingNotice(ch));
          continue;
        }
        const sec = document.createElement('section');
        sec.className = 'pg';
        sec.dataset.page = p.n;

        const isIllustration = p.art === true || (p.tr.length === 0 && hasFullScans(state.vol));
        if (!isIllustration && p.tr.length === 0) {
          continue;
        }
        if (isIllustration) {
          sec.classList.add('pg-art');
          if (p.tr.length) sec.classList.add('has-text');
          sec.appendChild(figureFor(p, true));
          if (p.tr.length === 0) {
            frag.appendChild(sec);
            continue;
          }
        }

        const paras = n === startPage ? cleanHeading(p.tr, ch) : p.tr;
        for (const t of paras) {
          if (!t) continue;
          sec.appendChild(renderParagraph(t));
        }
        frag.appendChild(sec);
      }
      reader.appendChild(frag);
    }

    // bölüm sonu
    const last = idx === chapters().length - 1;
    const foot = document.createElement('div');
    foot.className = 'ch-end';
    const note = document.createElement('p');
    note.className = 'ch-end-note';
    note.textContent = last ? '— Cilt sonu —' : '— Bölüm sonu —';
    foot.appendChild(note);
    if (!last) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ch-end-btn';
      b.textContent = 'Sonraki: ' + chapters()[idx + 1].label + ' · ' + chapters()[idx + 1].title + ' →';
      b.addEventListener('click', () => goChapter(idx + 1));
      foot.appendChild(b);
    }
    reader.appendChild(foot);

    // durum satırı
    $('pageRange').value = idx + 1;
    syncPickers();
    $('navChapter').textContent = ch.label;
    $('navPages').textContent = ch.pending
      ? 'beklemede'
      : startPage === endPage ? 's. ' + startPage : 's. ' + startPage + '–' + endPage;
    $('prevBtn').disabled = idx <= 0;
    $('nextBtn').disabled = last;
    $('tocLabel').textContent = ch.label;
    for (const li of $('tocList').children) {
      li.classList.toggle('is-current', Number(li.dataset.idx) === idx);
    }
    $('modeText').classList.toggle('is-on', state.mode === 'text');
    $('modePage').classList.toggle('is-on', state.mode === 'page');
    $('modeBtn').textContent = state.mode === 'text' ? 'Çeviri' : 'Orijinal';

    const targetPage = Math.min(Math.max(startPage, state.page), endPage);
    if ($('navCount')) $('navCount').textContent = 's. ' + targetPage;
    LS.set('page', targetPage);
    LS.set('page:' + state.vol, targetPage);
    if (!ch.pending) {
      const prevMax2 = LS.get('max:' + state.vol, 0);
      if (targetPage > prevMax2) LS.set('max:' + state.vol, targetPage);
    }
    markTocRead();
    LS.set('mode', state.mode);

    // çeviriye dönerken görünen sayfaya dön, bölüm değişiminde başa dön
    const anchorPt = targetPage > startPage ? reader.querySelector('.pg[data-page="' + targetPage + '"]') : null;
    if (anchorPt) requestAnimationFrame(() => anchorPt.scrollIntoView({ block: 'start' }));
    else window.scrollTo({ top: 0, behavior: 'auto' });
    scheduleProgress();
    prefetch();
  }

  /* ---------------- bölüm içi ilerleme ---------------- */
  let rafId = 0;
  function scheduleProgress() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      paintProgress();
    });
  }

  function paintProgress() {
    if (!state.book) return;
    if (state.mode === 'page') {
      const pct = state.page / state.book.total;
      $('progressBar').style.width = (pct * 100).toFixed(2) + '%';
      $('chPct').textContent = '%' + Math.round(pct * 100);
      return;
    }
    const rect = reader.getBoundingClientRect();
    const top = window.scrollY + rect.top;
    const span = rect.height - window.innerHeight + 120;
    let pct;
    if (span <= 8) pct = window.scrollY > top - 20 ? 1 : 0;
    else pct = (window.scrollY - top + 60) / span;
    pct = Math.min(1, Math.max(0, pct));
    $('progressBar').style.width = (pct * 100).toFixed(2) + '%';
    $('chPct').textContent = '%' + Math.round(pct * 100);
    // ekranda görünen sayfayı hatırla (çeviri ↔ orijinal geçişi için)
    const mid = window.scrollY + window.innerHeight * 0.35;
    let seen = state.page;
    for (const el of reader.querySelectorAll('.pg[data-page]')) {
      const r = el.getBoundingClientRect();
      if (r.height < 4) continue;
      if (window.scrollY + r.top <= mid) seen = Number(el.dataset.page);
      else break;
    }
    if (seen && seen !== state.page) {
      state.page = seen;
      LS.set('page', seen);
      LS.set('page:' + state.vol, seen);
      const prevMax = LS.get('max:' + state.vol, 0);
      if (seen > prevMax) {
        LS.set('max:' + state.vol, seen);
        markTocRead();
      }
    }
  }

  function offlineHint() {
    const el = document.getElementById('offline');
    if (el) el.hidden = navigator.onLine;
  }
  window.addEventListener('online', offlineHint);
  window.addEventListener('offline', offlineHint);
  offlineHint();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  window.addEventListener('scroll', scheduleProgress, { passive: true });
  window.addEventListener('resize', scheduleProgress);

  function prefetch() {
    if (state.mode !== 'page' || !state.book) return;
    const nxt = state.book.pages[state.page];
    if (nxt && !nxt.pending && (nxt.art || hasFullScans(state.vol))) {
      const i = new Image();
      i.src = imgSrc(nxt);
    }
  }

  /* ---------------- gezinme ---------------- */
  function goChapter(i, anchorPage) {
    if (!state.book) return;
    const max = chapters().length - 1;
    const idx = Math.min(Math.max(0, i), max);
    state.page = chapters()[idx].page;
    render();
    if (anchorPage) {
      const el = reader.querySelector('.pg[data-page="' + anchorPage + '"]');
      if (el) el.scrollIntoView({ block: 'start' });
    }
  }
  const next = () => (state.mode === 'page' ? goPage(state.page + 1) : goChapter(state.chapter + 1));
  const prev = () => (state.mode === 'page' ? goPage(state.page - 1) : goChapter(state.chapter - 1));

  /* ---------------- olaylar ---------------- */
  $('prevBtn').addEventListener('click', prev);
  $('nextBtn').addEventListener('click', next);
  $('pageRange').addEventListener('input', (e) => goChapter(Number(e.target.value) - 1));
  $('modeBtn').addEventListener('click', () => {
    state.mode = state.mode === 'text' ? 'page' : 'text';
    $('modeBtn').textContent = state.mode === 'text' ? 'Çeviri' : 'Orijinal';
    render();
  });
  function syncModeButtons() {
    $('modeText').classList.toggle('is-on', state.mode === 'text');
    $('modePage').classList.toggle('is-on', state.mode === 'page');
    $('modeBtn').textContent = state.mode === 'text' ? 'Çeviri' : 'Orijinal';
  }
  function switchMode(mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    syncModeButtons();
    render();
    const readerEl = $('reader');
    readerEl.classList.remove('is-switching');
    void readerEl.offsetWidth;
    readerEl.classList.add('is-switching');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  $('modeText').addEventListener('click', () => switchMode('text'));
  $('modePage').addEventListener('click', () => switchMode('page'));

  function toggleToc() {} // sade arayüzde ayrı panel yok (bölüm seçici <select>)

  $('themeBtn').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    LS.set('theme', state.theme);
  });
  $('fontUp').addEventListener('click', () => {
    state.size = Math.min(1.45, +(state.size + 0.06).toFixed(2));
    applySize();
    LS.set('size', state.size);
  });
  $('fontDown').addEventListener('click', () => {
    state.size = Math.max(0.9, +(state.size - 0.06).toFixed(2));
    applySize();
    LS.set('size', state.size);
  });
  $('homeBtn').addEventListener('click', (e) => {
    e.preventDefault();
    goChapter(1 < chapters().length ? 1 : 0);
  });

  const lbEl = $('lightbox');
  if (lbEl) lbEl.addEventListener('click', closeLightbox);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (closeLightbox()) return;
      if (libOpen) {
        if (libKind === 'ch') showLibrary('vol');
        else hideLibrary();
        return;
      }
      return toggleToc(false);
    }
    if (libOpen) return;
    if (e.target && typeof e.target.matches === 'function' && e.target.matches('input, select, textarea')) return;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'j') next();
    else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'k') prev();
    else if (e.key === 't') $('themeBtn').click();
    else if (e.key === 'v') (state.mode === 'text' ? $('modePage') : $('modeText')).click();
    else return;
    e.preventDefault();
  });

  let tx = 0;
  let ty = 0;
  document.addEventListener(
    'touchstart',
    (e) => {
      tx = e.touches[0].clientX;
      ty = e.touches[0].clientY;
    },
    { passive: true }
  );
  document.addEventListener(
    'touchend',
    (e) => {
      const dx = e.changedTouches[0].clientX - tx;
      const dy = e.changedTouches[0].clientY - ty;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) {
        dx < 0 ? next() : prev();
      }
    },
    { passive: true }
  );

  applyTheme();
  applySize();
  load().catch((err) => {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = 'Kitap verisi yüklenemedi: ' + err.message;
    reader.replaceChildren(p);
  });
})();
