// Tarayıcıya gömülecek veri paketi: Türkçe + İngilizce + bölümler (kayıtlı tüm ciltler).
// Sunucuya ihtiyaç duymadan okuma için bundle.js, bundle-art.js ve isteğe bağlı books/<cilt>.json üretir.
// Kullanım: node scripts/build_bundle.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { VOLUMES, buildBook } = require('../server.js');

const ROOT = path.join(__dirname, '..');

function loadExistingArt(artFile) {
  if (!artFile || !fs.existsSync(artFile)) return {};
  try {
    const src = fs.readFileSync(artFile, 'utf8');
    const match = src.match(/window\.ALYA_ART\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
    if (match) return JSON.parse(match[1]);
    const ctx = { window: {} };
    vm.runInNewContext(src, ctx);
    if (ctx.window.ALYA_ART && typeof ctx.window.ALYA_ART === 'object') {
      return ctx.window.ALYA_ART;
    }
  } catch {}
  return {};
}

function normalizeImgPrefix(prefix) {
  const clean = String(prefix || '/pages/').replace(/^\/+/, '');
  return clean.endsWith('/') ? clean : clean + '/';
}

function buildBundles(opt = {}) {
  const rootDir = opt.rootDir || ROOT;
  const outDir = opt.outDir || path.join(rootDir, 'public');
  const booksDir = opt.booksDir || null;
  const volumes = opt.volumes || VOLUMES;
  const artSourceFile =
    opt.artSourceFile !== undefined ? opt.artSourceFile : path.join(rootDir, 'public', 'bundle-art.js');
  const quiet = Boolean(opt.quiet);

  fs.mkdirSync(outDir, { recursive: true });

  const existingArt = loadExistingArt(artSourceFile);
  const vols = {};
  const art = {};

  for (const [volKey, existingEntries] of Object.entries(existingArt)) {
    if (existingEntries && typeof existingEntries === 'object') {
      art[volKey] = { ...existingEntries };
    }
  }

  for (const [k, cfg] of Object.entries(volumes)) {
    const relPrefix = normalizeImgPrefix(cfg.imgPrefix);
    const titlesFile = cfg.titlesFile
      ? path.isAbsolute(cfg.titlesFile) && opt.rootDir
        ? path.join(rootDir, cfg.dataDir || 'data', 'chapters.json')
        : cfg.titlesFile
      : path.join(rootDir, cfg.dataDir || 'data', 'chapters.json');

    const book = buildBook({
      ...cfg,
      rootDir,
      imgPrefix: relPrefix,
      titlesFile,
    });
    vols[k] = book;

    if (!art[k]) art[k] = {};
    const imgDir = path.join(rootDir, 'public', relPrefix);
    for (const p of book.pages) {
      if (!p.art) continue;
      const pageKey = String(p.n).padStart(3, '0');
      const f = path.join(imgDir, pageKey + '.webp');
      if (fs.existsSync(f)) {
        const b64 = fs.readFileSync(f).toString('base64');
        art[k][pageKey] = 'data:image/webp;base64,' + b64;
      }
    }
  }

  const raw = JSON.stringify({ vols });
  const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);

  const body =
    '/* otomatik üretildi: scripts/build_bundle.js — elle düzenlemeyin */\n' +
    'window.ALYA_BUNDLE=' + raw + ';\n' +
    'window.ALYA_BUNDLE_VERSION=' + JSON.stringify(hash) + ';\n';

  const bundleOut = path.join(outDir, 'bundle.js');
  fs.writeFileSync(bundleOut, body);

  if (booksDir) {
    fs.mkdirSync(booksDir, { recursive: true });
    for (const [k, book] of Object.entries(vols)) {
      fs.writeFileSync(path.join(booksDir, k + '.json'), JSON.stringify(book));
    }
  }

  const artBody =
    '/* otomatik üretildi: scripts/build_bundle.js — illüstrasyon görselleri (data URI) */\n' +
    'window.ALYA_ART=' + JSON.stringify(art) + ';\n';
  const artOut = path.join(outDir, 'bundle-art.js');
  fs.writeFileSync(artOut, artBody);

  const artCount = Object.values(art).reduce((a, o) => a + Object.keys(o).length, 0);
  if (!quiet) {
    console.log(
      'illüstrasyon:',
      artCount,
      'görsel |',
      (artBody.length / 1048576).toFixed(2),
      'MB',
    );
    const kb = (body.length / 1024).toFixed(0);
    console.log('yazıldı:', path.relative(rootDir, bundleOut), kb + ' KB', '| sürüm:', hash);
    for (const [k, b] of Object.entries(vols)) {
      const paras = b.pages.reduce((a, p) => a + p.tr.length, 0);
      console.log('  Cilt ' + k + ':', b.total, 'sayfa |', paras, 'paragraf |', b.chapters.length, 'bölüm');
    }
  }

  return { vols, art, artCount, artBytes: Buffer.byteLength(artBody), bundleBytes: Buffer.byteLength(body), hash };
}

if (require.main === module) {
  buildBundles();
}

module.exports = { buildBundles, loadExistingArt, normalizeImgPrefix };
