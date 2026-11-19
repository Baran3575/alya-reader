// Bağımlılıksız basit sunucu — http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {
  loadManifest,
  getVolume,
  getVolumeList,
  getVolumeIds,
  getActiveVolumeList,
  getActiveVolumes,
} = require('./scripts/volumes');

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
  'side story': 'Ek Hikâye',
  'bonus ss': 'Ek Hikâye',
  anecdote: 'Ek Hikâye',
  interlude: 'Ara Bölüm',
};

const CANON_HEADING = {
  prologue: 'Prologue',
  epilogue: 'Epilogue',
  afterword: 'Afterword',
  'side story': 'Side Story',
  'bonus ss': 'Bonus SS',
  anecdote: 'Anecdote',
  interlude: 'Interlude',
};

const HEADING_RE =
  /^(Prologue|Epilogue|Afterword|Side\s+Story|Bonus\s+SS|Anecdote|Interlude|Chapter\s+(\d+))(?:\s+(\d+))?(?:(\s*[:–—-]\s*)(.*)|\s+(.*))?$/i;

function parseHeading(line) {
  const first = String(line || '').replace(/\s+/g, ' ').trim();
  if (!first) return null;
  const m = first.match(HEADING_RE);
  if (!m) return null;

  const hasPunct = Boolean(m[4]);
  const rawRest = (m[5] !== undefined ? m[5] : m[6] || '').replace(/^[\s:–—-]+/, '').trim();
  if (!hasPunct && rawRest.length > 75) return null;

  if (m[2]) {
    const chNum = m[2];
    return {
      key: 'Chapter ' + chNum,
      fallbackKey: null,
      label: 'Bölüm ' + chNum,
      rest: rawRest,
    };
  }

  const normKind = m[1].toLowerCase().replace(/\s+/g, ' ');
  const canon = CANON_HEADING[normKind] || m[1];
  const label = TR_CHAPTER[normKind] || m[1];
  const subNum = m[3] || null;
  return {
    key: subNum ? `${canon} ${subNum}` : canon,
    fallbackKey: canon,
    label,
    subNum,
    rest: rawRest,
  };
}

