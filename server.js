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
  interlude: 'Ara Bölüm',
};

const VOLUME_KEYS = ['4', '4.5', '5', '6', '7', '8', '9', '9.5', '10', '11', '12'];

function inferVolKey(dataDir) {
  if (!dataDir || dataDir === 'data') return '4';
  if (dataDir === 'data45') return '4.5';
  if (dataDir === 'data95') return '9.5';
  return String(dataDir).replace(/^data/, '');
}

const VOLUMES = Object.fromEntries(
  VOLUME_KEYS.map((k) => {
    if (k === '4') {
      return [
        '4',
        {
          key: '4',
          volKey: '4',
          dataDir: 'data',
          imgPrefix: 'pages/',
          artPrefix: 'bundles/art/4/',
          volume: 'Cilt 4',
          titlesFile: path.join(ROOT, 'data/chapters.json'),
        },
      ];
    }
    const suffix = k.replace('.', '');
    const relPrefix = `pages${suffix}/`;
    return [
      k,
      {
        key: k,
        volKey: k,
        dataDir: `data${suffix}`,
        imgPrefix: relPrefix,
        artPrefix: k === '4.5' ? 'bundles/art/4.5/' : relPrefix,
        volume: `Cilt ${k}`,
        titlesFile: path.join(ROOT, `data${suffix}/chapters.json`),
      },
    ];
  })
);

