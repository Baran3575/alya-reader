// Tarayıcıya gömülecek veri manifesti ve cilt parçaları: Cilt 4 – 12 Türkçe + İngilizce + bölümler.
// public/bundle.js (hafif manifest), public/bundle-art.js ve public/books/{v<k>,<k>,art-<k>,index}.json üretir.
// Kullanım: node scripts/build_bundle.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { buildBook } = require('../server.js');
const { ROOT, VOLUME_KEYS, VOLUMES } = require('./lib/volumes');

const PUB = path.join(ROOT, 'public');
const OUT = path.join(PUB, 'bundle.js');
const ART_OUT = path.join(PUB, 'bundle-art.js');
const BOOKS_DIR = path.join(PUB, 'books');

function loadExistingArtBundle() {
  const result = {};
  for (const k of ['4', '4.5']) {
    const chunkPath = path.join(BOOKS_DIR, `art-${k}.json`);
    if (fs.existsSync(chunkPath)) {
      try {
        result[k] = JSON.parse(fs.readFileSync(chunkPath, 'utf8'));
      } catch {}
    }
  }
  if (fs.existsSync(ART_OUT)) {
    try {
      const code = fs.readFileSync(ART_OUT, 'utf8');
      const sandbox = { window: {} };
      vm.runInNewContext(code, sandbox, { timeout: 2000 });
      const embedded = sandbox.window.ALYA_ART || {};
      for (const k of Object.keys(embedded)) {
        if (!result[k] || Object.keys(result[k]).length === 0) {
          result[k] = embedded[k];
        }
      }
    } catch {}
  }
  return result;
}

const existingArt = loadExistingArtBundle();
const vols = {};
const art = {};

for (const k of VOLUME_KEYS) {
  const cfg = VOLUMES[k];
  if (!fs.existsSync(cfg.sourceFile) || !fs.existsSync(cfg.finalFile)) continue;

  const book = buildBook({
    dataDir: cfg.dataDir,
    imgPrefix: cfg.imgPrefix,
    volume: cfg.label,
    titlesFile: cfg.titlesFile,
  });

  // Statik barındırma (GitHub Pages alt dizini dahil) için göreli görsel yolları kullan
  for (const p of book.pages) {
    p.img = cfg.relImgPrefix + String(p.n).padStart(3, '0') + '.webp';
  }
  vols[k] = book;

  // Cilt 4 ve 4.5 için ham görsel klasörü gitignore'da olduğundan mevcut gömülü data URI'leri koru
  if (k === '4' || k === '4.5') {
    art[k] = { ...(existingArt[k] || {}) };
    const diskDir = path.join(ROOT, cfg.imgDir);
    if (fs.existsSync(diskDir)) {
      for (const p of book.pages) {
        if (!p.art && p.tr.length > 0) continue;
        const pad = String(p.n).padStart(3, '0');
        const f = path.join(diskDir, `${pad}.webp`);
        if (fs.existsSync(f)) {
          art[k][pad] = 'data:image/webp;base64,' + fs.readFileSync(f).toString('base64');
        }
      }
    }
  }

  // Her sayfa için tarama/illüstrasyon görselinin mevcut olup olmadığını işaretle
  const artPack = art[k] || {};
  for (const p of book.pages) {
    const pad = String(p.n).padStart(3, '0');
    const onDisk = fs.existsSync(path.join(PUB, p.img));
    p.hasImg = Boolean(artPack[pad] || onDisk);
  }
}

// cilt başına ayrı JSON parçaları (ilk yükleme hafif olsun)
fs.rmSync(BOOKS_DIR, { recursive: true, force: true });
fs.mkdirSync(BOOKS_DIR, { recursive: true });
const manifestVols = {};
const manifestVolumes = [];
const versionHasher = crypto.createHash('sha1');

for (const k of VOLUME_KEYS) {
  const book = vols[k];
  if (!book) continue;
  const volJson = JSON.stringify(book);
  const volHash = crypto.createHash('sha1').update(volJson).digest('hex').slice(0, 12);
  versionHasher.update(volHash);

  fs.writeFileSync(path.join(BOOKS_DIR, 'v' + k + '.json'), volJson);

  const artFile = path.join(BOOKS_DIR, 'art-' + k + '.json');
  if (art[k] && Object.keys(art[k]).length) {
    fs.writeFileSync(artFile, JSON.stringify(art[k]));
  }

  manifestVols[k] = {
    label: book.volume || 'Cilt ' + k,
    total: book.total,
    chapters: book.chapters,
  };
  manifestVolumes.push({
    id: k,
    short: k,
    label: book.volume || 'Cilt ' + k,
    total: book.total,
    chapters: book.chapters.length,
    hasPending: book.chapters.some((c) => c.pending),
    version: volHash,
    file: `books/v${k}.json`,
  });
}

const raw = JSON.stringify({ vols: manifestVols });
const hash = versionHasher.digest('hex').slice(0, 12);

const body =
  '/* otomatik üretildi: scripts/build_bundle.js — elle düzenlemeyin */\n' +
  '/* yalnızca cilt manifesti; metin public/books/v<CİLT>.json dosyalarından yüklenir */\n' +
  'window.ALYA_VOLUMES=' + JSON.stringify(manifestVolumes) + ';\n' +
  'window.ALYA_BUNDLE=' + raw + ';\n' +
  'window.ALYA_BUNDLE_VERSION=' + JSON.stringify(hash) + ';\n';

fs.writeFileSync(OUT, body);

const artIndex = Object.fromEntries(Object.entries(art).map(([k, v]) => [k, Object.keys(v).length]));
const artBody =
  '/* otomatik üretildi: scripts/build_bundle.js — illüstrasyon görselleri (data URI + cilt başına public/books/art-<cilt>.json) */\n' +
  'window.ALYA_ART_INDEX=' + JSON.stringify(artIndex) + ';\n' +
  'window.ALYA_ART=' + JSON.stringify(art) + ';\n';
fs.writeFileSync(ART_OUT, artBody);

console.log(
  'illüstrasyon (gömülü Cilt 4/4.5):',
  Object.values(art).reduce((a, o) => a + Object.keys(o).length, 0),
  'görsel |',
  (artBody.length / 1048576).toFixed(2),
  'MB'
);
const kb = (body.length / 1024).toFixed(0);
console.log('yazıldı:', path.relative(ROOT, OUT), kb + ' KB', '| sürüm:', hash);
for (const k of VOLUME_KEYS) {
  const b = vols[k];
  if (!b) continue;
  const paras = b.pages.reduce((a, p) => a + p.tr.length, 0);
  console.log('  Cilt ' + k + ':', b.total, 'sayfa |', paras, 'paragraf |', b.chapters.length, 'bölüm');
}
