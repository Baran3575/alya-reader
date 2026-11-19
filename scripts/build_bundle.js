// Tarayıcıya gömülecek veri paketi: Cilt 4 – 12 Türkçe + İngilizce + bölümler.
// Sunucuya ihtiyaç duymadan okuma için public/bundle.js ve public/bundle-art.js üretir.
// Kullanım: node scripts/build_bundle.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { buildBook } = require('../server.js');
const { ROOT, VOLUME_KEYS, VOLUMES } = require('./lib/volumes');

const OUT = path.join(ROOT, 'public', 'bundle.js');
const ART_OUT = path.join(ROOT, 'public', 'bundle-art.js');
const SW_OUT = path.join(ROOT, 'public', 'sw.js');
const BOOKS_DIR = path.join(ROOT, 'public', 'books');

function loadExistingArtBundle() {
  const merged = {};
  if (fs.existsSync(ART_OUT)) {
    try {
      const code = fs.readFileSync(ART_OUT, 'utf8');
      const sandbox = { window: {} };
      vm.runInNewContext(code, sandbox, { timeout: 2000 });
      if (sandbox.window.ALYA_ART && typeof sandbox.window.ALYA_ART === 'object') {
        for (const [k, v] of Object.entries(sandbox.window.ALYA_ART)) {
          if (v && typeof v === 'object') merged[k] = { ...v };
        }
      }
    } catch {}
  }
  for (const k of ['4', '4.5']) {
    const artChunk = path.join(BOOKS_DIR, `art-${k}.json`);
    if (fs.existsSync(artChunk)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(artChunk, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          merged[k] = { ...(merged[k] || {}), ...parsed };
        }
      } catch {}
    }
  }
  return merged;
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
  // ve tam tarama klasörü mevcutsa scansAvailable = true işaretle
  const diskDir = path.join(ROOT, cfg.imgDir);
  let allScansPresent = fs.existsSync(diskDir);
  for (const p of book.pages) {
    const fileName = String(p.n).padStart(3, '0') + '.webp';
    p.img = cfg.relImgPrefix + fileName;
    if (allScansPresent && !fs.existsSync(path.join(diskDir, fileName))) {
      allScansPresent = false;
    }
  }
  book.scansAvailable = Boolean(allScansPresent);
  vols[k] = book;

  // Cilt 4 ve 4.5 için ham görsel klasörü gitignore'da olduğundan mevcut gömülü data URI'leri koru
  if (k === '4' || k === '4.5') {
    art[k] = { ...(existingArt[k] || {}) };
    if (fs.existsSync(diskDir)) {
      for (const p of book.pages) {
        if (!p.art) continue;
        const pad = String(p.n).padStart(3, '0');
        const f = path.join(diskDir, `${pad}.webp`);
        if (fs.existsSync(f)) {
          art[k][pad] = 'data:image/webp;base64,' + fs.readFileSync(f).toString('base64');
        }
      }
    }
  }
}

// Temiz kurulumda mevcut gömülü Cilt 4/4.5 veya yayınlanan Cilt 5–12 illüstrasyonlarının kaybolmadığını doğrula
const missingArt = [];
for (const [k, map] of Object.entries(existingArt)) {
  for (const [pageKey, uri] of Object.entries(map || {})) {
    if (typeof uri === 'string' && uri.startsWith('data:image/')) {
      if (!art[k] || typeof art[k][pageKey] !== 'string' || !art[k][pageKey].startsWith('data:image/')) {
        missingArt.push('Cilt ' + k + ' s.' + pageKey);
      }
    }
  }
}
for (const [k, book] of Object.entries(vols)) {
  if (k === '4' || k === '4.5') {
    if (!art[k] || Object.keys(art[k]).length === 0) {
      missingArt.push('Cilt ' + k + ' (art-' + k + '.json boş)');
    }
    continue;
  }
  const cfg = VOLUMES[k];
  for (const p of book.pages) {
    if (!p.art) continue;
    const pageKey = String(p.n).padStart(3, '0');
    const diskPath = path.join(ROOT, cfg.imgDir, `${pageKey}.webp`);
    if (!fs.existsSync(diskPath)) {
      missingArt.push('Cilt ' + k + ' s.' + pageKey);
    }
  }
}
if (missingArt.length > 0) {
  throw new Error('İllüstrasyon doğrulaması başarısız; eksik görseller: ' + missingArt.join(', '));
}

// cilt başına ayrı JSON parçaları (ilk yükleme hafif olsun)
fs.mkdirSync(BOOKS_DIR, { recursive: true });
const manifestVols = {};
for (const [k, book] of Object.entries(vols)) {
  fs.writeFileSync(path.join(BOOKS_DIR, 'v' + k + '.json'), JSON.stringify(book));
  const artFile = path.join(BOOKS_DIR, 'art-' + k + '.json');
  if (art[k] && Object.keys(art[k]).length) {
    fs.writeFileSync(artFile, JSON.stringify(art[k]));
  } else if (fs.existsSync(artFile)) {
    fs.unlinkSync(artFile);
  }
  manifestVols[k] = { label: book.volume || 'Cilt ' + k, total: book.total, chapters: book.chapters };
}

const raw = JSON.stringify({ vols: manifestVols });
const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);

const body =
  '/* otomatik üretildi: scripts/build_bundle.js — elle düzenlemeyin */\n' +
  '/* yalnızca cilt manifesti; metin public/books/v<CİLT>.json dosyalarından yüklenir */\n' +
  'window.ALYA_BUNDLE=' + raw + ';\n' +
  'window.ALYA_BUNDLE_VERSION=' + JSON.stringify(hash) + ';\n';

fs.writeFileSync(OUT, body);

const artBody =
  '/* otomatik üretildi: scripts/build_bundle.js — illüstrasyon görselleri cilt başına public/books/art-<cilt>.json içinde */\n' +
  'window.ALYA_ART_INDEX=' + JSON.stringify(Object.fromEntries(Object.entries(art).map(([k, v]) => [k, Object.keys(v).length]))) + ';\n';
fs.writeFileSync(ART_OUT, artBody);

if (fs.existsSync(SW_OUT)) {
  const swHasher = crypto.createHash('sha1').update(body).update(artBody);
  for (const k of Object.keys(vols).sort()) {
    swHasher.update(JSON.stringify(vols[k]));
  }
  for (const rel of ['index.html', 'style.css', 'app.js']) {
    const assetPath = path.join(ROOT, 'public', rel);
    if (fs.existsSync(assetPath)) swHasher.update(fs.readFileSync(assetPath));
  }
  const swVersion = 'alya-' + swHasher.digest('hex').slice(0, 12);
  const swSrc = fs.readFileSync(SW_OUT, 'utf8');
  const updatedSw = swSrc.replace(/^const VERSION = ['"][^'"]*['"];/m, "const VERSION = '" + swVersion + "';");
  if (updatedSw !== swSrc) {
    fs.writeFileSync(SW_OUT, updatedSw);
  }
}

console.log(
  'illüstrasyon (gömülü Cilt 4/4.5):',
  Object.values(art).reduce((a, o) => a + Object.keys(o).length, 0),
  'görsel |',
  (artBody.length / 1048576).toFixed(2),
  'MB'
);
const kb = (body.length / 1024).toFixed(0);
console.log('yazıldı:', path.relative(ROOT, OUT), kb + ' KB', '| sürüm:', hash);
for (const [k, b] of Object.entries(vols)) {
  const paras = b.pages.reduce((a, p) => a + p.tr.length, 0);
  console.log('  Cilt ' + k + ':', b.total, 'sayfa |', paras, 'paragraf |', b.chapters.length, 'bölüm');
}
