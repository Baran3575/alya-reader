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
  'author’s note': 'Yazarın Notu',
  "author's note": 'Yazarın Notu',
  'bookwalker ss': 'Ek Hikâye',
  'afterword ss': 'Ek Hikâye',
};

const VOLUME_KEYS = ['4', '4.5', '5', '6', '7', '8', '9', '9.5', '10', '11', '12'];

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
      },
    ];
  })
);

function matchChapterHeading(first) {
  const m = first.match(
    /^(Prologue|Epilogue|Afterword\s+SS|Afterword|Bookwalker\s+SS|Author[’']s\s+Note|Interlude|Chapter\s+(\d+))(?:\s*[:–—-]\s*(.*)|\s*$)/i
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
  else if (low === 'interlude') key = 'Interlude';
  else if (low === "author's note" || low === 'author’s note') key = 'Author’s Note';
  const label = TR_CHAPTER[low] || raw;
  return { key, label, rest: (m[3] || '').trim() };
}

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
      const item = {
        n: p.page,
        img: imgUrl,
        tr: isPending ? [] : trParas,
        en: isPending ? [] : enParas,
        art,
        hasImg: hasDiskImg,
      };
      if (isPending) item.pending = true;
      return item;
    }

    // Geriye dönük Cilt 4 / Cilt 4.5 davranışı
    const words = String(p.text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const alpha = words.filter((w) => /[A-Za-zÇĞİÖŞÜçğıöşü]{3,}/.test(w)).length;
    const usable = words.length >= 6 && alpha / words.length >= 0.4;

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
      img: imgUrl,
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
      const hit = matchChapterHeading(first);
      if (!hit) continue;
      if (hit.rest || titlesMeta[hit.key]) {
        const title = titlesMeta[hit.key] || hit.rest.slice(0, 70) || hit.label;
        chapters.push({ page: p.n, label: hit.label, title });
      }
    }
  }

  return { title: 'Alya Bazen Duygularını Rusça Saklar', volume, total: pages.length, chapters, pages };
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

  // Statik cilt dizini manifesti (/books/index.json)
  if (pathname === '/books/index.json') {
    const volumes = [];
    for (const k of VOLUME_KEYS) {
      try {
        const b = getBook(k).book;
        volumes.push({
          id: k,
          short: k,
          label: b.volume,
          total: b.total,
          chapters: b.chapters.length,
          hasPending: b.chapters.some((c) => c.pending),
          file: `books/${k}.json`,
        });
      } catch {}
    }
    const body = Buffer.from(JSON.stringify({ version: 'dev', volumes }));
    return send(req, res, 200, MIME['.json'], body);
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

module.exports = { VOLUMES, VOLUME_KEYS, VOLUME_ORDER: VOLUME_KEYS, buildBook, getBook, start };
