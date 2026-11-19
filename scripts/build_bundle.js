// Tarayıcıya gömülecek veri paketi: Cilt 4 – 12 Türkçe + İngilizce + bölümler.
// Sunucuya ihtiyaç duymadan okuma için public/bundle.js ve public/bundle-art.js üretir.
// Kullanım: node scripts/build_bundle.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { buildBook, buildBookEn } = require('../server.js');
const { ROOT, VOLUME_KEYS, VOLUMES } = require('./lib/volumes');

const OUT = path.join(ROOT, 'public', 'bundle.js');
const ART_OUT = path.join(ROOT, 'public', 'bundle-art.js');
const BOOKS_DIR = path.join(ROOT, 'public', 'books');

function loadExistingArtBundle() {
  const out = { art: {}, index: {} };
  if (fs.existsSync(ART_OUT)) {
    try {
      const code = fs.readFileSync(ART_OUT, 'utf8');
      const sandbox = { window: {} };
      vm.runInNewContext(code, sandbox, { timeout: 2000 });
      if (sandbox.window.ALYA_ART) out.art = sandbox.window.ALYA_ART;
      if (sandbox.window.ALYA_ART_INDEX) out.index = sandbox.window.ALYA_ART_INDEX;
    } catch {}
  }
  for (const k of ['4', '4.5']) {
    const f = path.join(BOOKS_DIR, `art-${k}.json`);
    if ((!out.art[k] || !Object.keys(out.art[k]).length) && fs.existsSync(f)) {
      try {
        out.art[k] = JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch {}
    }
  }
  return out;
}

const existing = loadExistingArtBundle();
const existingArt = existing.art;
const vols = {};
const volsEn = {};
const art = {};

for (const k of VOLUME_KEYS) {
  const cfg = VOLUMES[k];
  if (!fs.existsSync(cfg.sourceFile) || !fs.existsSync(cfg.finalFile)) continue;

  const book = buildBook({
    dataDir: cfg.dataDir,
    imgPrefix: cfg.imgPrefix,
    volume: cfg.label,
    titlesFile: cfg.titlesFile,
    includeEn: false,
  });

  // Statik barındırma (GitHub Pages alt dizini dahil) için göreli görsel yolları kullan
  for (const p of book.pages) {
    p.img = cfg.relImgPrefix + String(p.n).padStart(3, '0') + '.webp';
  }
  vols[k] = book;
  volsEn[k] = buildBookEn({
    dataDir: cfg.dataDir,
    imgPrefix: cfg.imgPrefix,
    volume: cfg.label,
    titlesFile: cfg.titlesFile,
  });

  // Cilt 4 ve 4.5 için ham görsel klasörü gitignore'da olduğundan mevcut gömülü data URI'leri koru
  if (k === '4' || k === '4.5') {
    art[k] = { ...(existingArt[k] || {}) };
    const diskDir = path.join(ROOT, cfg.imgDir);
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

// cilt başına ayrı JSON parçaları (ilk yükleme hafif olsun; p.en bundle-en-<cilt>.json parçasında)
fs.mkdirSync(BOOKS_DIR, { recursive: true });
const manifestVols = {};
for (const [k, book] of Object.entries(vols)) {
  const bookRaw = JSON.stringify(book);
  const enRaw = JSON.stringify(volsEn[k]);
  const bookHash = crypto.createHash('sha1').update(bookRaw).digest('hex').slice(0, 12);
  const enHash = crypto.createHash('sha1').update(enRaw).digest('hex').slice(0, 12);
  fs.writeFileSync(path.join(BOOKS_DIR, 'v' + k + '.json'), bookRaw);
  fs.writeFileSync(path.join(BOOKS_DIR, 'bundle-en-' + k + '.json'), enRaw);
  const artFile = path.join(BOOKS_DIR, 'art-' + k + '.json');
  if (art[k] && Object.keys(art[k]).length) {
    fs.writeFileSync(artFile, JSON.stringify(art[k]));
  } else if (fs.existsSync(artFile)) {
    fs.unlinkSync(artFile);
  }
  manifestVols[k] = {
    label: book.volume || 'Cilt ' + k,
    total: book.total,
    hash: bookHash,
    enHash,
    chapters: book.chapters,
  };
}

const raw = JSON.stringify({ vols: manifestVols });
const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);

const body =
  '/* otomatik üretildi: scripts/build_bundle.js — elle düzenlemeyin */\n' +
  '/* yalnızca cilt manifesti; metin public/books/v<CİLT>.json dosyalarından yüklenir */\n' +
  'window.ALYA_BUNDLE=' + raw + ';\n' +
  'window.ALYA_BUNDLE_VERSION=' + JSON.stringify(hash) + ';\n';

fs.writeFileSync(OUT, body);

const artIndex = Object.fromEntries(
  Object.entries(art).map(([k, v]) => {
    const count = Object.keys(v).length;
    return [k, count > 0 ? count : existing.index[k] || 0];
  })
);
const artBody =
  '/* otomatik üretildi: scripts/build_bundle.js — illüstrasyon görselleri cilt başına public/books/art-<cilt>.json içinde */\n' +
  'window.ALYA_ART_INDEX=' + JSON.stringify(artIndex) + ';\n';
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
for (const [k, b] of Object.entries(vols)) {
  const paras = b.pages.reduce((a, p) => a + p.tr.length, 0);
  console.log('  Cilt ' + k + ':', b.total, 'sayfa |', paras, 'paragraf |', b.chapters.length, 'bölüm');
}
