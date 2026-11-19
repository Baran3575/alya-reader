// Tarayıcıya gömülecek veri paketi: Türkçe + İngilizce + bölümler (iki cilt).
// Sunucuya ihtiyaç duymadan okuma için public/bundle.js üretir.
// Kullanım: node scripts/build_bundle.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { buildBook } = require('../server.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'bundle.js');
const ART_OUT = path.join(ROOT, 'public', 'bundle-art.js');
const SW_OUT = path.join(ROOT, 'public', 'sw.js');
const IMG_DIRS = { '4': 'public/pages/', '4.5': 'public/pages45/' };

const vols = {
  4: buildBook({ dataDir: 'data', imgPrefix: '/pages/', volume: 'Cilt 4', titlesFile: path.join(ROOT, 'data/chapters.json') }),
  '4.5': buildBook({ dataDir: 'data45', imgPrefix: '/pages45/', volume: 'Cilt 4.5', titlesFile: path.join(ROOT, 'data45/chapters.json') }),
};

// sayfa görsellerini de paketle: tam tarama klasörü mevcutsa scansAvailable = true
const IMG_BUDGET = 0; // 0 = görselleri gömme, göreli yoldan yükle
for (const [k, book] of Object.entries(vols)) {
  const prefix = /^4\.5$/.test(k) ? 'pages45/' : 'pages/';
  const scanDir = path.join(ROOT, IMG_DIRS[k]);
  let allScansPresent = fs.existsSync(scanDir);
  for (const p of book.pages) {
    const fileName = String(p.n).padStart(3, '0') + '.webp';
    p.img = prefix + fileName;
    if (allScansPresent && !fs.existsSync(path.join(scanDir, fileName))) {
      allScansPresent = false;
    }
  }
  book.scansAvailable = Boolean(allScansPresent);
}

function loadExistingArt(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const src = fs.readFileSync(filePath, 'utf8');
  const ctx = { window: {} };
  vm.runInNewContext(src, ctx);
  if (!ctx.window.ALYA_ART || typeof ctx.window.ALYA_ART !== 'object') {
    throw new Error('Mevcut bundle-art.js içinde geçerli window.ALYA_ART bulunamadı');
  }
  return ctx.window.ALYA_ART;
}

// illüstrasyon sayfalarının görselleri de gömülür (data URI) — temiz kurulumda mevcut gömülü görseller korunur
const prevArt = loadExistingArt(ART_OUT);
const art = {};
for (const k of Object.keys(prevArt)) {
  if (prevArt[k] && typeof prevArt[k] === 'object') {
    art[k] = { ...prevArt[k] };
  }
}
for (const [k, book] of Object.entries(vols)) {
  if (!art[k]) art[k] = {};
  for (const p of book.pages) {
    if (!p.art) continue;
    const pageKey = String(p.n).padStart(3, '0');
    const f = path.join(ROOT, IMG_DIRS[k], pageKey + '.webp');
    if (!fs.existsSync(f)) continue;
    const b64 = fs.readFileSync(f).toString('base64');
    art[k][pageKey] = 'data:image/webp;base64,' + b64;
  }
}

const missingArt = [];
for (const [k, map] of Object.entries(prevArt)) {
  for (const [pageKey, uri] of Object.entries(map || {})) {
    if (typeof uri === 'string' && uri.startsWith('data:image/')) {
      if (!art[k] || typeof art[k][pageKey] !== 'string' || !art[k][pageKey].startsWith('data:image/')) {
        missingArt.push('Cilt ' + k + ' s.' + pageKey);
      }
    }
  }
}
for (const [k, book] of Object.entries(vols)) {
  for (const p of book.pages) {
    if (!p.art) continue;
    const pageKey = String(p.n).padStart(3, '0');
    const uri = art[k] && art[k][pageKey];
    if (typeof uri !== 'string' || !uri.startsWith('data:image/')) {
      const label = 'Cilt ' + k + ' s.' + pageKey;
      if (!missingArt.includes(label)) missingArt.push(label);
    }
  }
}
if (missingArt.length > 0) {
  throw new Error('İllüstrasyon doğrulaması başarısız; eksik görseller: ' + missingArt.join(', '));
}

const raw = JSON.stringify({ vols });
const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);

const body =
  '/* otomatik üretildi: scripts/build_bundle.js — elle düzenlemeyin */\n' +
  'window.ALYA_BUNDLE=' + raw + ';\n' +
  'window.ALYA_BUNDLE_VERSION=' + JSON.stringify(hash) + ';\n';

const artBody =
  '/* otomatik üretildi: scripts/build_bundle.js — illüstrasyon görselleri (data URI) */\n' +
  'window.ALYA_ART=' + JSON.stringify(art) + ';\n';

fs.writeFileSync(OUT, body);
fs.writeFileSync(ART_OUT, artBody);

if (fs.existsSync(SW_OUT)) {
  const swHasher = crypto.createHash('sha1').update(body).update(artBody);
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
console.log('illüstrasyon:', Object.values(art).reduce((a, o) => a + Object.keys(o).length, 0), 'görsel |',
  (artBody.length / 1048576).toFixed(2), 'MB');
const kb = (body.length / 1024).toFixed(0);
console.log('yazıldı:', path.relative(ROOT, OUT), kb + ' KB', '| sürüm:', hash);
for (const [k, b] of Object.entries(vols)) {
  const paras = b.pages.reduce((a, p) => a + p.tr.length, 0);
  console.log('  Cilt ' + k + ':', b.total, 'sayfa |', paras, 'paragraf |', b.chapters.length, 'bölüm');
}
