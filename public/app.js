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

  /* ---------------- cilt ---------------- */
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

  function switchVolume(v) {
    const nextVol = String(v);
    if (nextVol === state.vol) return;
    LS.set('page:' + state.vol, state.page);
    state.vol = nextVol;
    LS.set('vol', nextVol);
    state.page = LS.get('page:' + nextVol, 1);
    load().catch((err) => {
      reader.innerHTML = '<p class="empty-note">Cilt ' + nextVol + ' yüklenemedi: ' + err.message + '</p>';
    });
  }

  const volSelectEl = $('volSelect');
  if (volSelectEl) {
    volSelectEl.addEventListener('change', (e) => switchVolume(e.target.value));
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
    if (memoryBooks.has(v)) return memoryBooks.get(v);

    const manifest = await readManifest();
    const meta = manifest && manifest.volumes && manifest.volumes[v];
    if (meta) {
      const slug = meta.slug || volSlug(v);
      const query = meta.hash ? '?v=' + encodeURIComponent(meta.hash) : '';
      try {
        const res = await fetch('bundles/vol-' + slug + '.json' + query);
        if (res.ok) {
          const book = await res.json();
          memoryBooks.set(v, book);
          return book;
        }
      } catch {}
    }

    const res = await fetch('api/book?v=' + encodeURIComponent(v));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const book = await res.json();
    memoryBooks.set(v, book);
    return book;
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
    } else if (p) {
      const hasFullScan = p.art || state.vol === '4' || state.vol === '4.5';
      if (hasFullScan) {
        const fig = figureFor(p, false);
        if (!p.art && p.tr && p.tr.length) {
          const im = fig.querySelector('img');
          if (im && typeof im.addEventListener === 'function') {
            im.addEventListener(
              'error',
              () => {
                fig.remove();
                for (const line of p.tr) {
                  const el = document.createElement('p');
                  el.textContent = line;
                  sec.appendChild(el);
                }
              },
              { once: true }
            );
          }
        }
        sec.appendChild(fig);
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
          const el = document.createElement('p');
          el.textContent = line;
          sec.appendChild(el);
        }
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
          const el = document.createElement('p');
          if (/^[“"—–-]/.test(t)) el.className = 'dialog';
          el.textContent = t;
          sec.appendChild(el);
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
