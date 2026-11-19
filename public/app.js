(() => {
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

  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  const state = {
    page: LS.get('page', 1),
    mode: LS.get('mode', 'text'),
    theme: LS.get('theme', prefersLight ? 'light' : 'dark'),
    size: LS.get('size', 1.06),
    vol: LS.get('vol', '4'),
    book: null,
    chapter: 0,
  };

  /* ---------------- cilt ---------------- */
  function switchVolume(v) {
    if (v === state.vol) return;
    LS.set('page:' + state.vol, state.page);
    state.vol = v;
    LS.set('vol', v);
    state.page = LS.get('page:' + v, 1);
    load().catch(() => {});
  }
  $('vol4').addEventListener('click', () => switchVolume('4'));
  $('vol45').addEventListener('click', () => switchVolume('4.5'));

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
  /* görsel: gömülü illüstrasyon varsa data URI, yoksa taranmış dosya yolu (mevcutsa) */
  function embeddedArt(p, vol) {
    if (!p) return '';
    const key = String(p.n).padStart(3, '0');
    const pack = window.ALYA_ART && window.ALYA_ART[vol || state.vol];
    return (pack && pack[key]) || '';
  }

  function hasArt(p, vol) {
    return Boolean(embeddedArt(p, vol));
  }

  function canLoadScan(p, vol) {
    if (!p) return false;
    if (hasArt(p, vol)) return true;
    const targetVol = vol || state.vol;
    const book = state.book && targetVol === state.vol ? state.book : bundleBook(targetVol);
    return Boolean(book && book.scansAvailable && p.img);
  }

  function imgSrc(p, vol) {
    const artUri = embeddedArt(p, vol);
    if (artUri) return artUri;
    if (canLoadScan(p, vol)) return p.img;
    return '';
  }

  /* veri kaynakları: localStorage -> gömülü paket -> sunucu */
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

  async function readBook(v) {
    const cached = cachedBook(v);
    if (cached) return cached;
    const embedded = bundleBook(v);
    if (embedded) {
      LS.set('book:' + v, embedded);
      LS.set('bookver:' + v, window.ALYA_BUNDLE_VERSION || 'dev');
      return embedded;
    }
    const res = await fetch('api/book?v=' + encodeURIComponent(v));
    const book = await res.json();
    try {
      LS.set('book:' + v, book);
      LS.set('bookver:' + v, window.ALYA_BUNDLE_VERSION || 'dev');
    } catch (e) {}
    return book;
  }

  async function load() {
    state.book = await readBook(state.vol);
    const saved = LS.get('page:' + state.vol, 1);
    if (state.page < 1 || state.page > state.book.total) state.page = saved;

    $('brandSub').textContent = state.book.volume + ' · Türkçe';
    $('vol4').classList.toggle('is-on', state.vol === '4');
    $('vol45').classList.toggle('is-on', state.vol === '4.5');
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

  function nextArtTarget(fromPage) {
    if (!state.book || !Array.isArray(state.book.pages)) return null;
    const ahead = state.book.pages.find((pg) => pg.n > fromPage && hasArt(pg));
    if (ahead) return { page: ahead.n, wrapped: false };
    const first = state.book.pages.find((pg) => pg.n !== fromPage && hasArt(pg));
    if (first) return { page: first.n, wrapped: true };
    return null;
  }

  function scanFallbackCard(p) {
    const card = document.createElement('div');
    card.className = 'scan-fallback';

    const kicker = document.createElement('p');
    kicker.className = 'scan-fallback-kicker';
    kicker.textContent = 'Sayfa ' + p.n + ' · Tarama görseli gömülü değil';

    const title = document.createElement('p');
    title.className = 'scan-fallback-title';
    title.textContent =
      p.tr && p.tr.length > 0
        ? 'Bu sayfanın tam tarama görseli çevrimdışı pakette yer almıyor.'
        : 'Bu kapak veya dizin sayfasının taraması çevrimdışı pakette yer almıyor.';

    const desc = document.createElement('p');
    desc.className = 'scan-fallback-body';
    desc.textContent =
      p.tr && p.tr.length > 0
        ? 'Pakette yalnızca kitap içi illüstrasyonlar yer alıyor. Türkçe metni Çeviri görünümünde okuyabilir veya sonraki illüstrasyona geçebilirsiniz.'
        : 'Pakette yalnızca kitap içi illüstrasyonlar yer alıyor. Bölüm akışına Çeviri görünümünden dönebilir veya sonraki illüstrasyona geçebilirsiniz.';

    const actions = document.createElement('div');
    actions.className = 'scan-fallback-actions';

    const textBtn = document.createElement('button');
    textBtn.type = 'button';
    textBtn.className = 'scan-fallback-btn scan-fallback-btn--primary';
    textBtn.textContent = 'Çeviri görünümüne geç';
    textBtn.addEventListener('click', () => {
      state.mode = 'text';
      LS.set('mode', 'text');
      render();
    });
    actions.appendChild(textBtn);

    const artTarget = nextArtTarget(p.n);
    if (artTarget) {
      const nextArtBtn = document.createElement('button');
      nextArtBtn.type = 'button';
      nextArtBtn.className = 'scan-fallback-btn';
      nextArtBtn.textContent = artTarget.wrapped
        ? 'İlk illüstrasyon · s. ' + artTarget.page + ' ↺'
        : 'Sonraki illüstrasyon · s. ' + artTarget.page + ' →';
      nextArtBtn.addEventListener('click', () => goPage(artTarget.page));
      actions.appendChild(nextArtBtn);
    }

    card.append(kicker, title, desc, actions);
    return card;
  }

  function figureFor(p, caption) {
    if (!canLoadScan(p)) return null;
    const src = imgSrc(p);
    if (!src) return null;
    const fig = document.createElement('figure');
    fig.className = 'page-img';
    const img = document.createElement('img');
    img.src = src;
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
    if (p) {
      const fig = figureFor(p, false);
      sec.appendChild(fig || scanFallbackCard(p));
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

    const [startPage, endPage] = chapterRange(idx);
    $('pageRange').value = idx + 1;
    $('navChapter').textContent = ch.label;
    $('navPages').textContent = startPage === endPage ? 's. ' + startPage : 's. ' + startPage + '–' + endPage;
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
    const prevMax = LS.get('max:' + state.vol, 0);
    if (n > prevMax) {
      LS.set('max:' + state.vol, n);
      markTocRead();
    }
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

      if (p.tr.length === 0 && !canLoadScan(p)) {
        continue;
      }

      const isIllustration = (p.tr.length === 0 || p.art === true) && canLoadScan(p);
      if (isIllustration) {
        const fig = figureFor(p, true);
        if (fig) {
          sec.classList.add('pg-art');
          if (p.tr.length) sec.classList.add('has-text');
          sec.appendChild(fig);
        }
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

  function prefetch(idx) {
    const imgs = [];
    for (let n = chapters()[idx].page; n <= chapterRange(idx)[1]; n++) {
      const p = state.book.pages[n - 1];
      if (p && (p.art || p.tr.length === 0) && canLoadScan(p)) {
        const src = imgSrc(p);
        if (src) imgs.push(src);
      }
    }
    const nxt = chapters()[idx + 1];
    if (nxt) {
      for (let n = nxt.page; n <= Math.min(nxt.page + 3, state.book.total); n++) {
        const p = state.book.pages[n - 1];
        if (p && (p.art || p.tr.length === 0) && canLoadScan(p)) {
          const src = imgSrc(p);
          if (src) imgs.push(src);
        }
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
    reader.innerHTML = '<p class="empty-note">Kitap verisi yüklenemedi: ' + err.message + '</p>';
  });
})();
