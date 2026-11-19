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

const TR_CHAPTER = { prologue: 'Önsöz', epilogue: 'Sonsöz' };

function buildBook(opt = {}) {
  const dataDir = opt.dataDir || 'data';
  const volKey = String(opt.volKey || (/45$/.test(dataDir) ? '4.5' : '4'));
  const relImgPrefix = String(opt.imgPrefix || 'pages/').replace(/^\/+/, '');
  const artRelDir = String(opt.artPrefix || 'bundles/art/' + volKey + '/').replace(/^\/+/, '');
  const volume = opt.volume || 'Cilt 4';
  const titlesFile = opt.titlesFile || path.join(ROOT, 'data/chapters.json');
  const fullScans = fs.existsSync(path.join(PUB, relImgPrefix, '001.webp'));

  const source = JSON.parse(fs.readFileSync(path.join(ROOT, dataDir, 'source.json'), 'utf8'));
  const trFile = path.join(ROOT, dataDir, 'paragraphs_final.json');
  const tr = JSON.parse(fs.readFileSync(trFile, 'utf8'));

  const pages = source.map((p) => {
    const key = String(p.page);
    const nnn = String(p.page).padStart(3, '0');
    const trParas = Array.isArray(tr[key]) ? tr[key] : [];
    const enParas = String(p.text || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    // OCR'ı bozuk sayfaları (kapak, görsel sayfalar) metin saymayalım
    const words = String(p.text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const alpha = words.filter((w) => /[A-Za-zÇĞİÖŞÜçğıöşü]{3,}/.test(w)).length;
    const usable = words.length >= 6 && alpha / words.length >= 0.4;

    // görsel (illüstrasyon) sayfaları: kaynak metni çok kısa olan sayfalar
    const cleanLen = String(p.text || '')
      .replace(/Page\s+\d+/gi, '')
      .replace(/Goldenagato.*$/gim, '')
      .replace(/\s+/g, ' ')
      .trim().length;
    const art = p.page > 3 && cleanLen < 220;
    const artFile = path.join(PUB, artRelDir, nnn + '.webp');
    const img = art && fs.existsSync(artFile) ? artRelDir + nnn + '.webp' : relImgPrefix + nnn + '.webp';

    return {
      n: p.page,
      img,
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
    const m = first.match(/^(Prologue|Epilogue|Chapter\s+(\d+))\s*[:–—-]/i);
    if (!m) continue;
    const isNum = !!m[2];
    const key = isNum ? 'Chapter ' + m[2] : m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    const label = isNum ? 'Bölüm ' + m[2] : TR_CHAPTER[m[1].toLowerCase()] || m[1];
    const rest = first.slice(m[0].length).replace(/^[\s:–—-]+/, '');
    const title = titles[key] || rest.slice(0, 70);
    chapters.push({ page: p.n, label, title });
  }

  for (const p of pages) {
    delete p.en;
  }

  return { title: 'Alya Bazen Duygularını Rusça Saklar', volume, total: pages.length, fullScans, chapters, pages };
}

const VOLUMES = {
  '4': {
    volKey: '4',
    dataDir: 'data',
    imgPrefix: 'pages/',
    artPrefix: 'bundles/art/4/',
    volume: 'Cilt 4',
    titlesFile: path.join(ROOT, 'data/chapters.json'),
  },
  '4.5': {
    volKey: '4.5',
    dataDir: 'data45',
    imgPrefix: 'pages45/',
    artPrefix: 'bundles/art/4.5/',
    volume: 'Cilt 4.5',
    titlesFile: path.join(ROOT, 'data45/chapters.json'),
  },
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
    const isImmutableImg = ext === '.webp' || ext === '.jpg' || ext === '.png';
    const isVersionedChunk = pathname.startsWith('/bundles/book-') && Boolean(query.get('v'));
    const cache = isImmutableImg || isVersionedChunk
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    send(req, res, 200, type, data, { 'Cache-Control': cache });
  });
});

function start() {
server.listen(PORT, () => {
  console.log('Okuyucu hazır:  http://localhost:' + PORT);
  console.log('Cilt 4       :', book.total, 'sayfa |', book.chapters.length, 'bölüm');
  try {
    const b45 = getBook('4.5').book;
    console.log('Cilt 4.5     :', b45.total, 'sayfa |', b45.chapters.length, 'bölüm');
  } catch {
    console.log('Cilt 4.5     : henüz hazır değil');
  }
  console.log('Çeviri       : DeepL + Google (data/paragraphs_final.json, data45/paragraphs_final.json)');
});
}

if (require.main === module) start();

module.exports = { buildBook, getBook, start, VOLUMES };
