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
  const id = String(opt.id || '4');
  const dataDir = opt.dataDir || 'data';
  const imgPrefix = opt.imgPrefix || '/pages/';
  const volume = opt.volume || opt.label || 'Cilt ' + id;
  const subtitle = opt.subtitle || '';
  const status = opt.status || 'complete';
  const statusNote = opt.statusNote || '';
  const titlesFile =
    opt.titlesFile ||
    (opt.chaptersFile ? path.join(ROOT, opt.chaptersFile) : path.join(ROOT, dataDir, 'chapters.json'));

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

    // görsel (illüstrasyon) sayfaları: kaynak metni çok kısa olan sayfalar
    const cleanLen = String(p.text || '')
      .replace(/Page\s+\d+/gi, '')
      .replace(/Goldenagato.*$/gim, '')
      .replace(/\s+/g, ' ')
      .trim().length;
    const art = p.page > 3 && cleanLen < 220;

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
    const m = first.match(/^(Prologue|Epilogue|Chapter\s+(\d+))\s*[:–—-]/i);
    if (!m) continue;
    const isNum = !!m[2];
    const key = isNum ? 'Chapter ' + m[2] : m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    const label = isNum ? 'Bölüm ' + m[2] : TR_CHAPTER[m[1].toLowerCase()] || m[1];
    const rest = first.slice(m[0].length).replace(/^[\s:–—-]+/, '');
    const title = titles[key] || rest.slice(0, 70);
    chapters.push({ page: p.n, label, title });
  }

  return {
    id,
    title: 'Alya Bazen Duygularını Rusça Saklar',
    volume,
    subtitle,
    status,
    statusNote,
    total: pages.length,
    chapters,
    pages,
  };
}

function loadVolumes() {
  const manifestPath = path.join(ROOT, 'data', 'volumes.json');
  const entries = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const map = {};
  for (const entry of entries) {
    if (!entry.enabled) continue;
    map[String(entry.id)] = {
      ...entry,
      id: String(entry.id),
      volume: entry.label,
      titlesFile: path.join(ROOT, entry.chaptersFile),
    };
  }
  return map;
}

const VOLUMES = loadVolumes();

function packBook(cfg) {
  const b = buildBook(cfg);
  const json = Buffer.from(JSON.stringify(b));
  return { book: b, json, gzip: zlib.gzipSync(json) };
}

const BOOKS = {};
function getBook(key, volMap = VOLUMES) {
  const cfg = volMap[key];
  if (!cfg) throw new Error('Bilinmeyen cilt: ' + key);
  if (!BOOKS[key]) BOOKS[key] = packBook(cfg);
  return BOOKS[key];
}

function buildVolumesSummary() {
  const active = loadVolumes();
  return Object.values(active).map((cfg) => {
    let total = 0;
    let chapterCount = 0;
    try {
      const b = getBook(cfg.id, active).book;
      total = b.total;
      chapterCount = b.chapters.length;
    } catch {}
    return {
      id: cfg.id,
      label: cfg.label,
      subtitle: cfg.subtitle || '',
      imgPrefix: cfg.imgPrefix,
      status: cfg.status || 'complete',
      statusNote: cfg.statusNote || '',
      total,
      chapterCount,
    };
  });
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

  if (pathname === '/api/volumes') {
    const body = Buffer.from(JSON.stringify(buildVolumesSummary()));
    return send(req, res, 200, MIME['.json'], body);
  }

  if (pathname === '/api/book') {
    const active = loadVolumes();
    const keys = Object.keys(active);
    const reqVol = query.get('v');
    const vKey = reqVol && active[reqVol] ? reqVol : keys[0];
    if (!vKey) {
      return send(req, res, 404, MIME['.json'], Buffer.from('{"error":"etkin cilt yok"}'));
    }
    let loaded;
    try {
      loaded = getBook(vKey, active);
    } catch {
      const msg = JSON.stringify({ error: 'Cilt verisi henüz hazır değil: ' + vKey });
      return send(req, res, 404, MIME['.json'], Buffer.from(msg));
    }
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
    const active = loadVolumes();
    console.log('Okuyucu hazır:  http://localhost:' + PORT);
    for (const [id, cfg] of Object.entries(active)) {
      try {
        const b = getBook(id, active).book;
        const noteSuffix = b.statusNote ? ' — ' + b.statusNote : '';
        console.log(
          `${b.volume.padEnd(13)}: [#${b.id}] ${b.total} sayfa | ${b.chapters.length} bölüm (${b.status}${noteSuffix})`
        );
      } catch {
        console.log(`${cfg.label.padEnd(13)}: [#${id}] henüz hazır değil (${cfg.status || 'complete'})`);
      }
    }
    const trFiles = Object.values(active)
      .map((v) => `${v.dataDir}/paragraphs_final.json`)
      .join(', ');
    console.log('Çeviri       : DeepL + Google (' + trFiles + ')');
  });
}

if (require.main === module) start();

module.exports = { buildBook, getBook, loadVolumes, buildVolumesSummary, server, start };
