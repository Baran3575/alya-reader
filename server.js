// Bağımlılıksız basit sunucu — http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { ALL_VOLUME_SPECS } = require('./scripts/volumes');

const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const TR_CHAPTER = {
  prologue: 'Önsöz',
  epilogue: 'Sonsöz',
  afterword: 'Sonsöz Notu',
  interlude: 'Ara Bölüm',
  anecdote: 'Anekdot',
};

function matchPageHeading(firstLine, nextLine = '') {
  const first = String(firstLine || '').replace(/\s+/g, ' ').trim();
  if (!first) return null;

  // 1) Chapter N (iki nokta/tire ile veya yalın)
  let m = first.match(/^Chapter\s+(\d+)(?:\s*[:–—-]\s*(.*))?$/i);
  if (m) {
    let rest = (m[2] || '').trim();
    if (rest && nextLine && rest.length < 48 && !/[.!?…]$/.test(rest) && /^[A-Z0-9(]/.test(nextLine) && nextLine.length < 42) {
      // Başlık iki satıra sarılmışsa yalnızca kısa başlık devamını kontrol et
    }
    return { key: 'Chapter ' + m[1], label: 'Bölüm ' + m[1], defaultTitle: rest || 'Bölüm ' + m[1] };
  }

  // 2) Prologue
  m = first.match(/^Prologue(?:\s*[:–—-]\s*(.*))?$/i);
  if (m) {
    return { key: 'Prologue', label: TR_CHAPTER.prologue, defaultTitle: (m[1] || '').trim() || 'Önsöz' };
  }

  // 3) Epilogue (iki nokta/tire olmadan yalın başlık dahil)
  m = first.match(/^Epilogue(?:\s*[:–—-]\s*(.*))?$/i);
  if (m) {
    return { key: 'Epilogue', label: TR_CHAPTER.epilogue, defaultTitle: (m[1] || '').trim() || 'Sonsöz' };
  }

  // 4) Afterword SS (Sonsöz ek kısa hikâyesi)
  m = first.match(/^Afterword\s+SS(?:\s*[:–—-]\s*(.*))?$/i);
  if (m) {
    return { key: 'Afterword SS', label: 'Ek Hikâye', defaultTitle: (m[1] || '').trim() || 'Ek Hikâye' };
  }

  // 5) Afterword / Author's Note / Author's Afterword (yalın başlık dahil)
  m = first.match(/^(?:Author[’']?s\s+(?:Afterword|Note)|Afterword)(?:\s*[:–—-]\s*(.*))?$/i);
  if (m) {
    return { key: 'Afterword', label: TR_CHAPTER.afterword, defaultTitle: (m[1] || '').trim() || 'Yazarın Sonsözü' };
  }

  // 6) Bookwalker özel ek hikâyeleri
  m = first.match(
    /^Bookwalker(?:\s+Exclusive\s+Bonus(?:\s*:\s*Side\s+Story)?|\s+SS|\s+Bonus)?(?:\s*[:–—-]\s*(.*))?$/i
  );
  if (m) {
    return { key: 'Bookwalker', label: 'Özel Ek', defaultTitle: (m[1] || '').trim() || 'Özel Ek Hikâye' };
  }

  // 7) Side Story / Short Story (iki nokta/tire olmadan veya tireli)
  m = first.match(/^(?:Side|Short)\s+Story(?:\s*[:–—-]\s*(.*))?$/i);
  if (m) {
    return { key: 'Side Story', label: 'Yan Hikâye', defaultTitle: (m[1] || '').trim() || 'Yan Hikâye' };
  }

  // 8) Anecdote
  m = first.match(/^Anecdote(?:\s*[:–—-]\s*(.*))?$/i);
  if (m) {
    return { key: 'Anecdote', label: TR_CHAPTER.anecdote, defaultTitle: (m[1] || '').trim() || 'Anekdot' };
  }

  // 9) Interlude
  m = first.match(/^Interlude(?:\s*[:–—-]\s*(.*))?$/i);
  if (m) {
    return { key: 'Interlude', label: TR_CHAPTER.interlude, defaultTitle: (m[1] || '').trim() || 'Ara Bölüm' };
  }

  return null;
}

function buildChapterNativeBook(opt, source, tr, titles) {
  const artPrefix = (opt.artPrefix || `art/v${String(opt.key || '').replace('.', '')}/`).replace(/^\/+/, '');
  const artDir = opt.artDir || path.join('public', artPrefix);
  const pages = [];
  const chapters = [];

  for (const p of source) {
    const key = String(p.page);
    const trParas = Array.isArray(tr[key]) ? tr[key].filter(Boolean) : [];
    const enParas = String(p.text || '')
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const imgFile = p.img ? String(p.img).replace(/^.*[/\\]/, '') : '';
    const hasArtFile = Boolean(imgFile && fs.existsSync(path.join(ROOT, artDir, imgFile)));
    const isArt = Boolean(p.art && hasArtFile);

    if (p.chapter && p.chapter.key) {
      const chKey = p.chapter.key;
      const chLabel = p.chapter.label || TR_CHAPTER[chKey.toLowerCase()] || chKey;
      const chTitle = titles[chKey] || p.chapter.titleTr || p.chapter.title || chLabel;
      chapters.push({
        page: p.page,
        label: chLabel,
        title: chTitle,
      });
    }

    pages.push({
      n: p.page,
      img: isArt ? artPrefix + imgFile : '',
      tr: trParas,
      en: enParas,
      art: isArt,
    });
  }

  if (chapters.length === 0 && pages.length > 0) {
    chapters.push({ page: 1, label: 'Bölüm 1', title: opt.volume || 'Bölüm 1' });
  }

  return {
    title: 'Alya Bazen Duygularını Rusça Saklar',
    volume: opt.volume || 'Cilt',
    total: pages.length,
    chapterNative: true,
    ongoing: Boolean(opt.ongoing),
    chapters,
    pages,
  };
}

function buildBook(opt = {}) {
  const dataDir = opt.dataDir || 'data';
  const volume = opt.volume || 'Cilt 4';
  const titlesFile = opt.titlesFile || path.join(ROOT, dataDir, 'chapters.json');
  const isChapterNative = opt.format === 'chapter-native';

  const source = JSON.parse(fs.readFileSync(path.join(ROOT, dataDir, 'source.json'), 'utf8'));
  const trFile = path.join(ROOT, dataDir, 'paragraphs_final.json');
  const tr = JSON.parse(fs.readFileSync(trFile, 'utf8'));

  let titles = {};
  try {
    titles = JSON.parse(fs.readFileSync(titlesFile, 'utf8'));
  } catch {}

  if (isChapterNative) {
    return buildChapterNativeBook(opt, source, tr, titles);
  }

  const scanPrefix = String(opt.scanPrefix || opt.imgPrefix || 'pages/').replace(/^\/+/, '');
  const artPrefix = String(opt.artPrefix || '').replace(/^\/+/, '');
  const artDir = opt.artDir || (artPrefix ? path.join('public', artPrefix) : '');
  const remoteBase = opt.remoteBase || '';

  const pages = source.map((p) => {
    const key = String(p.page);
    const trParas = Array.isArray(tr[key]) ? tr[key] : [];
    const enParas = String(p.text || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    // OCR'ı bozuk sayfaları (kapak, görsel sayfalar) metin saymayalım
    const words = String(p.text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const alpha = words.filter((w) => /[A-Za-zÇĞİÖŞÜçğıöşü]{3,}/.test(w)).length;
    const isSingleHeading = Boolean(enParas.length === 1 && matchPageHeading(enParas[0]));
    const usable = (words.length >= 6 && alpha / words.length >= 0.4) || isSingleHeading;

    // İllüstrasyon sayfaları: mevcut public/art altında doğrulanmış WebP varsa onu kullan
    const padded = String(p.page).padStart(3, '0') + '.webp';
    const hasVerifiedArt = Boolean(artDir && fs.existsSync(path.join(ROOT, artDir, padded)));
    const hasLocalScan = fs.existsSync(path.join(PUB, scanPrefix, padded));

    const cleanLen = String(p.text || '')
      .replace(/Page\s+\d+/gi, '')
      .replace(/Goldenagato.*$/gim, '')
      .replace(/\s+/g, ' ')
      .trim().length;
    const legacyArt = p.page > 3 && cleanLen < 220;
    const art = artDir ? hasVerifiedArt : legacyArt;

    let imgPath = scanPrefix + padded;
    if (hasVerifiedArt && artPrefix) {
      imgPath = artPrefix + padded;
    } else if (!hasLocalScan && remoteBase && p.img) {
      imgPath = remoteBase + p.img;
    }

    return {
      n: p.page,
      img: imgPath,
      scanImg: hasLocalScan ? scanPrefix + padded : remoteBase && p.img ? remoteBase + p.img : imgPath,
      tr: usable ? trParas.filter(Boolean) : [],
      en: usable ? enParas : [],
      art,
    };
  });

  // Bölümleri İngilizce başlıklardan bul (yalın Epilogue/Afterword/Side Story/Bookwalker/Anecdote/Interlude dahil)
  const chapters = [{ page: 1, label: 'Başlangıç', title: 'Kapak ve görseller' }];
  const seenKeys = new Map();

  for (const p of pages) {
    if (!p.en.length) continue;
    // Kitap içi İçindekiler (Table of Contents) sayfalarını atla
    const tocLines = p.en.filter((ln) => /^(?:Prologue|Epilogue|Chapter\s+\d+)\b/i.test(ln)).length;
    if (tocLines >= 3) continue;

    const hit = matchPageHeading(p.en[0], p.en[1] || '');
    if (!hit) continue;

    const count = (seenKeys.get(hit.key) || 0) + 1;
    seenKeys.set(hit.key, count);
    const lookupKey = count > 1 && titles[`${hit.key} ${count}`] ? `${hit.key} ${count}` : hit.key;
    const title = (titles[lookupKey] || hit.defaultTitle).slice(0, 80);
    chapters.push({ page: p.n, label: hit.label, title });
  }

  return {
    title: 'Alya Bazen Duygularını Rusça Saklar',
    volume,
    total: pages.length,
    chapterNative: false,
    ongoing: Boolean(opt.ongoing),
    chapters,
    pages,
  };
}

const VOLUME_ORDER = ['4', '4.5', '5', '6', '7', '8', '9', '9.5', '10', '11'];

const VOLUMES = Object.fromEntries(
  VOLUME_ORDER.map((k) => [k, ALL_VOLUME_SPECS[k]])
);

function getCatalog() {
  return VOLUME_ORDER.map((k) => {
    const v = VOLUMES[k];
    return {
      key: k,
      label: v.label || k,
      volume: v.volume,
      chapterNative: v.format === 'chapter-native',
      ongoing: Boolean(v.ongoing),
      file: `volumes/${k}.json`,
    };
  });
}

function packBook(key) {
  const b = buildBook(VOLUMES[key]);
  const json = Buffer.from(JSON.stringify(b));
  return { book: b, json, gzip: zlib.gzipSync(json) };
}

const BOOKS = {};
function getBook(key) {
  if (!BOOKS[key]) BOOKS[key] = packBook(key);
  return BOOKS[key];
}

function send(req, res, status, type, body, extra = {}) {
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', ...extra };
  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (acceptsGzip && body.length > 1024 && /json|text|javascript|css/.test(type)) {
    headers['Content-Encoding'] = 'gzip';
    body = zlib.gzipSync(body);
    headers['Vary'] = 'Accept-Encoding';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

const server = http.createServer((req, res) => {
  let pathname;
  let query;
  try {
    const u = new URL(req.url, 'http://localhost');
    pathname = decodeURIComponent(u.pathname);
    query = u.searchParams;
  } catch {
    return send(req, res, 400, MIME['.json'], Buffer.from('{"error":"bad request"}'));
  }

  // Bu roman için eğitilen MT motoru (mt/) ile tek cümle çevirisi
  if (pathname === '/api/mt') {
    const q = (query.get('q') || '').slice(0, 500).trim();
    if (!q) return send(req, res, 400, MIME['.json'], Buffer.from('{"error":"q gerekli"}'));
    try {
      const { translate } = require('./mt/translate');
      const out = translate(q);
      const body = Buffer.from(JSON.stringify({ q, out }));
      return send(req, res, 200, MIME['.json'], body);
    } catch (e) {
      const body = Buffer.from(JSON.stringify({ error: String(e.message || e) }));
      return send(req, res, 500, MIME['.json'], body);
    }
  }

  if (pathname === '/api/catalog') {
    const body = Buffer.from(JSON.stringify({ volumes: getCatalog() }));
    return send(req, res, 200, MIME['.json'], body);
  }

  const volJsonMatch = pathname.match(/^\/volumes\/([^/]+)\.json$/);
  if (pathname === '/api/book' || volJsonMatch) {
    const requested = volJsonMatch ? volJsonMatch[1] : query.get('v');
    const vKey = VOLUMES[requested] ? requested : '4';
    const loaded = getBook(vKey);
    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const body = acceptsGzip ? loaded.gzip : loaded.json;
    const headers = {
      'Content-Type': MIME['.json'],
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    };
    if (acceptsGzip) {
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
    }
    res.writeHead(200, headers);
    return res.end(req.method === 'HEAD' ? undefined : body);
  }

  if (pathname === '/') pathname = '/index.html';

  // dizin dışına çıkmayı engelle
  const filePath = path.join(PUB, path.normalize(pathname));
  if (!filePath.startsWith(PUB)) return send(req, res, 403, 'text/plain', Buffer.from('403'));

  fs.readFile(filePath, (err, data) => {
    if (err) return send(req, res, 404, 'text/plain; charset=utf-8', Buffer.from('Bulunamadı'));
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const cache =
      ext === '.webp' || ext === '.jpg' || ext === '.png'
        ? 'public, max-age=31536000, immutable'
        : 'no-cache';
    send(req, res, 200, type, data, { 'Cache-Control': cache });
  });
});

function start() {
  const b4 = getBook('4').book;
  server.listen(PORT, () => {
    console.log('Okuyucu hazır:  http://localhost:' + PORT);
    for (const k of Object.keys(VOLUMES)) {
      try {
        const b = k === '4' ? b4 : getBook(k).book;
        console.log(`${b.volume.padEnd(13)}:`, b.total, 'birim |', b.chapters.length, 'bölüm');
      } catch {
        console.log(`Cilt ${k.padEnd(8)}: henüz hazır değil`);
      }
    }
  });
}

if (require.main === module) start();

module.exports = { VOLUME_ORDER, VOLUMES, getCatalog, matchPageHeading, buildBook, getBook, start };
