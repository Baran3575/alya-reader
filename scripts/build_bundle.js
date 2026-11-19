// Tarayıcıya gömülecek veri paketi: Cilt 4 – 12 Türkçe + İngilizce + bölümler.
// Sunucuya ihtiyaç duymadan okuma için public/bundle.js ve public/bundle-art.js üretir.
// Kullanım: node scripts/build_bundle.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildBook, readBundleArt } = require('../server.js');
const { ROOT, VOLUME_KEYS, VOLUMES } = require('./lib/volumes');

const OUT = path.join(ROOT, 'public', 'bundle.js');
const ART_OUT = path.join(ROOT, 'public', 'bundle-art.js');

const existingArt = readBundleArt(ART_OUT);
const vols = {};
const art = {};

for (const k of VOLUME_KEYS) {
  const cfg = VOLUMES[k];
  if (!fs.existsSync(cfg.sourceFile) || !fs.existsSync(cfg.finalFile)) continue;

  const book = buildBook({
    volKey: k,
    dataDir: cfg.dataDir,
    imgPrefix: cfg.imgPrefix,
    volume: cfg.label,
    titlesFile: cfg.titlesFile,
    artMap: existingArt,
  });

  // Statik barındırma (GitHub Pages alt dizini dahil) için göreli görsel yolları kullan
  for (const p of book.pages) {
    p.img = cfg.relImgPrefix + String(p.n).padStart(3, '0') + '.webp';
  }
  vols[k] = book;

  // Cilt 4 ve 4.5 için ham görsel klasörü gitignore'da olduğundan mevcut gömülü data URI'leri koru;
  // art: false olan sayfaları (örn. Cilt 4 s.282) ayıkla.
  if (k === '4' || k === '4.5') {
    const prevVolArt = (existingArt && existingArt[k]) || {};
    const diskDir = path.join(ROOT, cfg.imgDir);
    art[k] = {};
    for (const p of book.pages) {
      if (!p.art) continue;
      const pad = String(p.n).padStart(3, '0');
      const f = path.join(diskDir, `${pad}.webp`);
      if (fs.existsSync(f)) {
        art[k][pad] = 'data:image/webp;base64,' + fs.readFileSync(f).toString('base64');
      } else if (prevVolArt[pad]) {
        art[k][pad] = prevVolArt[pad];
      }
    }
  }
}

// cilt başına ayrı JSON parçaları (ilk yükleme hafif olsun)
const BOOKS_DIR = path.join(ROOT, 'public', 'books');
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
