(() => {
  const $ = (id) => document.getElementById(id);
  const reader = $('reader');

  const CACHE_NAME = 'alya-v4';
  const bookCache = new Map();
  const inflightBooks = new Map();
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

  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  const state = {
    page: LS.get('page', 1),
    mode: LS.get('mode', 'text'),
    theme: LS.get('theme', prefersLight ? 'light' : 'dark'),
    size: LS.get('size', 1.06),
    vol: LS.get('vol', manifest().defaultVol || '4'),
    book: null,
    chapter: 0,
  };
  if (manifest().volumes && Object.keys(manifest().volumes).length > 0 && !manifest().volumes[state.vol]) {
    state.vol = manifest().defaultVol || Object.keys(manifest().volumes)[0] || '4';
  }

  /* ---------------- cilt ---------------- */
  function switchVolume(v) {
    if (v === state.vol) return;
    LS.set('page:' + state.vol, state.page);
    state.vol = v;
    LS.set('vol', v);
    state.page = LS.get('page:' + v, 1);
    load().catch((err) => {
      const p = document.createElement('p');
      p.className = 'empty-note';
      p.textContent = 'Kitap verisi yüklenemedi: ' + err.message;
      reader.replaceChildren(p);
    });
  }

  function initVolumeButtons() {
    const seg = $('volSeg') || document.querySelector('.seg-vol');
    if (!seg) return;
    const vols = manifest().volumes || {};
    const keys = Object.keys(vols);
    if (keys.length > 0) {
      seg.innerHTML = '';
      for (const k of keys) {
        const btn = document.createElement('button');
        btn.id = 'vol' + k.replace(/[^a-zA-Z0-9]/g, '');
        btn.dataset.vol = k;
        btn.className = 'seg-btn' + (k === state.vol ? ' is-on' : '');
        btn.type = 'button';
        btn.title = (vols[k] && vols[k].volume) || 'Cilt ' + k;
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

  function loadBookScript(v, jsPath) {
    return new Promise((resolve, reject) => {
      if (window.ALYA_CHUNKS && window.ALYA_CHUNKS[v]) {
        const hit = window.ALYA_CHUNKS[v];
        delete window.ALYA_CHUNKS[v];
        return resolve(hit);
      }
      const s = document.createElement('script');
      s.src = jsPath;
      s.async = true;
      s.onload = () => {
        s.remove();
        const hit = window.ALYA_CHUNKS && window.ALYA_CHUNKS[v];
        if (hit) {
          delete window.ALYA_CHUNKS[v];
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

  /* veri kaynakları: bellek içi Map -> CacheStorage / tembel JSON paketi -> file:// JS yedeği -> sunucu */
  async function readBook(v) {
    if (bookCache.has(v)) return bookCache.get(v);
    if (window.ALYA_CHUNKS && window.ALYA_CHUNKS[v]) {
      const preloaded = window.ALYA_CHUNKS[v];
      delete window.ALYA_CHUNKS[v];
      bookCache.set(v, preloaded);
      return preloaded;
    }
    if (inflightBooks.has(v)) return inflightBooks.get(v);

    const task = (async () => {
      const entry = (manifest().volumes && manifest().volumes[v]) || null;
      const jsonRel = (entry && entry.json) || 'bundles/book-' + v + '.json';
      const jsRel = (entry && entry.js) || 'bundles/book-' + v + '.js';
      const versionedJson = entry && entry.hash ? jsonRel + '?v=' + encodeURIComponent(entry.hash) : jsonRel;

      let book = null;
      try {
        book = await fetchJsonCached(versionedJson);
      } catch {
        try {
          book = await loadBookScript(v, jsRel);
        } catch (scriptErr) {
          if (location.protocol.startsWith('http')) {
            book = await fetchJsonCached('api/book?v=' + encodeURIComponent(v));
          } else {
            throw scriptErr;
          }
        }
      }
      bookCache.set(v, book);
      return book;
    })();

    inflightBooks.set(v, task);
    try {
      return await task;
    } finally {
      inflightBooks.delete(v);
    }
  }

  async function load() {
    const seq = ++loadSeq;
    const targetVol = state.vol;
    const loadedBook = await readBook(targetVol);
    if (seq !== loadSeq) return;
    state.book = loadedBook;
    const saved = LS.get('page:' + state.vol, 1);
    if (state.page < 1 || state.page > state.book.total) state.page = saved;

    $('brandSub').textContent = state.book.volume + ' · Türkçe';
    const seg = $('volSeg') || document.querySelector('.seg-vol');
    document.querySelectorAll('.seg-vol .seg-btn').forEach((btn) => {
      const on = btn.dataset.vol === state.vol;
      btn.classList.toggle('is-on', on);
      if (on && seg && seg.scrollWidth > seg.clientWidth) {
        seg.scrollLeft = btn.offsetLeft - seg.clientWidth / 2 + btn.offsetWidth / 2;
      }
    });
    document.title = 'Alya Bazen Duygularını Rusça Saklar · ' + state.book.volume;

    $('pageRange').max = chapters().length;

    const list = $('tocList');
    list.innerHTML = '';
    chapters().forEach((ch, i) => {
      const li = document.createElement('li');
      li.dataset.page = ch.page;
      li.dataset.idx = i;
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
      pg.textContent = s === e ? s : s + '–' + e;
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
    render();
  }

  // içindekilerde okunmuş bölümleri işaretle (en ileri sayfa bazlı)
  function markTocRead() {
    const max = LS.get('max:' + state.vol, state.page);
    for (const li of $('tocList').children) {
      const i = Number(li.dataset.idx);
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
    const looksHeading = /^(?:\d+\.\s*)?(Bölüm|Önsöz|Sonsöz|Epilog|Prolog|Başlangıç)\b/.test(t);
    if (!looksHeading) return out;
    if (q > 0 && q < 140) {
      out[0] = t.slice(q);
    } else {
      const i = t.indexOf(ch.title);
      if (i >= 0) {
        const rest = t.slice(i + ch.title.length).replace(/^[:\s"”]+/, '');
        if (rest.length > 40) out[0] = rest;
        else out.shift();
      }
    }
    return out;
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
    if (p && (p.art || hasFullScans(state.vol))) {
      sec.appendChild(figureFor(p, false, true));
    } else {
      const note = document.createElement('p');
      note.className = 'empty-note';
      note.textContent = 'Bu sayfanın tarama görseli çevrimdışı pakette yer almıyor; yalnızca illüstrasyon sayfaları dahildir.';
      sec.appendChild(note);
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

    LS.set('page', n);
    LS.set('page:' + state.vol, n);
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
    meta.textContent =
      'Sayfa ' + startPage + (startPage === endPage ? '' : '–' + endPage) +
      ' · ' + pages + ' sayfa · ~' + mins + ' dk';
    head.append(kicker, h1, meta);
    reader.appendChild(head);

    const frag = document.createDocumentFragment();
    for (let n = startPage; n <= endPage; n++) {
      const p = state.book.pages[n - 1];
      if (!p) continue;
      const sec = document.createElement('section');
      sec.className = 'pg';
      sec.dataset.page = p.n;

      if (state.mode === 'page') {
        sec.appendChild(figureFor(p, true));
        frag.appendChild(sec);
        continue;
      }

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

      let paras = n === startPage ? cleanHeading(p.tr, ch) : p.tr;
      for (const t of paras) {
        if (!t) continue;
        const el = document.createElement('p');
        if (/^[“"—–-]/.test(t)) el.className = 'dialog';
        el.textContent = t;
        sec.appendChild(el);
      }
      frag.appendChild(sec);
    }
    reader.appendChild(frag);

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
    $('navChapter').textContent = ch.label;
    $('navPages').textContent = startPage === endPage ? 's. ' + startPage : 's. ' + startPage + '–' + endPage;
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
    LS.set('page', targetPage);
    LS.set('page:' + state.vol, targetPage);
    const prevMax2 = LS.get('max:' + state.vol, 0);
    if (targetPage > prevMax2) LS.set('max:' + state.vol, targetPage);
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

  function prefetch() {
    if (state.mode !== 'page' || !state.book) return;
    const nxt = state.book.pages[state.page];
    if (nxt && (nxt.art || hasFullScans(state.vol))) {
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
  function goto(n) {
    goChapter(chapterIndex(n), n);
  }

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

  function toggleToc(open) {
    const panel = $('tocPanel');
    const nextOpen = open === undefined ? panel.hidden : open;
    panel.hidden = !nextOpen;
    $('tocBtn').setAttribute('aria-expanded', String(nextOpen));
  }
  $('tocBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleToc();
  });
  document.addEventListener('click', (e) => {
    if (!$('tocPanel').hidden && !$('tocPanel').contains(e.target)) toggleToc(false);
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

  applyTheme();
  applySize();
  load().catch((err) => {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = 'Kitap verisi yüklenemedi: ' + err.message;
    reader.replaceChildren(p);
  });
})();