function buildBook(opt = {}) {
  const dataDir = opt.dataDir || 'data';
  const volKey = String(opt.volKey || opt.key || inferVolKey(dataDir));
  const defaultPrefix = volKey === '4' ? 'pages/' : `pages${volKey.replace('.', '')}/`;
  const relImgPrefix = String(opt.imgPrefix || defaultPrefix).replace(/^\/+/, '');
  const defaultArtPrefix =
    volKey === '4' || volKey === '4.5' ? `bundles/art/${volKey}/` : relImgPrefix;
  const artRelDir = String(opt.artPrefix || defaultArtPrefix).replace(/^\/+/, '');
  const volume = opt.volume || `Cilt ${volKey}`;
  const titlesFile = opt.titlesFile || path.join(ROOT, dataDir, 'chapters.json');

  const source = JSON.parse(fs.readFileSync(path.join(ROOT, dataDir, 'source.json'), 'utf8'));
  const trFile = path.join(ROOT, dataDir, 'paragraphs_final.json');
  const tr = JSON.parse(fs.readFileSync(trFile, 'utf8'));

  let titlesMeta = {};
  try {
    titlesMeta = JSON.parse(fs.readFileSync(titlesFile, 'utf8'));
  } catch {}

  const hasStructuredChapters = Array.isArray(titlesMeta.chapters) && titlesMeta.chapters.length > 0;
  const fullScans = !hasStructuredChapters && fs.existsSync(path.join(PUB, relImgPrefix, '001.webp'));

  const pages = source.map((p) => {
    const key = String(p.page);
    const nnn = String(p.page).padStart(3, '0');
    const isPending = Boolean(p.pending);
    const trParas = Array.isArray(tr[key]) ? tr[key].filter(Boolean) : [];
    const enParas = String(p.text || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    if (hasStructuredChapters) {
      const relImg = relImgPrefix + nnn + '.webp';
      const hasDiskImg = fs.existsSync(path.join(PUB, relImg));
      const cleanLen = String(p.text || '').replace(/\s+/g, ' ').trim().length;
      const art = !isPending && hasDiskImg && (cleanLen < 220 || trParas.length === 0);
      const item = {
        n: p.page,
        img: relImg,
        tr: isPending ? [] : trParas,
        en: isPending ? [] : enParas,
        art,
      };
      if (isPending) item.pending = true;
      return item;
    }

    // Cilt 4 / Cilt 4.5 davranışı
    const words = String(p.text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const alpha = words.filter((w) => /[A-Za-zÇĞİÖŞÜçğıöşü]{3,}/.test(w)).length;
    const usable = words.length >= 6 && alpha / words.length >= 0.4;

    const cleanLen = String(p.text || '')
      .replace(/Page\s+\d+/gi, '')
      .replace(/Goldenagato.*$/gim, '')
      .replace(/\s+/g, ' ')
      .trim().length;
    const artFile = path.join(PUB, artRelDir, nnn + '.webp');
    const scanFile = path.join(PUB, relImgPrefix, nnn + '.webp');
    const hasArtImg = fs.existsSync(artFile) || fs.existsSync(scanFile);
    const art = p.page > 3 && cleanLen < 220 && hasArtImg;
    const img = art && fs.existsSync(artFile) ? artRelDir + nnn + '.webp' : relImgPrefix + nnn + '.webp';

    return {
      n: p.page,
      img,
      tr: usable ? trParas : [],
      en: usable ? enParas : [],
      art,
    };
  });

  let chapters = [];
  if (hasStructuredChapters) {
    chapters = titlesMeta.chapters.map((c) => {
      const entry = {
        page: c.startPage || c.page || 1,
        label: c.label || 'Bölüm',
        title: c.title || c.enTitle || '',
      };
      if (c.pending) {
        entry.pending = true;
        entry.statusNote = c.statusNote || 'Kaynak çeviri henüz tamamlanmadı ([Translation In Progress]).';
      }
      return entry;
    });
    if (chapters.length === 0 || chapters[0].page > 1) {
      chapters.unshift({ page: 1, label: 'Başlangıç', title: 'Kapak ve görseller' });
    }
  } else {
    chapters = [{ page: 1, label: 'Başlangıç', title: 'Kapak ve görseller' }];
    for (const p of pages) {
      const first = (p.en[0] || '').replace(/\s+/g, ' ');
      const m = first.match(/^(Prologue|Epilogue|Afterword|Interlude|Chapter\s+(\d+))\s*[:–—-]/i);
      if (!m) continue;
      const isNum = !!m[2];
      const key = isNum ? 'Chapter ' + m[2] : m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
      const label = isNum ? 'Bölüm ' + m[2] : TR_CHAPTER[m[1].toLowerCase()] || m[1];
      const rest = first.slice(m[0].length).replace(/^[\s:–—-]+/, '');
      const title = titlesMeta[key] || rest.slice(0, 70);
      chapters.push({ page: p.n, label, title });
    }
  }

  if (!opt.includeEn) {
    for (const p of pages) {
      delete p.en;
    }
  }

  return { title: 'Alya Bazen Duygularını Rusça Saklar', volume, total: pages.length, fullScans, chapters, pages };
}

function buildBookEn(opt = {}) {
  const full = buildBook({ ...opt, includeEn: true });
  const pages = {};
  for (const p of full.pages) {
    if (Array.isArray(p.en) && p.en.length > 0) {
      pages[String(p.n)] = p.en;
    }
  }
  return { volume: full.volume, total: full.total, pages };
}

function packPayload(obj) {
  const json = Buffer.from(JSON.stringify(obj));
  return { data: obj, json, gzip: zlib.gzipSync(json) };
}

const BOOKS = {};
function getBook(key) {
  const k = VOLUMES[key] ? key : '4';
  if (!BOOKS[k]) {
    const packed = packPayload(buildBook(VOLUMES[k]));
    BOOKS[k] = { book: packed.data, json: packed.json, gzip: packed.gzip };
  }
  return BOOKS[k];
}

const BOOKS_EN = {};
function getBookEn(key) {
  const k = VOLUMES[key] ? key : '4';
  if (!BOOKS_EN[k]) {
    const packed = packPayload(buildBookEn(VOLUMES[k]));
    BOOKS_EN[k] = { bookEn: packed.data, json: packed.json, gzip: packed.gzip };
  }
  return BOOKS_EN[k];
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

  if (pathname === '/api/book' || pathname === '/api/book-en') {
    const vKey = VOLUMES[query.get('v')] ? query.get('v') : '4';
    try {
      const loaded = pathname === '/api/book-en' ? getBookEn(vKey) : getBook(vKey);
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
    } catch (e) {
      return send(
        req,
        res,
        404,
        MIME['.json'],
        Buffer.from(JSON.stringify({ error: `Cilt ${vKey} henüz hazır değil: ${e.message}` }))
      );
    }
  }

  // Statik JSON uç noktası (/books/<v>.json) isteğini de destekle
  const bookJsonMatch = pathname.match(/^\/books\/([0-9.]+)\.json$/);
  if (bookJsonMatch && VOLUMES[bookJsonMatch[1]]) {
    try {
      const loaded = getBook(bookJsonMatch[1]);
      return send(req, res, 200, MIME['.json'], loaded.json);
    } catch {}
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
    const isVersionedChunk =
      (pathname.startsWith('/bundles/book-') || pathname.startsWith('/bundles/bundle-en-')) &&
      Boolean(query.get('v'));
    const cache = isImmutableImg || isVersionedChunk
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    send(req, res, 200, type, data, { 'Cache-Control': cache });
  });
});

function start() {
  server.listen(PORT, () => {
    console.log('Okuyucu hazır:  http://localhost:' + PORT);
    for (const k of VOLUME_KEYS) {
      const label = ('Cilt ' + k).padEnd(13);
      try {
        const b = getBook(k).book;
        console.log(`${label}: ${b.total} sayfa | ${b.chapters.length} bölüm`);
      } catch {
        console.log(`${label}: henüz hazır değil`);
      }
    }
  });
}

if (require.main === module) start();

module.exports = { VOLUMES, VOLUME_KEYS, buildBook, buildBookEn, getBook, getBookEn, start };
