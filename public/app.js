(() => {
  const RU_ROMANIZED = {
    'Sen daha güzelsin.': 'Ty krasivaya.',
  };

  function renderParagraph(t, doc, glosses = RU_ROMANIZED) {
    const d = doc || document;
    const el = d.createElement('p');
    if (/^[“"—–{-]/.test(t)) {
      el.className = t[0] === '{' ? 'dialog dialog-ru' : 'dialog';
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
      const span = d.createElement('span');
      span.className = 'ru-dialog';
      span.appendChild(d.createTextNode(inner));
      const roma = glosses && Object.prototype.hasOwnProperty.call(glosses, inner) ? glosses[inner] : '';
      if (roma) {
        span.dataset.ru = roma;
        span.title = roma;
      }
      el.appendChild(span);
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

  function readUrlRoute() {
    const searchParams = new URLSearchParams(window.location.search);
    const hashRaw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const hashParams = new URLSearchParams(hashRaw);
    const v =
      searchParams.get('v') ||
      searchParams.get('vol') ||
      hashParams.get('v') ||
      hashParams.get('vol');
    const chRaw = searchParams.has('ch') ? searchParams.get('ch') : hashParams.get('ch');
    const ch = chRaw !== null && chRaw !== '' && /^\d+$/.test(chRaw) ? Number(chRaw) : null;
    const pageRaw =
      searchParams.get('page') ||
      searchParams.get('p') ||
      hashParams.get('page') ||
      hashParams.get('p');
    const page = pageRaw !== null && pageRaw !== '' && /^\d+$/.test(pageRaw) && Number(pageRaw) > 0 ? Number(pageRaw) : null;
    return { v: v ? String(v) : null, ch, page };
  }

  const initialRoute = readUrlRoute();
  const savedVol = LS.get(
    'vol',
    Array.isArray(window.ALYA_VOLUMES) && window.ALYA_VOLUMES[0] ? String(window.ALYA_VOLUMES[0].id) : ''
  );
  const initialVol = initialRoute.v || savedVol;

  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  const state = {
    page:
      initialRoute.page !== null
        ? initialRoute.page
        : initialRoute.v && initialRoute.v !== savedVol
          ? LS.get('page:' + initialVol, 1)
          : LS.get('page:' + initialVol, LS.get('page', 1)),
    mode: LS.get('mode', 'text'),
    theme: LS.get('theme', prefersLight ? 'light' : 'dark'),
    size: LS.get('size', 1.06),
    vol: initialVol,
    volumes: Array.isArray(window.ALYA_VOLUMES) ? window.ALYA_VOLUMES : [],
    pendingChapter: initialRoute.ch,
    fromDeepLink: Boolean(initialRoute.v || initialRoute.ch !== null || initialRoute.page !== null),
    book: null,
    chapter: 0,
  };

  function currentVolumeMeta(volId = state.vol) {
    return state.volumes.find((x) => String(x.id) === String(volId)) || null;
  }

  function syncUrl() {
    if (!state.book) return;
    const vEnc = encodeURIComponent(state.vol);
    const chIdx = state.chapter;
    if (window.location.protocol === 'file:') {
      const nextHash = '#v=' + vEnc + '&ch=' + chIdx;
      if (window.location.hash !== nextHash) {
        try {
          history.replaceState(null, '', nextHash);
        } catch {
          window.location.hash = nextHash;
        }
      }
      return;
    }
    const nextUrl = window.location.pathname + '?v=' + vEnc + '&ch=' + chIdx;
    const curUrl = window.location.pathname + window.location.search + window.location.hash;
    if (curUrl !== nextUrl) {
      try {
        history.replaceState(null, '', nextUrl);
      } catch {}
    }
  }

  /* ---------------- cilt ---------------- */
  async function loadVolumesCatalog() {
    const hasEmbeddedCatalog = Array.isArray(window.ALYA_VOLUMES) && window.ALYA_VOLUMES.length > 0;
    const isLocalServer =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (window.location.protocol.startsWith('http') && (isLocalServer || !hasEmbeddedCatalog)) {
      for (const endpoint of ['api/volumes', 'books/volumes.json']) {
        try {
          const res = await fetch(endpoint);
          if (res.ok) {
            const list = await res.json();
            if (Array.isArray(list) && list.length) {
              state.volumes = list;
              LS.set('volumes', list);
              return list;
            }
          }
        } catch {}
      }
    }
    if (hasEmbeddedCatalog) {
      state.volumes = window.ALYA_VOLUMES;
      return state.volumes;
    }
    const cached = LS.get('volumes', null);
    if (Array.isArray(cached) && cached.length) {
      state.volumes = cached;
      return state.volumes;
    }
    if (window.ALYA_BUNDLE && window.ALYA_BUNDLE.vols) {
      state.volumes = Object.entries(window.ALYA_BUNDLE.vols)
        .sort(([a], [b]) => parseFloat(a) - parseFloat(b))
        .map(([id, b]) => ({
          id: String(id),
          label: b.volume || 'Cilt ' + id,
          subtitle: b.subtitle || '',
          embedArt: Boolean(b.embedArt || (window.ALYA_ART && window.ALYA_ART[id])),
          status: b.status || 'complete',
          statusNote: b.statusNote || '',
          total: b.total || 0,
          chapterCount: Array.isArray(b.chapters) ? b.chapters.length : 0,
        }));
    }
    return state.volumes;
  }

  function volumeProgressPct(entry) {
    const id = String(entry.id);
    const total = (state.book && state.vol === id ? state.book.total : entry.total) || 0;
    if (!total) return 0;
    const max = Math.max(
      LS.get('max:' + id, 0),
      state.vol === id && state.book ? state.page : LS.get('page:' + id, 0)
    );
    if (max <= 0) return 0;
    return Math.min(100, Math.round((max / total) * 100));
  }

  function renderVolList() {
    const list = $('volList');
    if (!list) return;
    list.innerHTML = '';
    state.volumes.forEach((entry) => {
      const id = String(entry.id);
      const li = document.createElement('li');
      li.dataset.vol = id;
      const pct = volumeProgressPct(entry);
      const isCurrent = id === state.vol;
      const isPartial = entry.status === 'partial';
      li.classList.toggle('is-current', isCurrent);
      li.classList.toggle('is-read', pct >= 100 && !isPartial);

      const btn = document.createElement('button');
      btn.type = 'button';

      const lab = document.createElement('span');
      lab.className = 'ch-label';
      const labText = document.createElement('span');
      labText.textContent = entry.label || 'Cilt ' + id;
      lab.appendChild(labText);
      if (isPartial) {
        const badge = document.createElement('span');
        badge.className = 'vol-badge';
        badge.textContent = 'Devam ediyor';
        lab.appendChild(badge);
      }

      const ttl = document.createElement('span');
      ttl.className = 'ch-title';
      ttl.textContent = entry.subtitle || entry.label || 'Cilt ' + id;

      const meta = document.createElement('span');
      meta.className = 'ch-page vol-meta';
      const chCount = (isCurrent && state.book ? state.book.chapters.length : entry.chapterCount) || 0;
      meta.textContent = chCount + ' bölüm · %' + pct;

      btn.append(lab, ttl, meta);
      btn.addEventListener('click', () => {
        toggleVol(false);
        switchVolume(id);
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function switchVolume(v) {
    const nextVol = String(v);
    if (nextVol === state.vol && state.book) return;
    if (state.book && !state.fromDeepLink) LS.set('page:' + state.vol, state.page);
    state.vol = nextVol;
    state.pendingChapter = null;
    state.fromDeepLink = false;
    LS.set('vol', nextVol);
    state.page = LS.get('page:' + nextVol, 1);
    load().catch((err) => {
      const meta = currentVolumeMeta(nextVol);
      const label = meta ? meta.label : 'Cilt ' + nextVol;
      state.book = null;
      $('volLabel').textContent = label;
      $('brandSub').textContent = label + ' · Türkçe';
      renderVolList();
      reader.innerHTML = '<p class="empty-note">' + label + ' verisi henüz hazır değil (' + err.message + ').</p>';
    });
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

  /* veri kaynakları: bellek -> gömülü paket -> önbellek -> statik JSON -> sunucu API */
  function bundleBook(v) {
    const b = window.ALYA_BUNDLE && window.ALYA_BUNDLE.vols && window.ALYA_BUNDLE.vols[v];
    return b || null;
  }

  function cachedBook(v) {
    const ver = window.ALYA_BUNDLE_VERSION || 'dev';
    const hit = LS.get('bookver:' + v, null);
    if (!hit || hit !== ver) return null;
    return LS.get('book:' + v, null);
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

    const embedded = bundleBook(key);
    if (embedded) {
      const enriched = enrichBookMeta(embedded, key);
      memBooks.set(key, enriched);
      return enriched;
    }

    const cached = cachedBook(key);
    if (cached) {
      const enriched = enrichBookMeta(cached, key);
      memBooks.set(key, enriched);
      return enriched;
    }

    let book = null;
    try {
      const staticRes = await fetch('books/' + encodeURIComponent(key) + '.json');
      if (staticRes.ok) book = await staticRes.json();
    } catch {}

    if (!book) {
      const res = await fetch('api/book?v=' + encodeURIComponent(key));
      let payload = null;
      try {
        payload = await res.json();
      } catch {}
      if (!res.ok) {
        throw new Error(payload && payload.error ? payload.error : 'HTTP ' + res.status);
      }
      book = payload;
    }

    const enriched = enrichBookMeta(book, key);
    memBooks.set(key, enriched);
    return enriched;
  }

  async function load() {
    if (!state.volumes.length) await loadVolumesCatalog();
    if (!state.vol || (state.volumes.length && !state.volumes.some((x) => String(x.id) === String(state.vol)))) {
      const fallbackVol = state.volumes[0] ? String(state.volumes[0].id) : '';
      state.vol = fallbackVol;
      state.pendingChapter = null;
      state.page = LS.get('page:' + state.vol, 1);
    }

    state.book = await readBook(state.vol);
    if (state.pendingChapter !== null) {
      const chIdx = Math.min(Math.max(0, state.pendingChapter), chapters().length - 1);
      state.page = chapters()[chIdx].page;
      state.pendingChapter = null;
    } else {
      const saved = LS.get('page:' + state.vol, 1);
      if (state.page < 1 || state.page > state.book.total) state.page = saved;
    }

    $('brandSub').textContent = state.book.volume + ' · Türkçe';
    $('volLabel').textContent = state.book.volume;
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
    markTocRead();
    renderVolList();
    render();
  }

  // içindekilerde okunmuş bölümleri işaretle (en ileri sayfa bazlı)
  function markTocRead() {
    const max = LS.get('max:' + state.vol, state.page);
    for (const li of $('tocList').children) {
      const i = Number(li.dataset.idx);
      const ch = chapters()[i];
      if (ch && ch.pending) {
        li.classList.remove('is-read');
        continue;
      }
      const end = chapterRange(i)[1];
      li.classList.toggle('is-read', max >= end);
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
      const hasFullScan = Boolean(p.art || hasEmbeddedArt(p) || (volMeta && volMeta.embedArt) || state.book.embedArt);
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

    if (!state.fromDeepLink) {
      LS.set('page', n);
      LS.set('page:' + state.vol, n);
    }
    syncUrl();
    paintProgress();
    window.scrollTo({ top: 0 });
  }

  function goPage(n) {
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
    $('navChapter').textContent = ch.label;
    $('navPages').textContent = ch.pending
      ? 'beklemede'
      : startPage === endPage
        ? 's. ' + startPage
        : 's. ' + startPage + '–' + endPage;
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
    if (!state.fromDeepLink) {
      LS.set('page', targetPage);
      LS.set('page:' + state.vol, targetPage);
      if (!ch.pending) {
        const prevMax2 = LS.get('max:' + state.vol, 0);
        if (targetPage > prevMax2) LS.set('max:' + state.vol, targetPage);
      }
    }
    markTocRead();
    renderVolList();
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
      if (!state.fromDeepLink) LS.set('page', seen);
      LS.set('page:' + state.vol, seen);
      const prevMax = LS.get('max:' + state.vol, 0);
      if (seen > prevMax) {
        LS.set('max:' + state.vol, seen);
        markTocRead();
        renderVolList();
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
  $('modeBtn').addEventListener('click', () => {
    state.mode = state.mode === 'text' ? 'page' : 'text';
    render();
  });
  $('modeText').addEventListener('click', () => {
    state.mode = 'text';
    render();
  });
  $('modePage').addEventListener('click', () => {
    state.mode = 'page';
    render();
  });

  function toggleVol(open) {
    const panel = $('volPanel');
    const nextOpen = open === undefined ? panel.hidden : open;
    if (nextOpen && !$('tocPanel').hidden) toggleToc(false);
    panel.hidden = !nextOpen;
    $('volBtn').setAttribute('aria-expanded', String(nextOpen));
    if (nextOpen) renderVolList();
  }

  function toggleToc(open) {
    const panel = $('tocPanel');
    const nextOpen = open === undefined ? panel.hidden : open;
    if (nextOpen && !$('volPanel').hidden) toggleVol(false);
    panel.hidden = !nextOpen;
    $('tocBtn').setAttribute('aria-expanded', String(nextOpen));
  }
  $('volBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleVol();
  });
  $('tocBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleToc();
  });
  document.addEventListener('click', (e) => {
    if (!$('tocPanel').hidden && !$('tocPanel').contains(e.target) && !$('tocBtn').contains(e.target)) {
      toggleToc(false);
    }
    if (!$('volPanel').hidden && !$('volPanel').contains(e.target) && !$('volBtn').contains(e.target)) {
      toggleVol(false);
    }
  });

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
      if (!$('volPanel').hidden) return toggleVol(false);
      return toggleToc(false);
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

  function handleUrlRouteChange() {
    const r = readUrlRoute();
    if (!r.v && r.ch === null && r.page === null) return;
    const targetVol = r.v && (!state.volumes.length || state.volumes.some((x) => String(x.id) === r.v)) ? r.v : state.vol;
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
  loadVolumesCatalog()
    .then(() => load())
    .catch((err) => {
      reader.innerHTML = '<p class="empty-note">Kitap verisi yüklenemedi: ' + err.message + '</p>';
    });
})();
