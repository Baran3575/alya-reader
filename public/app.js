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

  const VOLUME_CATALOG = [
    { id: '4', label: 'Cilt 4', subtitle: 'Yaz Tatili ve Havai Fişekler', embedArt: true, status: 'complete', statusNote: '' },
    { id: '4.5', label: 'Cilt 4.5', subtitle: 'Yaz Tatili Kısa Öyküleri', embedArt: true, status: 'complete', statusNote: '' },
    { id: '5', label: 'Cilt 5', subtitle: 'Güz Dönemi ve Festival Hazırlığı', embedArt: false, status: 'complete', statusNote: '' },
    { id: '6', label: 'Cilt 6', subtitle: 'Seirei Akademisi Festivali', embedArt: false, status: 'complete', statusNote: '' },
    { id: '7', label: 'Cilt 7', subtitle: 'Sonbahar ve Spor Şenliği', embedArt: false, status: 'complete', statusNote: '' },
    { id: '8', label: 'Cilt 8', subtitle: 'Kışa Girerken ve Doğum Günü', embedArt: false, status: 'complete', statusNote: '' },
    { id: '9', label: 'Cilt 9', subtitle: 'Suou Ailesi ve Geçmişin Sesi', embedArt: false, status: 'complete', statusNote: '' },
    { id: '9.5', label: 'Cilt 9.5', subtitle: 'Sahne Arkası Kısa Öyküleri', embedArt: false, status: 'complete', statusNote: '' },
    { id: '10', label: 'Cilt 10', subtitle: 'Piyano Tınısı ve Öğrenci Konseyi', embedArt: false, status: 'complete', statusNote: '' },
    { id: '11', label: 'Cilt 11', subtitle: 'Birleşik Cephe ve Kış Hazırlığı', embedArt: false, status: 'complete', statusNote: '' },
    {
      id: '12',
      label: 'Cilt 12',
      subtitle: 'İlk Dans ve Noel Arifesi',
      embedArt: false,
      status: 'partial',
      statusNote: 'Bu cildin çevirisi devam ediyor; yeni bölümler yayınlandıkça eklenecek.',
    },
  ];

  function buildVolumesList() {
    const bundleVols = (window.ALYA_BUNDLE && window.ALYA_BUNDLE.vols) || {};
    const seen = new Set();
    const out = VOLUME_CATALOG.map((base) => {
      seen.add(base.id);
      const b = bundleVols[base.id] || {};
      return {
        id: base.id,
        label: b.label || b.volume || base.label,
        subtitle: b.subtitle || base.subtitle,
        embedArt: b.embedArt !== undefined ? Boolean(b.embedArt) : base.embedArt,
        status: b.status || base.status,
        statusNote: b.statusNote !== undefined ? b.statusNote : base.statusNote,
        total: b.total || 0,
        chapterCount: Array.isArray(b.chapters) ? b.chapters.length : 0,
      };
    });
    const extraKeys = Object.keys(bundleVols)
      .filter((k) => !seen.has(String(k)))
      .sort((a, b) => parseFloat(a) - parseFloat(b));
    for (const id of extraKeys) {
      const b = bundleVols[id] || {};
      out.push({
        id: String(id),
        label: b.label || b.volume || 'Cilt ' + id,
        subtitle: b.subtitle || '',
        embedArt: Boolean(b.embedArt),
        status: b.status || 'complete',
        statusNote: b.statusNote || '',
        total: b.total || 0,
        chapterCount: Array.isArray(b.chapters) ? b.chapters.length : 0,
      });
    }
    return out;
  }

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

  // URL sorgusu (?vol=9.5&ch=2, ?v=6&page=20 veya #vol=12) ile doğrudan cilt/bölüm açma desteği
  function readUrlRoute() {
    const searchParams = new URLSearchParams(window.location.search);
    const hashRaw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const hashParams = new URLSearchParams(hashRaw);
    const v =
      searchParams.get('vol') ||
      searchParams.get('v') ||
      hashParams.get('vol') ||
      hashParams.get('v');
    const chRaw = searchParams.has('ch') ? searchParams.get('ch') : hashParams.get('ch');
    const ch = chRaw !== null && chRaw !== '' && /^\d+$/.test(chRaw) ? Number(chRaw) : null;
    const pageRaw =
      searchParams.get('page') ||
      searchParams.get('p') ||
      hashParams.get('page') ||
      hashParams.get('p');
    const page =
      pageRaw !== null && pageRaw !== '' && /^\d+$/.test(pageRaw) && Number(pageRaw) > 0
        ? Number(pageRaw)
        : null;
    return { v: v ? String(v) : null, ch, page };
  }

  const volumesList = buildVolumesList();
  const initialRoute = readUrlRoute();
  const savedVol = String(LS.get('vol', volumesList[0] ? volumesList[0].id : '4') || '4');
  const initialVol =
    initialRoute.v && volumesList.some((x) => x.id === initialRoute.v) ? initialRoute.v : savedVol;

  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  const state = {
    page:
      initialRoute.page !== null
        ? initialRoute.page
        : initialRoute.v && initialVol !== savedVol
          ? LS.get('page:' + initialVol, 1)
          : LS.get('page:' + initialVol, LS.get('page', 1)),
    mode: LS.get('mode', 'text'),
    theme: LS.get('theme', prefersLight ? 'light' : 'dark'),
    size: LS.get('size', 1.06),
    vol: initialVol,
    volumes: volumesList,
    pendingChapter: initialRoute.ch,
    fromDeepLink: Boolean(initialRoute.v || initialRoute.ch !== null || initialRoute.page !== null),
    book: null,
    chapter: 0,
  };

  function currentVolumeMeta(volId = state.vol) {
    return state.volumes.find((x) => String(x.id) === String(volId)) || null;
  }

  function volumeLabel(volId) {
    const meta = currentVolumeMeta(volId);
    if (meta && meta.label) return meta.label;
    const bundleEntry = window.ALYA_BUNDLE && window.ALYA_BUNDLE.vols && window.ALYA_BUNDLE.vols[volId];
    if (bundleEntry && bundleEntry.label) return bundleEntry.label;
    return 'Cilt ' + volId;
  }

  function syncUrl() {
    if (!state.book) return;
    const vEnc = encodeURIComponent(state.vol);
    const chIdx = state.chapter;
    if (window.location.protocol === 'file:') {
      const nextHash = '#vol=' + vEnc + '&ch=' + chIdx;
      if (window.location.hash !== nextHash) {
        try {
          history.replaceState(null, '', nextHash);
        } catch {
          window.location.hash = nextHash;
        }
      }
      return;
    }
    const nextUrl = window.location.pathname + '?vol=' + vEnc + '&ch=' + chIdx;
    const curUrl = window.location.pathname + window.location.search + window.location.hash;
    if (curUrl !== nextUrl) {
      try {
        history.replaceState(null, '', nextUrl);
      } catch {}
    }
  }

  function fetchLocalJson(relUrl) {
    if (window.location.protocol === 'file:') {
      return new Promise((resolve) => {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', relUrl, true);
          xhr.onload = () => {
            if (xhr.status === 200 || (xhr.status === 0 && xhr.responseText)) {
              try {
                resolve(JSON.parse(xhr.responseText));
                return;
              } catch {}
            }
            resolve(null);
          };
          xhr.onerror = () => resolve(null);
          xhr.send();
        } catch {
          resolve(null);
        }
      });
    }
    return fetch(relUrl)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }

  /* ---------------- cilt ---------------- */
  function switchVolume(v, targetChapter = null) {
    const nextVol = String(v);
    if (nextVol === state.vol && state.book && targetChapter === null) return Promise.resolve();
    if (state.book && !state.fromDeepLink) LS.set('page:' + state.vol, state.page);
    state.vol = nextVol;
    state.pendingChapter = targetChapter;
    state.fromDeepLink = false;
    LS.set('vol', nextVol);
    state.page = LS.get('page:' + nextVol, 1);
    return load().catch((err) => {
      const label = volumeLabel(nextVol);
      state.book = null;
      if ($('volLabel')) $('volLabel').textContent = label;
      if ($('brandSub')) $('brandSub').textContent = label + ' · Türkçe';
      reader.innerHTML = '<p class="empty-note">' + label + ' yüklenemedi: ' + err.message + '</p>';
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

  /* ---------------- cilt / bölüm çekmecesi + okundu işaretleri ---------------- */
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
  let libFromVol = false;

  function showLibrary(kind, volumeKey, fromVol = false) {
    libKind = kind;
    libVol = String(volumeKey || state.vol);
    libFromVol = Boolean(fromVol);
    libOpen = true;
    libView.hidden = false;
    readerEl.hidden = true;
    $('volBtn').setAttribute('aria-expanded', String(kind === 'vol'));
    $('chBtn').setAttribute('aria-expanded', String(kind === 'ch'));
    $('libActions').hidden = kind !== 'ch';
    $('libBack').hidden = kind !== 'ch';
    if ($('openVolBtn')) $('openVolBtn').hidden = !(kind === 'ch' && libVol !== String(state.vol));
    buildList(libVol);
    window.scrollTo(0, 0);
    measureChrome();
  }

  function hideLibrary() {
    libOpen = false;
    libFromVol = false;
    libView.hidden = true;
    readerEl.hidden = false;
    $('volBtn').setAttribute('aria-expanded', 'false');
    $('chBtn').setAttribute('aria-expanded', 'false');
    measureChrome();
  }

  function volumeTotalPages(volumeKey) {
    const key = String(volumeKey);
    if (key === String(state.vol) && state.book) return state.book.total;
    if (memBooks.has(key)) return memBooks.get(key).total || 0;
    const bundleEntry = window.ALYA_BUNDLE && window.ALYA_BUNDLE.vols && window.ALYA_BUNDLE.vols[key];
    if (bundleEntry && bundleEntry.total) return bundleEntry.total;
    const meta = currentVolumeMeta(key);
    return meta ? meta.total || 0 : 0;
  }

  function buildList(volumeKey) {
    libList.innerHTML = '';
    if (libKind === 'vol') {
      $('libTitle').textContent = 'Ciltler';
      state.volumes.forEach((entry) => {
        const key = String(entry.id);
        const bundleCh = window.ALYA_BUNDLE?.vols?.[key]?.chapters;
        const total = Array.isArray(bundleCh)
          ? bundleCh.length
          : key === String(state.vol) && state.book
            ? state.book.chapters.length
            : entry.chapterCount || 0;
        const read = readCount(key).length;
        const isPartial = entry.status === 'partial';

        const card = document.createElement('button');
        card.type = 'button';
        card.dataset.vol = key;
        card.className = 'lib-card' + (String(state.vol) === key ? ' is-current' : '');

        const num = document.createElement('span');
        num.className = 'lib-num';
        num.textContent = key;

        const info = document.createElement('span');
        info.className = 'lib-info';

        const nameRow = document.createElement('span');
        nameRow.className = 'lib-name-row';
        const name = document.createElement('span');
        name.className = 'lib-name';
        name.textContent = entry.label || 'Cilt ' + key;
        nameRow.appendChild(name);
        if (isPartial) {
          const badge = document.createElement('span');
          badge.className = 'vol-badge';
          badge.textContent = 'Devam ediyor';
          nameRow.appendChild(badge);
        }
        info.appendChild(nameRow);

        if (entry.subtitle) {
          const sub = document.createElement('span');
          sub.className = 'lib-sub';
          sub.textContent = entry.subtitle;
          info.appendChild(sub);
        }

        const meta = document.createElement('span');
        meta.className = 'lib-meta';
        meta.textContent = total + ' bölüm · ' + read + '/' + total + ' okundu';
        info.appendChild(meta);

        const go = document.createElement('span');
        go.className = 'lib-go';
        go.setAttribute('aria-hidden', 'true');
        go.textContent = '›';

        card.append(num, info, go);
        card.addEventListener('click', () => showLibrary('ch', key, true));
        libList.appendChild(card);
      });
      return;
    }

    const meta = currentVolumeMeta(volumeKey);
    $('libTitle').textContent =
      meta && meta.subtitle ? volumeLabel(volumeKey) + ' · ' + meta.subtitle : volumeLabel(volumeKey);
    const list =
      volumeKey === String(state.vol) && state.book
        ? chapters()
        : memBooks.has(String(volumeKey))
          ? memBooks.get(String(volumeKey)).chapters || []
          : window.ALYA_BUNDLE?.vols?.[volumeKey]?.chapters || [];
    if (list.length) {
      chListFor(volumeKey, list);
    } else {
      readBook(volumeKey)
        .then((b) => {
          if (libOpen && libKind === 'ch' && libVol === String(volumeKey)) {
            chListFor(volumeKey, b.chapters || []);
          }
        })
        .catch(() => {});
    }
  }

  function chListFor(volumeKey, list) {
    libList.innerHTML = '';
    const totalPages = volumeTotalPages(volumeKey);
    list.forEach((c, i) => {
      const label = (c.label || 'Bölüm ' + (i + 1)).replace(/^Cilt [\d.]+ · /, '');
      const title = c.title || '';
      const read = isRead(volumeKey, i);
      let range = '';
      if (c.pending) {
        range = 'yakında';
      } else if (c.page) {
        const st = c.page;
        const nxt = list[i + 1];
        const en = nxt && nxt.page ? nxt.page - 1 : totalPages;
        if (en >= st) range = st === en ? 's. ' + st : 's. ' + st + '–' + en;
        else range = 's. ' + st;
      }

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
          switchVolume(volumeKey, i);
        } else {
          goChapter(i);
        }
      });

      const check = document.createElement('button');
      check.type = 'button';
      check.className = 'lib-check' + (read ? ' is-on' : '');
      check.disabled = Boolean(c.pending);
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
    else showLibrary('ch', String(state.vol), false);
  });
  $('libBack').addEventListener('click', () => showLibrary('vol'));
  if ($('libClose')) {
    $('libClose').addEventListener('click', () => hideLibrary());
  }
  if ($('openVolBtn')) {
    $('openVolBtn').addEventListener('click', () => {
      const target = libVol;
      hideLibrary();
      switchVolume(target);
    });
  }
  $('markAllBtn').addEventListener('click', () => {
    const list =
      libVol === String(state.vol) && state.book
        ? chapters()
        : memBooks.has(libVol)
          ? memBooks.get(libVol).chapters || []
          : window.ALYA_BUNDLE?.vols?.[libVol]?.chapters || [];
    list.forEach((c, i) => {
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
    $('volLabel').textContent = state.book ? state.book.volume : volumeLabel(state.vol);
    if (!state.book) return;
    const ch = chapters()[state.chapter];
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
  /* görsel: gömülü illüstrasyon varsa data URI, yoksa göreli dosya yolu */
  function imgSrc(p, vol) {
    const key = String(p.n).padStart(3, '0');
    const pack = window.ALYA_ART && window.ALYA_ART[vol || state.vol];
    if (pack && pack[key]) return pack[key];
    return String(p.img || '').replace(/^\/+/, '');
  }

  function hasEmbeddedArt(p, vol) {
    const key = String(p.n).padStart(3, '0');
    const pack = window.ALYA_ART && window.ALYA_ART[vol || state.vol];
    return Boolean(pack && pack[key]);
  }

  /* illüstrasyonlar cilt başına parça hâlinde; yalnızca gömülü sanat olan ciltlerde yüklenir */
  const artLoading = new Map();
  function ensureArt(v) {
    const key = String(v);
    const meta = currentVolumeMeta(key);
    const needsArt = Boolean(
      (meta && meta.embedArt) ||
        (state.book && state.book.embedArt) ||
        (window.ALYA_ART_INDEX && window.ALYA_ART_INDEX[key])
    );
    window.ALYA_ART = window.ALYA_ART || {};
    if (!needsArt) return Promise.resolve();
    if (Object.prototype.hasOwnProperty.call(window.ALYA_ART, key)) return Promise.resolve();
    if (artLoading.has(key)) return artLoading.get(key);
    const p = fetchLocalJson('books/art-' + encodeURIComponent(key) + '.json')
      .then((pack) => {
        window.ALYA_ART[key] = pack && typeof pack === 'object' ? pack : {};
      })
      .finally(() => artLoading.delete(key));
    artLoading.set(key, p);
    return p;
  }

  function bundleBook(v) {
    const b = window.ALYA_BUNDLE && window.ALYA_BUNDLE.vols && window.ALYA_BUNDLE.vols[v];
    return b && Array.isArray(b.pages) ? b : null;
  }

  function cachedBook(v) {
    const ver = window.ALYA_BUNDLE_VERSION || 'dev';
    const hit = LS.get('bookver:' + v, null);
    if (!hit || hit !== ver) return null;
    const b = LS.get('book:' + v, null);
    return b && Array.isArray(b.pages) ? b : null;
  }

  function enrichBookMeta(book, v) {
    if (!book) return book;
    const meta = currentVolumeMeta(v);
    if (meta) {
      if (!book.id) book.id = String(meta.id);
      if (!book.status) book.status = meta.status || 'complete';
      if (book.statusNote === undefined) book.statusNote = meta.statusNote || '';
      if (!book.subtitle) book.subtitle = meta.subtitle || '';
      if (book.embedArt === undefined) book.embedArt = Boolean(meta.embedArt);
    }
    return book;
  }

  const memBooks = new Map();

  async function readBook(v) {
    const key = String(v);
    if (memBooks.has(key)) return memBooks.get(key);

    const cached = cachedBook(key);
    if (cached) {
      const enriched = enrichBookMeta(cached, key);
      memBooks.set(key, enriched);
      return enriched;
    }

    // 1) cilt parçası (sunucu/statik Pages üzerinde books/<cilt>.json, yerel paketlerde books/v<cilt>.json)
    const candidates =
      window.location.protocol === 'file:'
        ? ['books/v' + encodeURIComponent(key) + '.json', 'books/' + encodeURIComponent(key) + '.json']
        : ['books/' + encodeURIComponent(key) + '.json', 'books/v' + encodeURIComponent(key) + '.json'];
    let book = null;
    for (const rel of candidates) {
      book = await fetchLocalJson(rel);
      if (book && Array.isArray(book.pages)) break;
      book = null;
    }

    // 2) gömülü tam paket (varsa)
    if (!book) book = bundleBook(key);

    // 3) sunucu API
    if (!book && window.location.protocol.startsWith('http')) {
      book = await fetchLocalJson('api/book?v=' + encodeURIComponent(key));
    }
    if (!book || !Array.isArray(book.pages)) throw new Error('Cilt ' + key + ' yüklenemedi');

    const enriched = enrichBookMeta(book, key);
    memBooks.set(key, enriched);
    try {
      LS.set('book:' + key, enriched);
      LS.set('bookver:' + key, window.ALYA_BUNDLE_VERSION || 'dev');
    } catch {}
    return enriched;
  }

  async function load() {
    state.volumes = buildVolumesList();
    if (!state.vol || !state.volumes.some((x) => String(x.id) === String(state.vol))) {
      state.vol = state.volumes[0] ? String(state.volumes[0].id) : '4';
      state.pendingChapter = null;
      state.page = LS.get('page:' + state.vol, 1);
    }

    state.book = await readBook(state.vol);
    await ensureArt(state.vol);

    if (state.pendingChapter !== null) {
      const chIdx = Math.min(Math.max(0, state.pendingChapter), chapters().length - 1);
      state.page = chapters()[chIdx].page;
      state.pendingChapter = null;
    } else {
      const saved = LS.get('page:' + state.vol, 1);
      if (state.page < 1 || state.page > state.book.total) state.page = saved;
    }

    if ($('brandSub')) $('brandSub').textContent = state.book.volume + ' · Türkçe';
    if ($('volLabel')) $('volLabel').textContent = state.book.volume;
    document.title = 'Alya Bazen Duygularını Rusça Saklar · ' + state.book.volume;

    $('pageRange').max = chapters().length;

    const list = $('tocList');
    if (list) {
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
    }

    if (!(state.page >= 1 && state.page <= state.book.total)) state.page = 1;
    syncPickers();
    markTocRead();
    measureChrome();
    render();
  }

  function markTocRead() {
    const list = $('tocList');
    if (!list) return;
    for (const li of list.children) {
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

  function buildOrigProse(p) {
    const lines = p.en && p.en.length ? p.en : p.tr || [];
    const proseWrap = document.createElement('div');
    proseWrap.className = 'orig-prose';
    for (const line of lines) {
      const el = document.createElement('p');
      el.textContent = line;
      proseWrap.appendChild(el);
    }
    return proseWrap;
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
  function renderPage() {
    const n = Math.min(Math.max(1, state.page), state.book.total);
    const p = state.book.pages[n - 1];
    const idx = chapterIndex(n);
    state.chapter = idx;
    const ch = chapters()[idx];
    const volMeta = currentVolumeMeta();

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
      const hasFullScan = Boolean(
        p.art || hasEmbeddedArt(p) || (volMeta && volMeta.embedArt) || state.book.embedArt
      );
      if (hasFullScan) {
        const fig = figureFor(p, false);
        const im = fig.querySelector('img');
        if (im && ((p.en && p.en.length) || (p.tr && p.tr.length))) {
          im.addEventListener(
            'error',
            () => {
              if (fig.parentNode === sec) sec.replaceChild(buildOrigProse(p), fig);
            },
            { once: true }
          );
        }
        sec.appendChild(fig);
      } else if ((p.en && p.en.length) || (p.tr && p.tr.length)) {
        sec.appendChild(buildOrigProse(p));
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
    $('modeText').classList.toggle('is-on', state.mode === 'text');
    $('modePage').classList.toggle('is-on', state.mode === 'page');
    if (!state.fromDeepLink) {
      LS.set('page', n);
      LS.set('page:' + state.vol, n);
    }
    syncUrl();
    paintProgress();
    window.scrollTo({ top: 0 });
  }

  function goPage(n) {
    if (libOpen) hideLibrary();
    const target = Math.min(Math.max(1, n), state.book.total);
    if (target === state.page) return;
    state.fromDeepLink = false;
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
    const volMeta = currentVolumeMeta();
    const usesEmbeddedArt = Boolean((volMeta && volMeta.embedArt) || state.book.embedArt);

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
      : 'Sayfa ' +
        startPage +
        (startPage === endPage ? '' : '–' + endPage) +
        ' · ' +
        pages +
        ' sayfa · ~' +
        mins +
        ' dk';
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

        const isIllustration =
          p.art === true || (p.tr.length === 0 && (usesEmbeddedArt || hasEmbeddedArt(p)));
        if (isIllustration) {
          sec.classList.add('pg-art');
          if (p.tr.length) sec.classList.add('has-text');
          const fig = figureFor(p, true);
          if (!hasEmbeddedArt(p)) {
            const im = fig.querySelector('img');
            if (im) {
              im.addEventListener(
                'error',
                () => {
                  if (p.tr.length === 0) sec.remove();
                  else fig.remove();
                },
                { once: true }
              );
            }
          }
          sec.appendChild(fig);
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
    const isPartial = state.book.status === 'partial';
    const foot = document.createElement('div');
    foot.className = 'ch-end';
    if (last && isPartial) {
      const badge = document.createElement('span');
      badge.className = 'vol-badge';
      badge.textContent = 'Devam ediyor';
      foot.appendChild(badge);
    }
    const note = document.createElement('p');
    note.className = 'ch-end-note';
    if (last && isPartial) {
      note.classList.add('ch-end-note--partial');
      note.textContent = state.book.statusNote || 'Bu cildin çevirisi devam ediyor; yeni bölümler eklenecek.';
    } else {
      note.textContent = last ? '— Cilt sonu —' : '— Bölüm sonu —';
    }
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
      : startPage === endPage
        ? 's. ' + startPage
        : 's. ' + startPage + '–' + endPage;
    $('prevBtn').disabled = idx <= 0;
    $('nextBtn').disabled = last;
    if ($('tocLabel')) $('tocLabel').textContent = ch.label;
    if ($('tocList')) {
      for (const li of $('tocList').children) {
        li.classList.toggle('is-current', Number(li.dataset.idx) === idx);
      }
    }
    $('modeText').classList.toggle('is-on', state.mode === 'text');
    $('modePage').classList.toggle('is-on', state.mode === 'page');
    if ($('modeBtn')) $('modeBtn').textContent = state.mode === 'text' ? 'Çeviri' : 'Orijinal';

    const targetPage = Math.min(Math.max(startPage, state.page), endPage);
    if ($('navCount')) $('navCount').textContent = 's. ' + targetPage;
    if (!state.fromDeepLink) {
      LS.set('page', targetPage);
      LS.set('page:' + state.vol, targetPage);
      if (!ch.pending) {
        const prevMax2 = LS.get('max:' + state.vol, 0);
        if (targetPage > prevMax2) LS.set('max:' + state.vol, targetPage);
      }
    }
    markTocRead();
    LS.set('mode', state.mode);
    syncUrl();

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
      if ($('chPct')) $('chPct').textContent = '%' + Math.round(pct * 100);
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
    if ($('chPct')) $('chPct').textContent = '%' + Math.round(pct * 100);

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
      if (!state.fromDeepLink) LS.set('page', seen);
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
    const volMeta = currentVolumeMeta();
    if ((volMeta && volMeta.embedArt) || state.book.embedArt) return;
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
    if (libOpen) hideLibrary();
    state.fromDeepLink = false;
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
  if ($('modeBtn')) {
    $('modeBtn').addEventListener('click', () => {
      switchMode(state.mode === 'text' ? 'page' : 'text');
    });
  }
  function syncModeButtons() {
    $('modeText').classList.toggle('is-on', state.mode === 'text');
    $('modePage').classList.toggle('is-on', state.mode === 'page');
    if ($('modeBtn')) $('modeBtn').textContent = state.mode === 'text' ? 'Çeviri' : 'Orijinal';
  }
  function switchMode(mode) {
    if (state.mode === mode) return;
    if (libOpen) hideLibrary();
    state.mode = mode;
    syncModeButtons();
    render();
    readerEl.classList.remove('is-switching');
    void readerEl.offsetWidth;
    readerEl.classList.add('is-switching');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  $('modeText').addEventListener('click', () => switchMode('text'));
  $('modePage').addEventListener('click', () => switchMode('page'));

  $('themeBtn').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    LS.set('theme', state.theme);
  });
  if ($('fontUp')) {
    $('fontUp').addEventListener('click', () => {
      state.size = Math.min(1.45, +(state.size + 0.06).toFixed(2));
      applySize();
      LS.set('size', state.size);
    });
  }
  if ($('fontDown')) {
    $('fontDown').addEventListener('click', () => {
      state.size = Math.max(0.9, +(state.size - 0.06).toFixed(2));
      applySize();
      LS.set('size', state.size);
    });
  }
  if ($('homeBtn')) {
    $('homeBtn').addEventListener('click', (e) => {
      e.preventDefault();
      goChapter(1 < chapters().length ? 1 : 0);
    });
  }

  const lbEl = $('lightbox');
  if (lbEl) lbEl.addEventListener('click', closeLightbox);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (closeLightbox()) return;
      if (libOpen) {
        if (libKind === 'ch' && libFromVol) showLibrary('vol');
        else hideLibrary();
      }
      return;
    }
    if (e.target.matches('input, select, textarea')) return;
    if (libOpen) return;
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
      if (libOpen) return;
      const dx = e.changedTouches[0].clientX - tx;
      const dy = e.changedTouches[0].clientY - ty;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) {
        dx < 0 ? next() : prev();
      }
    },
    { passive: true }
  );

  function handleUrlRouteChange() {
    const r = readUrlRoute();
    if (!r.v && r.ch === null && r.page === null) return;
    const targetVol =
      r.v && (!state.volumes.length || state.volumes.some((x) => String(x.id) === r.v))
        ? r.v
        : state.vol;
    if (libOpen) hideLibrary();
    if (targetVol !== state.vol) {
      state.vol = targetVol;
      state.pendingChapter = r.ch;
      state.fromDeepLink = true;
      state.page = r.page !== null ? r.page : LS.get('page:' + targetVol, 1);
      load().catch(() => {});
    } else if (r.ch !== null && state.book && r.ch !== state.chapter) {
      const max = chapters().length - 1;
      const idx = Math.min(Math.max(0, r.ch), max);
      state.fromDeepLink = true;
      state.page = chapters()[idx].page;
      render();
    } else if (r.page !== null && state.book && r.page !== state.page) {
      state.fromDeepLink = true;
      state.page = Math.min(Math.max(1, r.page), state.book.total);
      render();
    }
  }
  window.addEventListener('popstate', handleUrlRouteChange);
  window.addEventListener('hashchange', handleUrlRouteChange);

  applyTheme();
  applySize();
  load().catch((err) => {
    reader.innerHTML = '<p class="empty-note">Kitap verisi yüklenemedi: ' + err.message + '</p>';
  });
})();
