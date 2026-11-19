(() => {
  const RU_ROMANIZED = {
    'Sen daha güzelsin.': 'Ty krasivaya.',
    'Sapık.': 'Razvratnik.',
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
      const rawInner = t.slice(open + 1, close);
      const inner = rawInner.trim();
      if (!inner) {
        el.appendChild(d.createTextNode(t.slice(open, close + 1)));
        pos = close + 1;
        continue;
      }
      if (/^\s/.test(rawInner) && open > 0 && !/\s$/.test(t.slice(0, open))) {
        el.appendChild(d.createTextNode(' '));
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
      if (/\s$/.test(rawInner) && close + 1 < t.length && !/^\s/.test(t[close + 1])) {
        el.appendChild(d.createTextNode(' '));
      }
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
  const volButtons = Array.from(document.querySelectorAll('#volSelector [data-vol]'));

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

  // URL sorgusu (?vol=9.5 veya #vol=12) ile doğrudan cilt açma desteği
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
    load().catch((err) => {
      reader.innerHTML = '<p class="empty-note">Cilt ' + v + ' yüklenemedi: ' + err.message + '</p>';
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
    return readSet(vol).length;
  }

  const sheet = $('sheet');
  let sheetKind = 'vol';
  let savedScroll = 0;

  function openSheet(kind) {
    sheetKind = kind;
    savedScroll = window.scrollY || 0;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    sheet.hidden = false;
    $('sheetActions').hidden = kind !== 'ch';
    $('volBtn').setAttribute('aria-expanded', String(kind === 'vol'));
    $('chBtn').setAttribute('aria-expanded', String(kind === 'ch'));
    buildSheet();
    sheet.querySelector('.sheet-body').scrollTop = 0;
    $('sheetClose').focus({ preventScroll: true });
  }

  function closeSheet() {
    sheet.hidden = true;
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    $('volBtn').setAttribute('aria-expanded', 'false');
    $('chBtn').setAttribute('aria-expanded', 'false');
    window.scrollTo(0, savedScroll);
  }

  function buildSheet() {
    const body = $('sheetBody');
    body.innerHTML = '';
    if (sheetKind === 'vol') {
      $('sheetTitle').textContent = 'Cilt seç';
      for (const key of Object.keys(volTitle)) {
        const total = (volTotal(key) || {}).total || 0;
        const count = volTitle[key];
        const read = readCount(key);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'row' + (String(state.vol) === key ? ' is-current' : '');
        row.innerHTML =
          '<span class="row-main"><span class="row-title">' + count + '</span>' +
          '<span class="row-meta">' + (total ? total + ' bölüm' : '') +
          (read ? ' · ' + read + ' okundu' : '') + '</span></span>' +
          (read ? '<span class="row-dot is-on" aria-hidden="true">✓</span>' : '<span class="row-dot" aria-hidden="true"></span>');
        row.addEventListener('click', () => {
          closeSheet();
          switchVolume(key);
        });
        body.appendChild(row);
      }
      return;
    }

    const ch = chapters()[state.chapter];
    $('sheetTitle').textContent = volTitle[String(state.vol)] + (ch ? ' · ' + ch.label : '');
    const list = chapters();
    list.forEach((c, i) => {
      const [s, e] = chapterRange(i);
      const read = isRead(String(state.vol), i);
      const wrap = document.createElement('div');
      wrap.className = 'row' + (i === state.chapter ? ' is-current' : '') + (read ? ' is-read' : '');

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'row-main';
      main.innerHTML =
        '<span class="row-title">' + c.label + (c.title ? ' · ' + c.title : '') + '</span>' +
        '<span class="row-meta">' + (c.pending ? 'yakında' : s === e ? 's. ' + s : 's. ' + s + '–' + e) + '</span>';
      main.addEventListener('click', () => {
        closeSheet();
        goChapter(i);
      });

      const check = document.createElement('button');
      check.type = 'button';
      check.className = 'row-check' + (read ? ' is-on' : '');
      check.setAttribute('aria-pressed', String(read));
      check.setAttribute('aria-label', c.label + ' okundu');
      check.textContent = '✓';
      check.addEventListener('click', () => {
        const next = !isRead(String(state.vol), i);
        setRead(String(state.vol), i, next);
        check.classList.toggle('is-on', next);
        check.setAttribute('aria-pressed', String(next));
        wrap.classList.toggle('is-read', next);
        markTocRead();
      });

      wrap.append(main, check);
      body.appendChild(wrap);
    });
  }

  $('volBtn').addEventListener('click', () => openSheet('vol'));
  $('chBtn').addEventListener('click', () => openSheet('ch'));
  $('sheetClose').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) closeSheet();
  });
  $('markAllBtn').addEventListener('click', () => {
    chapters().forEach((c, i) => {
      if (!c.pending) setRead(String(state.vol), i, true);
    });
    buildSheet();
    markTocRead();
  });
  $('clearAllBtn').addEventListener('click', () => {
    LS.set('read:' + state.vol, []);
    buildSheet();
    markTocRead();
  });

  function volTotal(key) {
    const m = window.ALYA_BUNDLE && window.ALYA_BUNDLE.vols && window.ALYA_BUNDLE.vols[key];
    return m ? { total: m.chapters ? m.chapters.length : 0 } : { total: 0 };
  }

  function syncPickers() {
    $('volLabel').textContent = volTitle[String(state.vol)] || 'Cilt ' + state.vol;
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

  /* illüstrasyonlar cilt başına parça hâlinde; ilk kullanımda yüklenir */
  const artLoading = new Map();
  function ensureArt(v) {
    window.ALYA_ART = window.ALYA_ART || {};
    if (window.ALYA_ART[v] && Object.keys(window.ALYA_ART[v]).length) return Promise.resolve();
    if (artLoading.has(v)) return artLoading.get(v);
    const p = fetch('books/art-' + encodeURIComponent(v) + '.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((pack) => {
        if (pack) window.ALYA_ART[v] = pack;
      })
      .catch(() => {})
      .finally(() => artLoading.delete(v));
    artLoading.set(v, p);
    return p;
  }

  /* veri kaynakları: önbellek -> cilt parçası -> gömülü paket -> sunucu API */
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

  const memBooks = new Map();

  async function readBook(v) {
    if (memBooks.has(v)) return memBooks.get(v);

    const cached = cachedBook(v);
    if (cached) {
      memBooks.set(v, cached);
      return cached;
    }

    // 1) cilt parçası (ilk yüklemede yalnızca açılan cilt iner)
    let book = null;
    try {
      const res = await fetch('books/v' + encodeURIComponent(v) + '.json');
      if (res.ok) book = await res.json();
    } catch {}

    // 2) gömülü tam paket (çevrimdışı / file:// yedeği)
    if (!book) book = bundleBook(v);

    // 3) sunucu API
    if (!book) {
      try {
        const res = await fetch('api/book?v=' + encodeURIComponent(v));
        if (res.ok) book = await res.json();
      } catch {}
    }
    if (!book) throw new Error('Cilt ' + v + ' yüklenemedi');

    memBooks.set(v, book);
    try {
      LS.set('book:' + v, book);
      LS.set('bookver:' + v, window.ALYA_BUNDLE_VERSION || 'dev');
    } catch (e) {}
    return book;
  }

  async function load() {
    state.book = await readBook(state.vol);
    await ensureArt(state.vol);
    const saved = LS.get('page:' + state.vol, 1);
    if (state.page < 1 || state.page > state.book.total) state.page = saved;

    $('brandSub').textContent = state.book.volume + ' · Türkçe';
    if ($('volLabel')) $('volLabel').textContent = state.book.volume;
    volButtons.forEach((btn) => {
      const active = btn.dataset.vol === state.vol;
      btn.classList.toggle('is-on', active);
      btn.setAttribute('aria-current', active ? 'true' : 'false');
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
      const hasFullScan = p.art || hasEmbeddedArt(p) || state.vol === '4' || state.vol === '4.5';
      if (hasFullScan) {
        sec.appendChild(figureFor(p, false));
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
          if (!line) continue;
          sec.appendChild(renderParagraph(line));
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

        const isIllustration = p.art === true || (p.tr.length === 0 && (state.vol === '4' || state.vol === '4.5' || hasEmbeddedArt(p)));
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
  $('modeText').addEventListener('click', () => {
    state.mode = 'text';
    syncModeButtons();
    render();
  });
  $('modePage').addEventListener('click', () => {
    state.mode = 'page';
    syncModeButtons();
    render();
  });

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
