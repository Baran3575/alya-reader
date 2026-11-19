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

  const DEFAULT_VOLUMES = [
    { id: '4', short: '4', label: 'Cilt 4' },
    { id: '4.5', short: '4.5', label: 'Cilt 4.5' },
    { id: '5', short: '5', label: 'Cilt 5' },
    { id: '6', short: '6', label: 'Cilt 6' },
    { id: '7', short: '7', label: 'Cilt 7' },
    { id: '8', short: '8', label: 'Cilt 8' },
    { id: '9', short: '9', label: 'Cilt 9' },
    { id: '9.5', short: '9.5', label: 'Cilt 9.5' },
    { id: '10', short: '10', label: 'Cilt 10' },
    { id: '11', short: '11', label: 'Cilt 11' },
    { id: '12', short: '12', label: 'Cilt 12' },
  ];

  // Eski sürümlerden kalan büyük JSON önbelleklerini temizle (5 MB localStorage kotasını koru)
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('alya4:book:') || k.startsWith('alya4:bookver:'))) {
        localStorage.removeItem(k);
      }
    }
  } catch {}

  const urlParams = new URLSearchParams(window.location.search);
  const initialUrlVol = urlParams.get('vol') || urlParams.get('v');
  const initialUrlPage = Number(urlParams.get('page') || urlParams.get('p') || 0);

  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  const state = {
    page: initialUrlPage > 0 ? initialUrlPage : LS.get('page', 1),
    mode: LS.get('mode', 'text'),
    theme: LS.get('theme', prefersLight ? 'light' : 'dark'),
    size: LS.get('size', 1.06),
    vol: initialUrlVol || LS.get('vol', '4'),
    volumes: DEFAULT_VOLUMES.slice(),
    book: null,
    chapter: 0,
  };
  if (initialUrlVol && initialUrlPage <= 0) {
    state.page = LS.get('page:' + initialUrlVol, 1);
  }

  const memBooks = new Map();

  /* ---------------- cilt ---------------- */
  function syncVolumeUI() {
    const seg = $('volSelector');
    const list = $('volList');
    const currentMeta =
      state.volumes.find((x) => x.id === state.vol) || { id: state.vol, short: state.vol, label: 'Cilt ' + state.vol };

    if ($('volBtnLabel')) {
      $('volBtnLabel').textContent = currentMeta.label;
    }

    if (seg) {
      seg.innerHTML = '';
      for (const v of state.volumes) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'vol' + v.id.replace('.', '');
        btn.className = 'seg-btn' + (v.id === state.vol ? ' is-on' : '');
        btn.dataset.vol = v.id;
        btn.title = v.label;
        btn.textContent = v.short || v.id;
        btn.setAttribute('aria-pressed', String(v.id === state.vol));
        btn.addEventListener('click', () => switchVolume(v.id));
        seg.appendChild(btn);
        if (v.id === state.vol && typeof btn.scrollIntoView === 'function') {
          btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      }
    }

    if (list) {
      list.innerHTML = '';
      for (const v of state.volumes) {
        const li = document.createElement('li');
        const active = v.id === state.vol;
        li.classList.toggle('is-current', active);
        const savedPage = LS.get('page:' + v.id, 1);
        const maxPage = LS.get('max:' + v.id, 0);
        if (v.hasPending) li.classList.add('is-pending');
        else if (v.total && maxPage >= v.total - 2) li.classList.add('is-read');

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', String(active));

        const lab = document.createElement('span');
        lab.className = 'ch-label';
        lab.textContent = v.label;

        const ttl = document.createElement('span');
        ttl.className = 'ch-title';
        ttl.textContent = v.chapters
          ? v.chapters + ' bölüm' + (v.total ? ' · ' + v.total + ' sayfa' : '')
          : 'Türkçe çeviri';

        const pg = document.createElement('span');
        pg.className = 'ch-page';
        pg.textContent = savedPage > 1 ? 's. ' + savedPage : '';

        btn.append(lab, ttl, pg);
        btn.addEventListener('click', () => {
          toggleVolPanel(false);
          switchVolume(v.id);
        });
        li.appendChild(btn);
        list.appendChild(li);
      }
    }
  }

  async function loadVolumeManifest() {
    if (!location.protocol.startsWith('http')) return;
    try {
      const res = await fetch('books/index.json');
      if (!res.ok) return;
      const manifest = await res.json();
      if (manifest && Array.isArray(manifest.volumes) && manifest.volumes.length > 0) {
        state.volumes = manifest.volumes;
        if (!state.volumes.some((v) => v.id === state.vol)) {
          state.vol = state.volumes[0].id;
        }
        syncVolumeUI();
      }
    } catch {}
  }

  function switchVolume(v) {
    if (v === state.vol) return;
    LS.set('page:' + state.vol, state.page);
    state.vol = v;
    LS.set('vol', v);
    state.page = LS.get('page:' + v, 1);
    syncVolumeUI();
    load().catch((err) => {
      reader.innerHTML = '<p class="empty-note">Cilt ' + v + ' yüklenemedi: ' + err.message + '</p>';
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
  /* görsel: gömülü illüstrasyon varsa data URI, yoksa alt-dizin uyumlu göreli dosya yolu */
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

  function pageHasAvailableImage(p) {
    if (!p) return false;
    if (hasEmbeddedArt(p)) return true;
    if (typeof p.hasImg === 'boolean') return p.hasImg;
    return p.art === true;
  }

  function bundleBook(v) {
    const b = window.ALYA_BUNDLE && window.ALYA_BUNDLE.vols && window.ALYA_BUNDLE.vols[v];
    return b || null;
  }

  let bundleLoading = null;
  function ensureBundleScript() {
    if (window.ALYA_BUNDLE) return Promise.resolve(true);
    if (bundleLoading) return bundleLoading;
    bundleLoading = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'bundle.js';
      s.onload = () => resolve(Boolean(window.ALYA_BUNDLE));
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return bundleLoading;
  }

  /* veri kaynakları: bellek -> statik books/<v>.json -> api/book -> bundle.js (file:// ve çevrimdışı yedek) */
  async function readBook(v) {
    if (memBooks.has(v)) return memBooks.get(v);

    if (location.protocol.startsWith('http')) {
      try {
        const staticRes = await fetch('books/' + encodeURIComponent(v) + '.json');
        if (staticRes.ok) {
          const book = await staticRes.json();
          memBooks.set(v, book);
          return book;
        }
      } catch {}

      try {
        const apiRes = await fetch('api/book?v=' + encodeURIComponent(v));
        if (apiRes.ok) {
          const book = await apiRes.json();
          memBooks.set(v, book);
          return book;
        }
      } catch {}
    }

    await ensureBundleScript();
    if (Array.isArray(window.ALYA_VOLUMES) && window.ALYA_VOLUMES.length > 0) {
      state.volumes = window.ALYA_VOLUMES.slice();
    } else if (window.ALYA_BUNDLE && window.ALYA_BUNDLE.vols) {
      const ids = Object.keys(window.ALYA_BUNDLE.vols).sort((a, b) => parseFloat(a) - parseFloat(b));
      if (ids.length >= state.volumes.length) {
        state.volumes = ids.map((id) => {
          const bk = window.ALYA_BUNDLE.vols[id];
          return { id, short: id, label: bk.volume || 'Cilt ' + id, total: bk.total, chapters: bk.chapters.length };
        });
      }
    }
    const embedded = bundleBook(v);
    if (embedded) {
      memBooks.set(v, embedded);
      return embedded;
    }

    throw new Error('Cilt ' + v + ' bulunamadı');
  }

  async function load() {
    if (!state.volumes.some((v) => v.id === state.vol)) {
      state.vol = '4';
      LS.set('vol', '4');
    }
    state.book = await readBook(state.vol);
    const saved = LS.get('page:' + state.vol, 1);
    if (state.page < 1 || state.page > state.book.total) state.page = saved;

    const metaEntry = state.volumes.find((v) => v.id === state.vol);
    if (metaEntry && !metaEntry.total) {
      metaEntry.total = state.book.total;
      metaEntry.chapters = state.book.chapters.length;
      metaEntry.hasPending = state.book.chapters.some((c) => c.pending);
    }

    $('brandSub').textContent = state.book.volume + ' · Türkçe';
    syncVolumeUI();
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
      /^(?:\d+\.\s*)?(Bölüm|Önsöz|Sonsöz|Epilog|Prolog|Ara Bölüm|Kısa Hikâye|Ek Hikâye|Ek Öykü|Yazarın Notu|Yazarın Sonsözü|Başlangıç)\b/.test(t);
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

  function figureFor(p, caption) {
    const fig = document.createElement('figure');
    fig.className = 'page-img';
    const img = document.createElement('img');
    img.src = imgSrc(p);
    img.alt = 'Sayfa ' + p.n;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('load', () => scheduleProgress(), { once: true });
    img.addEventListener(
      'error',
      () => {
        fig.hidden = true;
        if (
          fig.parentElement &&
          fig.parentElement.classList.contains('pg-art') &&
          !fig.parentElement.classList.contains('has-text')
        ) {
          fig.parentElement.hidden = true;
        }
      },
      { once: true }
    );
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
      if (pageHasAvailableImage(p)) {
        sec.appendChild(figureFor(p, false));
      } else if (p.en && p.en.length) {
        const proseWrap = document.createElement('div');
        proseWrap.className = 'orig-prose';
        for (const line of p.en) {
          const el = document.createElement('p');
          if (/^[“"—–-]/.test(line)) el.className = 'dialog';
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
      } else {
        const note = document.createElement('p');
        note.className = 'empty-note';
        note.textContent = 'Bu sayfa için tarama görseli bulunmuyor.';
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

        const isIllustration =
          p.art === true ||
          (p.tr.length === 0 && pageHasAvailableImage(p));

        if (isIllustration) {
          if (!pageHasAvailableImage(p)) {
            if (p.tr.length === 0) continue;
          } else {
            sec.classList.add('pg-art');
            if (p.tr.length) sec.classList.add('has-text');
            sec.appendChild(figureFor(p, true));
            if (p.tr.length === 0) {
              frag.appendChild(sec);
              continue;
            }
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
      if (p && !p.pending && p.art && pageHasAvailableImage(p)) imgs.push(imgSrc(p));
    }
    const nxt = chapters()[idx + 1];
    if (nxt && !nxt.pending) {
      for (let n = nxt.page; n <= Math.min(nxt.page + 3, state.book.total); n++) {
        const p = state.book.pages[n - 1];
        if (p && !p.pending && p.art && pageHasAvailableImage(p)) imgs.push(imgSrc(p));
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

  function toggleVolPanel(open) {
    const panel = $('volPanel');
    if (!panel) return;
    const nextOpen = open === undefined ? panel.hidden : open;
    if (nextOpen) toggleToc(false);
    panel.hidden = !nextOpen;
    if ($('volBtn')) $('volBtn').setAttribute('aria-expanded', String(nextOpen));
  }
  function toggleToc(open) {
    const panel = $('tocPanel');
    const nextOpen = open === undefined ? panel.hidden : open;
    if (nextOpen) toggleVolPanel(false);
    panel.hidden = !nextOpen;
    $('tocBtn').setAttribute('aria-expanded', String(nextOpen));
  }
  if ($('volBtn')) {
    $('volBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleVolPanel();
    });
  }
  $('tocBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleToc();
  });
  document.addEventListener('click', (e) => {
    if ($('volPanel') && !$('volPanel').hidden && !$('volPanel').contains(e.target)) toggleVolPanel(false);
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
      toggleVolPanel(false);
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
  syncVolumeUI();
  loadVolumeManifest();
  load().catch((err) => {
    reader.innerHTML = '<p class="empty-note">Kitap verisi yüklenemedi: ' + err.message + '</p>';
  });
})();
