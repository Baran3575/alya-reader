// Bağımlılıksız basit sunucu — http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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
  afterword: 'Sonsöz',
  'author’s note': 'Yazarın Notu',
  "author's note": 'Yazarın Notu',
  'bookwalker ss': 'Ek Öykü',
  'afterword ss': 'Ek Öykü',
};

function matchChapterHeading(first) {
  const m = first.match(
    /^(Prologue|Epilogue|Afterword\s+SS|Afterword|Bookwalker\s+SS|Author[’']s\s+Note|Chapter\s+(\d+))(?:\s*[:–—-]\s*(.*)|\s*$)/i
  );
  if (!m) return null;
  if (m[2]) {
    return {
      key: 'Chapter ' + m[2],
      label: 'Bölüm ' + m[2],
      rest: (m[3] || '').trim(),
    };
  }
  const raw = m[1].replace(/\s+/g, ' ').trim();
  const low = raw.toLowerCase();
  let key = raw;
  if (low === 'prologue') key = 'Prologue';
  else if (low === 'epilogue') key = 'Epilogue';
  else if (low === 'afterword') key = 'Afterword';
  else if (low === 'afterword ss') key = 'Afterword SS';
  else if (low === 'bookwalker ss') key = 'Bookwalker SS';
  else if (low === "author's note" || low === 'author’s note') key = 'Author’s Note';
  const label = TR_CHAPTER[low] || raw;
  return { key, label, rest: (m[3] || '').trim() };
}

function buildBook(opt = {}) {
  const dataDir = opt.dataDir || 'data';
  const imgPrefix = opt.imgPrefix || '/pages/';
  const volume = opt.volume || 'Cilt 4';
  const titlesFile = opt.titlesFile || path.join(ROOT, 'data/chapters.json');

  const source = JSON.parse(fs.readFileSync(path.join(ROOT, dataDir, 'source.json'), 'utf8'));
  const trFile = path.join(ROOT, dataDir, 'paragraphs_final.json');
  const tr = JSON.parse(fs.readFileSync(trFile, 'utf8'));

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
    const usable = words.length >= 6 && alpha / words.length >= 0.4;

    // görsel (illüstrasyon) sayfaları: kaynak metni çok kısa olan sayfalar (kısa dipnot/jenerik sayfaları hariç)
    const cleanText = String(p.text || '')
      .replace(/Page\s+\d+/gi, '')
      .replace(/Goldenagato.*$/gim, '')
      .replace(/\s+/g, ' ')
      .trim();
    const cleanLen = cleanText.length;
    const isNoteOnly =
      cleanLen > 0 && /^(?:\[\d+\]\s*:|P\.\s*S\.|Fan-translated by\b)/i.test(cleanText);
    const art = p.page > 3 && cleanLen < 220 && !isNoteOnly;

    return {
      n: p.page,
      img: imgPrefix + String(p.page).padStart(3, '0') + '.webp',
      tr: usable ? trParas.filter(Boolean) : [],
      en: usable ? enParas : [],
      art,
    };
  });

  // bölümleri ingilizce başlıklardan bul, Türkçe adları chapters.json'dan al
  let titles = {};
  try {
    titles = JSON.parse(fs.readFileSync(titlesFile, 'utf8'));
  } catch {}
  const chapters = [{ page: 1, label: 'Başlangıç', title: 'Kapak ve görseller' }];
  for (const p of pages) {
    const first = (p.en[0] || '').replace(/\s+/g, ' ');
    const hit = matchChapterHeading(first);
    if (!hit) continue;
    const title = titles[hit.key] || hit.rest.slice(0, 70) || hit.label;
    chapters.push({ page: p.n, label: hit.label, title });
  }

  return { title: 'Alya Bazen Duygularını Rusça Saklar', volume, total: pages.length, chapters, pages };
}

const VOLUME_ORDER = ['4', '4.5', '5', '6'];

const VOLUMES = {
  '4': { dataDir: 'data', imgPrefix: '/pages/', volume: 'Cilt 4', titlesFile: path.join(ROOT, 'data/chapters.json') },
  '4.5': { dataDir: 'data45', imgPrefix: '/pages45/', volume: 'Cilt 4.5', titlesFile: path.join(ROOT, 'data45/chapters.json') },
  '5': { dataDir: 'data5', imgPrefix: '/pages5/', volume: 'Cilt 5', titlesFile: path.join(ROOT, 'data5/chapters.json') },
  '6': { dataDir: 'data6', imgPrefix: '/pages6/', volume: 'Cilt 6', titlesFile: path.join(ROOT, 'data6/chapters.json') },
};

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

const book = getBook('4').book;

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

  if (pathname === '/api/book') {
    const vKey = VOLUMES[query.get('v')] ? query.get('v') : '4';
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
    const cache = ext === '.webp' || ext === '.jpg' || ext === '.png'
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    send(req, res, 200, type, data, { 'Cache-Control': cache });
  });
});

function start() {
  server.listen(PORT, () => {
    console.log('Okuyucu hazır:  http://localhost:' + PORT);
    for (const k of VOLUME_ORDER) {
      try {
        const b = getBook(k).book;
        console.log(b.volume.padEnd(13) + ':', b.total, 'sayfa |', b.chapters.length, 'bölüm');
      } catch {
        console.log(('Cilt ' + k).padEnd(13) + ': henüz hazır değil');
      }
    }
    console.log('Çeviri       : data/, data45/, data5/, data6/ (paragraphs_final.json)');
  });
}

if (require.main === module) start();

module.exports = { buildBook, getBook, start, VOLUMES, VOLUME_ORDER };
