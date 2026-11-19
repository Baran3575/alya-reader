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

  /* Eski büyük kitap önbelleklerini (alya4:book:<v>, alya4:bookver:<v>) temizle */
  function purgeLegacyBookStorage() {
    try {
      const staleKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('alya4:book')) staleKeys.push(key);
      }
      for (const key of staleKeys) localStorage.removeItem(key);
    } catch {}
  }
  purgeLegacyBookStorage();

  // URL sorgusu (?vol=9.5 veya ?v=12, ?page=10) ile doğrudan cilt/sayfa açma desteği
  function parseQuery(search) {
    const out = {};
    const q = String(search || '').replace(/^\?/, '');
    if (!q) return out;
    for (const part of q.split('&')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      const k = decodeURIComponent(eq >= 0 ? part.slice(0, eq) : part);
      const v = eq >= 0 ? decodeURIComponent(part.slice(eq + 1)) : '';
      if (!(k in out)) out[k] = v;
    }
    return out;
  }
  const rawSearch =
    (typeof window !== 'undefined' && window.location && window.location.search) ||
    (typeof location !== 'undefined' && location.search) ||
    '';
  const urlParams = parseQuery(rawSearch);
  const initialUrlVol = urlParams.vol || urlParams.v || null;
  const initialUrlPage = Number(urlParams.page || urlParams.p || 0);

  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  const state = {
    page: initialUrlPage > 0 ? initialUrlPage : LS.get('page', 1),
    mode: LS.get('mode', 'text'),
    theme: LS.get('theme', prefersLight ? 'light' : 'dark'),
    size: LS.get('size', 1.06),
    vol: String(initialUrlVol || LS.get('vol', '4')),
    manifest: null,
    book: null,
    chapter: 0,
  };

  const memoryBooks = new Map();
  const memoryEn = new Map();
  const enInFlight = new Map();

  /* ---------------- cilt ---------------- */
  const defaultVolOrder = ['4', '4.5', '5', '6', '7', '8', '9', '9.5', '10', '11', '12'];
  const volTitle = {
    '4': 'Cilt 4',
    '4.5': 'Cilt 4.5',
    '5': 'Cilt 5',
    '6': 'Cilt 6',
    '7': 'Cilt 7',
    '8': 'Cilt 8',
    '9': 'Cilt 9',
    '9.5': 'Cilt 9.5',
    '10': 'Cilt 10',
    '11': 'Cilt 11',
    '12': 'Cilt 12',
  };

  function getVolOrder() {
    if (state.manifest && Array.isArray(state.manifest.order) && state.manifest.order.length > 0) {
      return state.manifest.order;
    }
    return defaultVolOrder;
  }

  function getVolLabel(key) {
    const meta = state.manifest && state.manifest.volumes && state.manifest.volumes[key];
    return (meta && meta.label) || volTitle[key] || 'Cilt ' + key;
  }

  function volSlug(v) {
    const meta = state.manifest && state.manifest.volumes && state.manifest.volumes[v];
    if (meta && meta.slug) return meta.slug;
    return String(v).replace(/\./g, '-');
  }

  function syncVolSelect() {
    const sel = $('volSelect');
    if (!sel) return;
    if (state.manifest && Array.isArray(state.manifest.order) && state.manifest.order.length > 0) {
      sel.innerHTML = '';
      for (const id of state.manifest.order) {
        const meta = state.manifest.volumes && state.manifest.volumes[id];
        if (!meta) continue;
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = meta.label || 'Cilt ' + id;
        sel.appendChild(opt);
      }
    }
    sel.value = state.vol;
  }

  function switchVolume(v, targetPage) {
    const nextVol = String(v);
    if (nextVol === state.vol && targetPage === undefined) return;
    LS.set('page:' + state.vol, state.page);
    state.vol = nextVol;
    LS.set('vol', nextVol);
    if (targetPage !== undefined && targetPage > 0) {
      state.page = targetPage;
      LS.set('page:' + nextVol, targetPage);
    } else {
      state.page = LS.get('page:' + nextVol, 1);
    }
    load().catch((err) => {
      reader.innerHTML = '<p class="empty-note">Cilt ' + nextVol + ' yüklenemedi: ' + err.message + '</p>';
    });
  }

  const volSelectEl = $('volSelect');
  if (volSelectEl) {
    volSelectEl.addEventListener('change', (e) => {
      const nextVol = String(e.target.value);
      switchVolume(nextVol);
      if (libOpen) showLibrary('ch', nextVol);
    });
  }

  function measureChrome() {
    const bar = document.querySelector('.bar');
    if (!bar) return;
    const h = bar.offsetHeight;
    if (h > 20) document.documentElement.style.setProperty('--bar-h', h + 'px');
  }
  window.addEventListener('resize', measureChrome);
  window.addEventListener('orientationchange', () => {
    if (typeof setTimeout === 'function') setTimeout(measureChrome, 120);
  });

  /* ---------------- cilt / bölüm seçimi + okundu işaretleri ---------------- */
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
  let libBuildSeq = 0;

  function chapterRangeFor(book, i) {
    const list = (book && book.chapters) || [];
    if (!list[i]) return [1, 1];
    const start = list[i].page;
    const next = list[i + 1];
    return [start, next ? next.page - 1 : book.total];
  }

  function showLibrary(kind, volumeKey) {
    libKind = kind;
    libVol = String(volumeKey || state.vol);
    libOpen = true;
    libView.hidden = false;
    readerEl.hidden = true;
    $('volBtn')?.setAttribute('aria-expanded', String(kind === 'vol'));
    $('chBtn')?.setAttribute('aria-expanded', String(kind === 'ch'));
    $('libActions').hidden = kind !== 'ch';
    $('libBack').hidden = kind !== 'ch';
    buildList(libVol);
    window.scrollTo(0, 0);
    measureChrome();
  }

  function hideLibrary() {
    if (!libOpen && libView && libView.hidden) return;
    libOpen = false;
    if (libView) libView.hidden = true;
    if (readerEl) readerEl.hidden = false;
    $('volBtn')?.setAttribute('aria-expanded', 'false');
    $('chBtn')?.setAttribute('aria-expanded', 'false');
    measureChrome();
  }

  function buildList(volumeKey) {
    const seq = ++libBuildSeq;
    libList.innerHTML = '';
    if (libKind === 'vol') {
      $('libTitle').textContent = 'Ciltler';
      for (const key of getVolOrder()) {
        const meta = state.manifest && state.manifest.volumes && state.manifest.volumes[key];
        const cached = memoryBooks.get(key);
        const total =
          (meta && typeof meta.chapters === 'number' ? meta.chapters : 0) ||
          (cached && cached.chapters ? cached.chapters.length : 0);
        const read = readCount(key).length;
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'lib-card' + (String(state.vol) === key ? ' is-current' : '');

        const num = document.createElement('span');
        num.className = 'lib-num';
        num.textContent = key;

        const info = document.createElement('span');
        info.className = 'lib-info';
        const name = document.createElement('span');
        name.className = 'lib-name';
        name.textContent = getVolLabel(key);
        const sub = document.createElement('span');
        sub.className = 'lib-meta';
        sub.textContent = total + ' bölüm · ' + read + '/' + total + ' okundu';
        info.append(name, sub);

        const go = document.createElement('span');
        go.className = 'lib-go';
        go.setAttribute('aria-hidden', 'true');
        go.textContent = '›';

        card.append(num, info, go);
        card.addEventListener('click', () => showLibrary('ch', key));
        libList.appendChild(card);
      }
      return;
    }

    const vKey = String(volumeKey || state.vol);
    $('libTitle').textContent = getVolLabel(vKey);
    if (vKey === String(state.vol) && state.book) {
      chListFor(vKey, state.book);
      return;
    }
    const cachedBook = memoryBooks.get(vKey);
    if (cachedBook) {
      chListFor(vKey, cachedBook);
      return;
    }
    const loadingNote = document.createElement('p');
    loadingNote.className = 'empty-note';
    loadingNote.textContent = getVolLabel(vKey) + ' bölümleri yükleniyor…';
    libList.appendChild(loadingNote);
    readBook(vKey)
      .then((book) => {
        if (seq !== libBuildSeq || !libOpen || libKind !== 'ch') return;
        chListFor(vKey, book);
      })
      .catch((err) => {
        if (seq !== libBuildSeq || !libOpen || libKind !== 'ch') return;
        libList.innerHTML = '';
        const errEl = document.createElement('p');
        errEl.className = 'empty-note';
        errEl.textContent = getVolLabel(vKey) + ' yüklenemedi: ' + err.message;
        libList.appendChild(errEl);
      });
  }

  function chListFor(volumeKey, book) {
    libList.innerHTML = '';
    const list = (book && book.chapters) || [];
    list.forEach((c, i) => {
      const label = (c.label || 'Bölüm ' + (i + 1)).replace(/^Cilt [\d.]+ · /, '');
      const title = c.title || '';
      const read = isRead(volumeKey, i);
      const range = c.page
        ? (() => {
            const [st, en] = chapterRangeFor(book, i);
            return c.pending ? 'yakında' : st === en ? 's. ' + st : 's. ' + st + '–' + en;
          })()
        : '';
      const row = document.createElement('div');
      row.className =
        'lib-row' +
        (read ? ' is-read' : '') +
        (c.pending ? ' is-pending' : '') +
        (volumeKey === String(state.vol) && i === state.chapter ? ' is-current' : '');

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'lib-main';
      const nameEl = document.createElement('span');
      nameEl.className = 'lib-name';
      nameEl.textContent = label;
      main.appendChild(nameEl);
      if (title && title !== label) {
        const subEl = document.createElement('span');
        subEl.className = 'lib-sub';
        subEl.textContent = title;
        main.appendChild(subEl);
      }
      if (range) {
        const metaEl = document.createElement('span');
        metaEl.className = 'lib-meta';
        metaEl.textContent = range;
        main.appendChild(metaEl);
      }
      main.addEventListener('click', () => {
        hideLibrary();
        if (volumeKey !== String(state.vol)) {
          switchVolume(volumeKey, c.page || 1);
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

  $('volBtn')?.addEventListener('click', () => {
    if (libOpen && libKind === 'vol') hideLibrary();
    else showLibrary('vol');
  });
  $('chBtn')?.addEventListener('click', () => {
    if (libOpen) hideLibrary();
    else showLibrary('ch', String(state.vol));
  });
  $('libBack')?.addEventListener('click', () => showLibrary('vol'));
  $('libClose')?.addEventListener('click', hideLibrary);
  $('markAllBtn')?.addEventListener('click', () => {
    const applyMarkAll = (book) => {
      ((book && book.chapters) || []).forEach((c, i) => {
        if (!c.pending) setRead(libVol, i, true);
      });
      buildList(libVol);
      markTocRead();
    };
    if (libVol === String(state.vol) && state.book) {
      applyMarkAll(state.book);
    } else {
      readBook(libVol).then(applyMarkAll).catch(() => {});
    }
  });
  $('clearAllBtn')?.addEventListener('click', () => {
    LS.set('read:' + libVol, []);
    buildList(libVol);
    markTocRead();
  });

  function syncPickers() {
    if ($('volLabel')) $('volLabel').textContent = getVolLabel(String(state.vol));
    if ($('volSelect')) $('volSelect').value = String(state.vol);
    const ch = state.book ? chapters()[state.chapter] : null;
    if ($('chLabel')) {
      $('chLabel').textContent = ch ? (ch.title ? ch.label + ' · ' + ch.title : ch.label) : 'Bölüm';
    }
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
  const chapterRange = (i) => chapterRangeFor(state.book, i);

  /* ---------------- veri ---------------- */
  function imgSrc(p, vol) {
    const v = vol || state.vol;
    const key = String(p.n).padStart(3, '0');
    const rawImg = String(p.img || '').replace(/^\/+/, '');
    if (rawImg.startsWith('art/')) return rawImg;
    if (rawImg && !rawImg.startsWith('pages/') && !rawImg.startsWith('pages45/')) return rawImg;
    if (p.art) return 'art/vol-' + volSlug(v) + '/' + key + '.webp';
    return rawImg;
  }

  async function readManifest() {
    if (state.manifest) return state.manifest;
    try {
      const res = await fetch('bundles/manifest.json');
      if (res.ok) {
        state.manifest = await res.json();
        return state.manifest;
      }
    } catch {}
    try {
      const res = await fetch('api/volumes');
      if (res.ok) {
        state.manifest = await res.json();
        return state.manifest;
      }
    } catch {}
    return null;
  }

  async function readBook(v) {
    const key = String(v);
    if (memoryBooks.has(key)) return memoryBooks.get(key);

    const manifest = await readManifest();
    const meta = manifest && manifest.volumes && manifest.volumes[key];
    if (meta) {
      const slug = meta.slug || volSlug(key);
      const query = meta.hash ? '?v=' + encodeURIComponent(meta.hash) : '';
      try {
        const res = await fetch('bundles/vol-' + slug + '.json' + query);
        if (res.ok) {
          const book = await res.json();
          memoryBooks.set(key, book);
          return book;
        }
      } catch {}
    }

    const res = await fetch('api/book?v=' + encodeURIComponent(key));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const book = await res.json();
    memoryBooks.set(key, book);
    return book;
  }

  async function readBookEn(v) {
    const key = String(v);
    if (memoryEn.has(key)) return memoryEn.get(key);
    if (enInFlight.has(key)) return enInFlight.get(key);

    const task = (async () => {
      const manifest = await readManifest();
      const meta = manifest && manifest.volumes && manifest.volumes[key];
      const slug = (meta && meta.slug) || volSlug(key);
      const enRel = (meta && meta.enFile) || 'bundles/bundle-en-' + slug + '.json';
      const query = meta && meta.enHash ? '?v=' + encodeURIComponent(meta.enHash) : '';
      try {
        const res = await fetch(enRel + query);
        if (res.ok) {
          const payload = await res.json();
          const pages = (payload && payload.pages) || payload || {};
          memoryEn.set(key, pages);
          return pages;
        }
      } catch {}

      const res = await fetch('api/book-en?v=' + encodeURIComponent(key));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const payload = await res.json();
      const pages = (payload && payload.pages) || payload || {};
      memoryEn.set(key, pages);
      return pages;
    })().finally(() => {
      enInFlight.delete(key);
    });

    enInFlight.set(key, task);
    return task;
  }

  function getPageEn(vol, p) {
    if (!p) return [];
    if (Array.isArray(p.en) && p.en.length > 0) return p.en;
    const enPages = memoryEn.get(String(vol));
    if (enPages && Array.isArray(enPages[String(p.n)])) {
      return enPages[String(p.n)];
    }
    return [];
  }

  let loadSeq = 0;

  async function load() {
    const seq = ++loadSeq;
    const manifest = await readManifest();
    if (seq !== loadSeq) return;
    if (manifest && manifest.volumes && !manifest.volumes[state.vol]) {
      state.vol = manifest.defaultVolume || (manifest.order && manifest.order[0]) || '4';
      LS.set('vol', state.vol);
    }
    syncVolSelect();

    const targetVol = state.vol;
    const book = await readBook(targetVol);
    if (seq !== loadSeq || targetVol !== state.vol) return;
    state.book = book;
    const saved = LS.get('page:' + state.vol, 1);
    if (state.page < 1 || state.page > state.book.total) state.page = saved;

    $('brandSub').textContent = state.book.volume + ' · Türkçe';
    if ($('volSelect')) $('volSelect').value = state.vol;
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
        hideLibrary();
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

  // içindekilerde okunmuş bölümleri işaretle (elle okundu seti bazlı)
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
    const looksHeading =
      /^(?:\d+\.\s*)?(Bölüm|Önsöz|Sonsöz|Son\s*Söz|Ek\s*Hik[aâ]ye|Yan\s*Hik[aâ]ye|Kısa\s*Hik[aâ]ye|Bonus\s*(?:SS|Hik[aâ]ye)|Anekdot|Ara\s*Bölüm|Epilog|Prolog|Başlangıç|Prologue|Epilogue|Afterword|Side\s*Story|Anecdote|Interlude|Chapter)\b/i.test(
        t
      );
    if (!looksHeading) return out;
    if (q > 0 && q < 140) {
      out[0] = t.slice(q);
    } else {
      const i = ch.title ? t.indexOf(ch.title) : -1;
      if (i >= 0) {
        const rest = t.slice(i + ch.title.length).replace(/^[:\s"”–—-]+/, '');
        if (rest.length > 40) out[0] = rest;
        else out.shift();
      } else if (
        /^(?:\d+\.\s*)?(?:Bölüm(?:\s+\d+)?|Önsöz|Sonsöz|Son\s*Söz|Ek\s*Hik[aâ]ye(?:\s+\d+)?|Yan\s*Hik[aâ]ye(?:\s+\d+)?|Kısa\s*Hik[aâ]ye(?:\s+\d+)?|Bonus\s*SS(?:\s+\d+)?|Anekdot(?:\s+\d+)?|Ara\s*Bölüm(?:\s+\d+)?|Epilog|Prolog|Prologue|Epilogue|Afterword|Side\s*Story(?:\s+\d+)?|Anecdote(?:\s+\d+)?|Interlude(?:\s+\d+)?)$/i.test(
          t.trim()
        )
      ) {
        out.shift();
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

  function figureFor(p, caption) {
    const fig = document.createElement('figure');
    fig.className = 'page-img';
    const img = document.createElement('img');
    img.src = imgSrc(p);
    img.alt = 'Sayfa ' + p.n;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('load', () => scheduleProgress(), { once: true });
    fig.appendChild(img);
    if (caption) {
      const cap = document.createElement('figcaption');
      cap.className = 'img-cap';
      cap.textContent = 'Sayfa ' + p.n;
      fig.appendChild(cap);
    }
    fig.addEventListener('click', () => openLightbox(imgSrc(p), 'Sayfa ' + p.n));
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
  let pageRenderSeq = 0;

  function appendOrigProse(container, lines) {
    const proseWrap = document.createElement('div');
    proseWrap.className = 'orig-prose';
    for (const line of lines) {
      const el = document.createElement('p');
      el.textContent = line;
      proseWrap.appendChild(el);
    }
    container.appendChild(proseWrap);
  }

  function populateOriginalText(sec, vol, p, seq) {
    const immediateEn = getPageEn(vol, p);
    if (immediateEn.length > 0) {
      appendOrigProse(sec, immediateEn);
      return;
    }
    if (memoryEn.has(String(vol))) {
      if (p.tr && p.tr.length) {
        for (const line of p.tr) {
          sec.appendChild(renderParagraph(line));
        }
      }
      return;
    }

    const loadingNote = document.createElement('p');
    loadingNote.className = 'empty-note';
    loadingNote.textContent = 'Orijinal metin yükleniyor…';
    sec.appendChild(loadingNote);

    readBookEn(vol)
      .then(() => {
        if (
          seq !== pageRenderSeq ||
          state.mode !== 'page' ||
          String(state.vol) !== String(vol) ||
          sec.isConnected === false
        ) {
          return;
        }
        sec.innerHTML = '';
        const loadedEn = getPageEn(vol, p);
        if (loadedEn.length > 0) {
          appendOrigProse(sec, loadedEn);
        } else if (p.tr && p.tr.length) {
          for (const line of p.tr) {
            sec.appendChild(renderParagraph(line));
          }
        }
      })
      .catch(() => {
        if (
          seq !== pageRenderSeq ||
          state.mode !== 'page' ||
          String(state.vol) !== String(vol) ||
          sec.isConnected === false
        ) {
          return;
        }
        sec.innerHTML = '';
        if (p.tr && p.tr.length) {
          for (const line of p.tr) {
            sec.appendChild(renderParagraph(line));
          }
        } else {
          const errEl = document.createElement('p');
          errEl.className = 'empty-note';
          errEl.textContent = 'Orijinal metin şu an yüklenemedi.';
          sec.appendChild(errEl);
        }
      });
  }

  function renderPage() {
    const seq = ++pageRenderSeq;
    const currentVol = String(state.vol);
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
    } else if (p) {
      const hasFullScan = p.art === true || Boolean(state.book.fullScans);
      if (hasFullScan) {
        const fig = figureFor(p, false);
        if (!p.art) {
          const im = fig.querySelector('img');
          if (im && typeof im.addEventListener === 'function') {
            im.addEventListener(
              'error',
              () => {
                fig.remove();
                populateOriginalText(sec, currentVol, p, seq);
              },
              { once: true }
            );
          }
        }
        sec.appendChild(fig);
      } else {
        populateOriginalText(sec, currentVol, p, seq);
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

    syncPickers();
    $('navChapter').textContent = ch.label;
    $('navPages').textContent = 's. ' + n + ' / ' + state.book.total;
    $('prevBtn').disabled = n <= 1;
    $('nextBtn').disabled = n >= state.book.total;
    $('modeText').classList.toggle('is-on', state.mode === 'text');
    $('modePage').classList.toggle('is-on', state.mode === 'page');
    $('modeBtn').textContent = state.mode === 'text' ? 'Çeviri' : 'Orijinal';

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
    prefetch(chapterIndex(target));
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

        const isIllustration = p.art === true;
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
    prefetch(idx);
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

  function prefetch(idx) {
    const imgs = [];
    for (let n = chapters()[idx].page; n <= chapterRange(idx)[1]; n++) {
      const p = state.book.pages[n - 1];
      if (p && p.art && !p.pending) imgs.push(imgSrc(p));
    }
    const nxt = chapters()[idx + 1];
    if (nxt && !nxt.pending) {
      for (let n = nxt.page; n <= Math.min(nxt.page + 3, state.book.total); n++) {
        const p = state.book.pages[n - 1];
        if (p && p.art && !p.pending) imgs.push(imgSrc(p));
      }
    }
    imgs.slice(0, 4).forEach((src) => {
      const i = new Image();
      i.src = src;
    });
  }

  /* ---------------- gezinme ---------------- */
  function goChapter(i, anchorPage) {
    if (!state.book) return;
    hideLibrary();
    const max = chapters().length - 1;
    const idx = Math.min(Math.max(0, i), max);
    state.page = chapters()[idx].page;
    render();
    if (anchorPage) {
      const el = reader.querySelector('.pg[data-page="' + anchorPage + '"]');
      if (el) el.scrollIntoView({ block: 'start' });
    }
  }
  const next = () => {
    hideLibrary();
    return state.mode === 'page' ? goPage(state.page + 1) : goChapter(state.chapter + 1);
  };
  const prev = () => {
    hideLibrary();
    return state.mode === 'page' ? goPage(state.page - 1) : goChapter(state.chapter - 1);
  };

  /* ---------------- olaylar ---------------- */
  $('prevBtn').addEventListener('click', prev);
  $('nextBtn').addEventListener('click', next);
  $('pageRange').addEventListener('input', (e) => goChapter(Number(e.target.value) - 1));
  $('modeBtn').addEventListener('click', () => {
    hideLibrary();
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
    hideLibrary();
    if (state.mode === mode) return;
    state.mode = mode;
    syncModeButtons();
    render();
    const rEl = $('reader');
    rEl.classList.remove('is-switching');
    void rEl.offsetWidth;
    rEl.classList.add('is-switching');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  $('modeText').addEventListener('click', () => switchMode('text'));
  $('modePage').addEventListener('click', () => switchMode('page'));

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
      }
      return;
    }
    if (e.target.matches('input, select, textarea')) return;
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
    reader.innerHTML = '<p class="empty-note">Kitap verisi yüklenemedi: ' + err.message + '</p>';
  });
})();
