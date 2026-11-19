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

function loadExistingArtBundle() {
  const out = {};
  const booksDir = path.join(ROOT, 'public', 'books');
  for (const k of ['4', '4.5']) {
    const chunkPath = path.join(booksDir, `art-${k}.json`);
    if (fs.existsSync(chunkPath)) {
      try {
        out[k] = JSON.parse(fs.readFileSync(chunkPath, 'utf8'));
      } catch {}
    }
  }
  if (fs.existsSync(ART_OUT)) {
    try {
      const code = fs.readFileSync(ART_OUT, 'utf8');
      const sandbox = { window: {} };
      vm.runInNewContext(code, sandbox, { timeout: 2000 });
      const legacy = sandbox.window.ALYA_ART || {};
      for (const [k, v] of Object.entries(legacy)) {
        if (!out[k] || !Object.keys(out[k]).length) out[k] = v;
      }
    } catch {}
  }
  return out;
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

  // Cilt 4 ve 4.5 için ham görsel klasörü gitignore'da olduğundan yalnızca geçerli illüstrasyonların data URI'lerini koru
  if (k === '4' || k === '4.5') {
    art[k] = {};
    const diskDir = path.join(ROOT, cfg.imgDir);
    for (const p of book.pages) {
      if (!p.art || p.skip) continue;
      const pad = String(p.n).padStart(3, '0');
      const f = path.join(diskDir, `${pad}.webp`);
      if (fs.existsSync(f)) {
        art[k][pad] = 'data:image/webp;base64,' + fs.readFileSync(f).toString('base64');
      } else if (existingArt[k] && existingArt[k][pad]) {
        art[k][pad] = existingArt[k][pad];
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
const hasher = crypto.createHash('sha1').update(raw);
for (const k of VOLUME_KEYS) {
  if (vols[k]) hasher.update(JSON.stringify(vols[k]));
}
const hash = hasher.digest('hex').slice(0, 12);

const body =
  '/* otomatik üretildi: scripts/build_bundle.js — elle düzenlemeyin */\n' +
  '/* yalnızca cilt manifesti; metin public/books/v<CİLT>.json dosyalarından yüklenir */\n' +
  'window.ALYA_BUNDLE=' + raw + ';\n' +
  'window.ALYA_BUNDLE_VERSION=' + JSON.stringify(hash) + ';\n';

fs.writeFileSync(OUT, body);

const artBody =
  '/* otomatik üretildi: scripts/build_bundle.js — Cilt 4 ve 4.5 illüstrasyon yedeği ve dizini */\n' +
  'window.ALYA_ART=' + JSON.stringify(art) + ';\n' +
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
