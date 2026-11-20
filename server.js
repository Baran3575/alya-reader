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

// Cilt başına kaynak listesi (tek doğru kaynak: data/sources.json)
const SOURCES = require(path.join(ROOT, 'data', 'sources.json'));
const sourcesOf = (k) => (Array.isArray(SOURCES[k]) ? SOURCES[k] : []);
const flipOf = (k) => {
  const s = sourcesOf(k).find((x) => x.embed);
  return s ? s.url : null;
};
const sourceOf = (k) => (sourcesOf(k)[0] ? sourcesOf(k)[0].url : null);

const VOLUMES = Object.fromEntries(
  VOLUME_KEYS.map((k) => {
    if (k === '4') {
      return [
        '4',
        {
          key: '4',
          dataDir: 'data',
          imgPrefix: '/pages/',
          volume: 'Cilt 4',
          titlesFile: path.join(ROOT, 'data/chapters.json'),
          flip: flipOf('4'),
          source: sourceOf('4'),
          sources: sourcesOf('4'),
        },
      ];
    }
    const suffix = k.replace('.', '');
    return [
      k,
      {
        key: k,
        dataDir: `data${suffix}`,
        imgPrefix: `/pages${suffix}/`,
        volume: `Cilt ${k}`,
        titlesFile: path.join(ROOT, `data${suffix}/chapters.json`),
        flip: flipOf(k),
        source: sourceOf(k),
        sources: sourcesOf(k),
      },
    ];
  })
);

function buildBook(opt = {}) {
  const dataDir = opt.dataDir || 'data';
  const imgPrefix = opt.imgPrefix || '/pages/';
  const volume = opt.volume || 'Cilt 4';
  const titlesFile = opt.titlesFile || path.join(ROOT, dataDir, 'chapters.json');

  const source = JSON.parse(fs.readFileSync(path.join(ROOT, dataDir, 'source.json'), 'utf8'));
  const trFile = path.join(ROOT, dataDir, 'paragraphs_final.json');
  const tr = JSON.parse(fs.readFileSync(trFile, 'utf8'));

  let titlesMeta = {};
  try {
    titlesMeta = JSON.parse(fs.readFileSync(titlesFile, 'utf8'));
  } catch {}

  const hasStructuredChapters = Array.isArray(titlesMeta.chapters) && titlesMeta.chapters.length > 0;

  // PDF/tarama sayfa eşlemesi (varsa): data<X>/scan_map.json -> { map: [pdfSayfa...], dir: 'scan' }
  let scanMap = null;
  try {
    scanMap = JSON.parse(fs.readFileSync(path.join(ROOT, dataDir, 'scan_map.json'), 'utf8'));
  } catch {}

  const pages = source.map((p) => {
    const key = String(p.page);
    const isPending = Boolean(p.pending);
    const trParas = Array.isArray(tr[key]) ? tr[key].filter(Boolean) : [];
    const enParas = String(p.text || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const fileName = String(p.page).padStart(3, '0') + '.webp';
    const imgUrl = imgPrefix + fileName;

    if (hasStructuredChapters) {
      const relDiskPath = path.join(PUB, imgUrl.replace(/^\/+/, ''));
      const hasDiskImg = fs.existsSync(relDiskPath);
      const cleanLen = String(p.text || '').replace(/\s+/g, ' ').trim().length;
      const art = !isPending && hasDiskImg && (cleanLen < 220 || trParas.length === 0);
      const scanN = scanMap && Array.isArray(scanMap.map) ? scanMap.map[p.page - 1] || null : null;
      const scanImg = scanN
        ? imgPrefix.replace(/\/$/, '') + '/' + (scanMap.dir || 'scan') + '/' + String(scanN).padStart(3, '0') + '.webp'
        : null;
      const item = {
        n: p.page,
        img: hasDiskImg ? imgUrl : null,
        tr: isPending ? [] : trParas,
        en: isPending ? [] : enParas,
        art,
        hasImg: hasDiskImg,
      };
      if (scanImg) {
        const hasScanFile = fs.existsSync(path.join(PUB, scanImg.replace(/^\/+/, '')));
        if (hasScanFile) {
          item.scanN = scanN;
          item.scan = scanImg;
          item.hasImg = true;
        }
      }
      if (isPending) item.pending = true;
      return item;
    }

    // Geriye dönük Cilt 4 / Cilt 4.5 davranışı
    const words = String(p.text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const alpha = words.filter((w) => /[A-Za-zÇĞİÖŞÜçğıöşü]{3,}/.test(w)).length;
    const usable = words.length >= 6 && alpha / words.length >= 0.4;

    const cleanLen = String(p.text || '')
      .replace(/Page\s+\d+/gi, '')
      .replace(/Goldenagato.*$/gim, '')
      .replace(/\s+/g, ' ')
      .trim().length;
    const art = p.page > 3 && cleanLen < 220;

    const scanN2 = scanMap && Array.isArray(scanMap.map) ? scanMap.map[p.page - 1] || null : null;
    const scanImg2 = scanN2
      ? imgPrefix.replace(/\/$/, '') + '/' + (scanMap.dir || 'scan') + '/' + String(scanN2).padStart(3, '0') + '.webp'
      : null;
    const hasScanFile = scanImg2 ? fs.existsSync(path.join(PUB, scanImg2.replace(/^\/+/, ''))) : false;

    return {
      n: p.page,
      img: hasScanFile || fs.existsSync(path.join(PUB, imgUrl.replace(/^\/+/, ''))) ? imgUrl : null,
      tr: usable ? trParas : [],
      en: usable ? enParas : [],
      art,
      hasImg: hasScanFile || fs.existsSync(path.join(PUB, imgUrl.replace(/^\/+/, ''))),
      ...(scanImg2 && hasScanFile ? { scanN: scanN2, scan: scanImg2 } : {}),
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

  // Bu ciltte sayfa taraması var mı? (sayfaların en az yarısı diskte ise "taranmış" sayılır;
  // tek tek eksik sayfalar arayüzde kart olarak gösterilir)
  const imgCount = pages.filter((p) => p.hasImg).length;
  const scan = pages.length > 0 && imgCount * 2 >= pages.length;
  const flip = opt.flip || null;
  const sourceUrl = opt.source || null;
  const sources = Array.isArray(opt.sources) ? opt.sources : [];

  return {
    title: 'Alya Bazen Duygularını Rusça Saklar',
    volume,
    total: pages.length,
    chapters,
    pages,
    scan,
    flip,
    source: sourceUrl,
    sources,
  };
}

function packBook(key) {
  const b = buildBook(VOLUMES[key]);
  const json = Buffer.from(JSON.stringify(b));
  return { book: b, json, gzip: zlib.gzipSync(json) };
}

const BOOKS = {};
function getBook(key) {
  const k = VOLUMES[key] ? key : '4';
  if (!BOOKS[k]) BOOKS[k] = packBook(k);
  return BOOKS[k];
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

  if (pathname === '/api/book') {
    const vKey = VOLUMES[query.get('v')] ? query.get('v') : '4';
    try {
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
  const bookJsonMatch = pathname.match(/^\/books\/v?([0-9.]+)\.json$/);
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
    const cache = ext === '.webp' || ext === '.jpg' || ext === '.png'
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

module.exports = { VOLUMES, VOLUME_KEYS, buildBook, getBook, start };