function buildBook(opt = {}) {
  const rootDir = opt.rootDir || ROOT;
  const cfg = opt.id
    ? getVolume(opt.id, rootDir)
    : opt.dataDir
      ? getVolumeList(rootDir).find((v) => v.dataDir === opt.dataDir) || null
      : getVolume('4', rootDir);
  const dataDir = opt.dataDir || (cfg ? cfg.dataDir : 'data');
  const slug = opt.slug || (cfg ? cfg.slug : dataDir === 'data' ? '4' : dataDir.replace(/^data/, ''));
  const imgPrefix = opt.imgPrefix || (cfg ? cfg.imgPrefix : '/pages/');
  const volume = opt.volume || (cfg ? cfg.label : 'Cilt 4');
  const titlesFile =
    opt.titlesFile || (cfg ? cfg.absTitlesFile : path.join(rootDir, dataDir, 'chapters.json'));
  const includeEn = Boolean(opt.includeEn);

  const source = Array.isArray(opt.source)
    ? opt.source
    : JSON.parse(fs.readFileSync(path.join(rootDir, dataDir, 'source.json'), 'utf8'));
  const tr =
    opt.tr && typeof opt.tr === 'object'
      ? opt.tr
      : JSON.parse(fs.readFileSync(path.join(rootDir, dataDir, 'paragraphs_final.json'), 'utf8'));

  let titlesMeta = {};
  if (opt.titles !== undefined && opt.titles !== null && typeof opt.titles === 'object') {
    titlesMeta = opt.titles;
  } else {
    try {
      titlesMeta = JSON.parse(fs.readFileSync(titlesFile, 'utf8'));
    } catch {}
  }

  const hasStructuredChapters = Array.isArray(titlesMeta.chapters) && titlesMeta.chapters.length > 0;
  const flatTitles =
    titlesMeta.titles && typeof titlesMeta.titles === 'object' ? titlesMeta.titles : titlesMeta;

  let chapters = [{ page: 1, label: 'Başlangıç', title: 'Kapak ve görseller' }];

  const pages = source.map((p) => {
    const key = String(p.page);
    const isPending = Boolean(p.pending);
    const trParas = Array.isArray(tr[key]) ? tr[key].filter(Boolean) : [];
    const enParas = String(p.text || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const nnn = String(p.page).padStart(3, '0') + '.webp';
    const hasStandaloneArt = Boolean(
      slug && fs.existsSync(path.join(rootDir, 'public', 'art', `vol-${slug}`, nnn))
    );
    const leadingSlash = imgPrefix.startsWith('/') ? '/' : '';

    if (hasStructuredChapters) {
      const relPagesPrefix = imgPrefix.replace(/^\/+/, '');
      const relDiskPath = path.join(rootDir, 'public', relPagesPrefix, nnn);
      const hasDiskImg = hasStandaloneArt || fs.existsSync(relDiskPath);
      const cleanLen = String(p.text || '').replace(/\s+/g, ' ').trim().length;
      const art = !isPending && hasDiskImg && (cleanLen < 220 || trParas.length === 0);
      const imgPath = hasStandaloneArt
        ? `${leadingSlash}art/vol-${slug}/${nnn}`
        : imgPrefix + nnn;
      const item = {
        n: p.page,
        img: imgPath,
        tr: isPending ? [] : trParas,
        art,
      };
      if (includeEn) item.en = isPending ? [] : enParas;
      if (isPending) item.pending = true;
      return item;
    }

    const heading = parseHeading(enParas[0] || '');

    // OCR'ı bozuk sayfaları (kapak, görsel sayfalar) metin saymayalım
    const words = String(p.text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const alpha = words.filter((w) => /[A-Za-zÇĞİÖŞÜçğıöşü]{3,}/.test(w)).length;
    const usable =
      !isPending &&
      ((words.length >= 6 && alpha / words.length >= 0.4) || Boolean(heading && trParas.length > 0));

    const cleanLen = String(p.text || '')
      .replace(/Page\s+\d+/gi, '')
      .replace(/Goldenagato.*$/gim, '')
      .replace(/\s+/g, ' ')
      .trim().length;

    const relPagesPrefix = imgPrefix.replace(/^\/+/, '');
    const relDiskPath = path.join(rootDir, 'public', relPagesPrefix, nnn);
    const hasDiskImg = hasStandaloneArt || fs.existsSync(relDiskPath);
    const looksLikeArt =
      hasStandaloneArt || (p.page > 3 && cleanLen < 220 && !(heading && trParas.length > 0));
    const art = !isPending && looksLikeArt && (Array.isArray(opt.source) || hasDiskImg);

    if (heading && (usable || heading)) {
      const mappedTitle =
        flatTitles[heading.key] ||
        (heading.fallbackKey ? flatTitles[heading.fallbackKey] : undefined) ||
        heading.rest.slice(0, 70) ||
        (heading.subNum ? `${heading.label} ${heading.subNum}` : heading.label);
      chapters.push({ page: p.page, label: heading.label, title: mappedTitle });
    }

    const imgPath = hasStandaloneArt
      ? `${leadingSlash}art/vol-${slug}/${nnn}`
      : imgPrefix + nnn;

    const pageObj = {
      n: p.page,
      img: imgPath,
      tr: usable ? trParas : [],
      art,
    };
    if (includeEn) {
      pageObj.en = usable ? enParas : [];
    }
    if (isPending) {
      pageObj.pending = true;
    }
    return pageObj;
  });

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
  }

  let hasNonArtScan = false;
  if (!hasStructuredChapters && !Array.isArray(opt.source)) {
    const relPagesPrefix = imgPrefix.replace(/^\/+/, '');
    for (const p of pages) {
      if (!p.art && !p.pending) {
        const nnn = String(p.n).padStart(3, '0') + '.webp';
        if (fs.existsSync(path.join(rootDir, 'public', relPagesPrefix, nnn))) {
          hasNonArtScan = true;
          break;
        }
      }
    }
  }

  const out = {
    title: 'Alya Bazen Duygularını Rusça Saklar',
    id: cfg ? cfg.id : opt.id || '4',
    slug,
    volume,
    total: pages.length,
    chapters,
    pages,
  };
  if (hasNonArtScan) out.fullScans = true;
  return out;
}

function buildBookEn(opt = {}) {
  const b = buildBook({ ...opt, includeEn: true });
  const pages = {};
  for (const p of b.pages) {
    if (!p.pending && Array.isArray(p.en) && p.en.length > 0) {
      pages[String(p.n)] = p.en;
    }
  }
  return {
    id: b.id,
    slug: b.slug,
    pages,
  };
}

function packBook(cfg, includeEn = false) {
  const b = buildBook({
    id: cfg.id,
    slug: cfg.slug,
    dataDir: cfg.dataDir,
    imgPrefix: cfg.imgPrefix,
    volume: cfg.label,
    titlesFile: cfg.absTitlesFile,
    includeEn,
  });
  const json = Buffer.from(JSON.stringify(b));
  return { book: b, json, gzip: zlib.gzipSync(json), mtime: fs.statSync(cfg.absTrFile).mtimeMs };
}

function packBookEn(cfg) {
  const en = buildBookEn({
    id: cfg.id,
    slug: cfg.slug,
    dataDir: cfg.dataDir,
    imgPrefix: cfg.imgPrefix,
    volume: cfg.label,
    titlesFile: cfg.absTitlesFile,
  });
  const json = Buffer.from(JSON.stringify(en));
  return { en, json, gzip: zlib.gzipSync(json), mtime: fs.statSync(cfg.absSourceFile).mtimeMs };
}

const BOOKS = {};
const BOOKS_EN = {};
function getBook(key, opt = {}) {
  const includeEn = Boolean(opt.includeEn);
  const active = getActiveVolumes(ROOT);
  const manifest = loadManifest(ROOT);
  const resolvedKey = active[key] ? key : manifest.defaultVolume;
  const cfg = active[resolvedKey] || getVolume(resolvedKey, ROOT);
  if (!cfg || !cfg.active) {
    throw new Error(`İstenen cilt hazır değil: ${key}`);
  }
  const cacheKey = `${cfg.id}:${includeEn ? 'en' : 'tr'}`;
  const currentMtime = fs.statSync(cfg.absTrFile).mtimeMs;
  if (!BOOKS[cacheKey] || BOOKS[cacheKey].mtime !== currentMtime) {
    BOOKS[cacheKey] = packBook(cfg, includeEn);
  }
  return BOOKS[cacheKey];
}

function getBookEn(key) {
  const active = getActiveVolumes(ROOT);
  const manifest = loadManifest(ROOT);
  const resolvedKey = active[key] ? key : manifest.defaultVolume;
  const cfg = active[resolvedKey] || getVolume(resolvedKey, ROOT);
  if (!cfg || !cfg.active) {
    throw new Error(`İstenen cilt hazır değil: ${key}`);
  }
  const currentMtime = fs.statSync(cfg.absSourceFile).mtimeMs;
  if (!BOOKS_EN[cfg.id] || BOOKS_EN[cfg.id].mtime !== currentMtime) {
    BOOKS_EN[cfg.id] = packBookEn(cfg);
  }
  return BOOKS_EN[cfg.id];
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
    const manifest = loadManifest(ROOT);
    const activeList = getActiveVolumeList(ROOT);
    const volumes = {};
    for (const v of activeList) {
      volumes[v.id] = {
        id: v.id,
        slug: v.slug,
        label: v.label,
        file: `bundles/vol-${v.slug}.json`,
        enFile: `bundles/bundle-en-${v.slug}.json`,
      };
    }
    const payload = {
      defaultVolume: manifest.defaultVolume,
      order: activeList.map((v) => v.id),
      volumes,
    };
    return send(req, res, 200, MIME['.json'], Buffer.from(JSON.stringify(payload)));
  }

  if (pathname === '/api/book') {
    const active = getActiveVolumes(ROOT);
    const manifest = loadManifest(ROOT);
    const reqVol = query.get('v');
    const vKey = active[reqVol] ? reqVol : manifest.defaultVolume;
    const includeEn = query.get('en') === '1';
    try {
      const loaded = getBook(vKey, { includeEn });
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

  if (pathname === '/api/book-en') {
    const active = getActiveVolumes(ROOT);
    const manifest = loadManifest(ROOT);
    const reqVol = query.get('v');
    const vKey = active[reqVol] ? reqVol : manifest.defaultVolume;
    try {
      const loaded = getBookEn(vKey);
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
        Buffer.from(JSON.stringify({ error: `Cilt ${vKey} İngilizce metni hazır değil: ${e.message}` }))
      );
    }
  }

  // Statik JSON uç noktası (/books/<v>.json) isteğini de destekle
  const bookJsonMatch = pathname.match(/^\/books\/([0-9.]+)\.json$/);
  if (bookJsonMatch) {
    const active = getActiveVolumes(ROOT);
    if (active[bookJsonMatch[1]]) {
      try {
        const loaded = getBook(bookJsonMatch[1]);
        return send(req, res, 200, MIME['.json'], loaded.json);
      } catch {}
    }
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
      ext === '.webp' ||
      ext === '.jpg' ||
      ext === '.png' ||
      (ext === '.json' && pathname.startsWith('/bundles/') && query.get('v'))
        ? 'public, max-age=31536000, immutable'
        : 'no-cache';
    send(req, res, 200, type, data, { 'Cache-Control': cache });
  });
});

function start() {
  server.listen(PORT, () => {
    console.log('Okuyucu hazır:  http://localhost:' + PORT);
    const activeList = getActiveVolumeList(ROOT);
    for (const cfg of activeList) {
      try {
        const b = getBook(cfg.id).book;
        console.log(cfg.label.padEnd(13) + ':', b.total, 'sayfa |', b.chapters.length, 'bölüm');
      } catch {
        console.log(cfg.label.padEnd(13) + ': henüz hazır değil');
      }
    }
  });
}

const VOLUME_KEYS = getVolumeIds(ROOT);
const VOLUMES = Object.fromEntries(
  getVolumeList(ROOT).map((v) => [
    v.id,
    {
      key: v.id,
      id: v.id,
      slug: v.slug,
      dataDir: v.dataDir,
      imgPrefix: v.imgPrefix,
      volume: v.label,
      titlesFile: v.absTitlesFile,
    },
  ])
);

if (require.main === module) start();

module.exports = {
  VOLUMES,
  VOLUME_KEYS,
  buildBook,
  buildBookEn,
  parseHeading,
  getBook,
  getBookEn,
  start,
  server,
};
