// Tarayıcıya gömülecek veri paketi: Cilt 4 – 12 Türkçe + İngilizce + bölümler.
// Sunucuya ihtiyaç duymadan okuma için public/bundle.js ve public/bundle-art.js üretir
// ve public/sw.js önbellek sürümünü (VERSION) deterministik olarak damgalar.
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

function loadExistingArt(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const src = fs.readFileSync(filePath, 'utf8');
  const ctx = { window: {} };
  vm.runInNewContext(src, ctx, { timeout: 2000 });
  if (!ctx.window.ALYA_ART || typeof ctx.window.ALYA_ART !== 'object') {
    throw new Error('Mevcut bundle-art.js içinde geçerli window.ALYA_ART bulunamadı');
  }
  return ctx.window.ALYA_ART;
}

const prevArt = loadExistingArt(ART_OUT);
const vols = {};
const art = {};

for (const k of Object.keys(prevArt)) {
  if (prevArt[k] && typeof prevArt[k] === 'object') {
    art[k] = { ...prevArt[k] };
  }
}

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
  const scanDir = path.join(ROOT, cfg.imgDir);
  let allScansPresent = fs.existsSync(scanDir);
  for (const p of book.pages) {
    const fileName = String(p.n).padStart(3, '0') + '.webp';
    p.img = cfg.relImgPrefix + fileName;
    if (allScansPresent && !fs.existsSync(path.join(scanDir, fileName))) {
      allScansPresent = false;
    }
  }
  book.scansAvailable = Boolean(allScansPresent);
  vols[k] = book;

  // Cilt 4 ve 4.5 için ham görsel klasörü gitignore'da olduğundan mevcut gömülü data URI'leri koru
  if (k === '4' || k === '4.5') {
    if (!art[k]) art[k] = {};
    if (fs.existsSync(scanDir)) {
      for (const p of book.pages) {
        if (!p.art) continue;
        const pad = String(p.n).padStart(3, '0');
        const f = path.join(scanDir, `${pad}.webp`);
        if (fs.existsSync(f)) {
          art[k][pad] = 'data:image/webp;base64,' + fs.readFileSync(f).toString('base64');
        }
      }
    }
  }
}

// Temiz kurulumda hiçbir gömülü veya beklenen illüstrasyonun kaybolmadığını doğrula
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
  const cfg = VOLUMES[k];
  for (const p of book.pages) {
    if (!p.art) continue;
    const pageKey = String(p.n).padStart(3, '0');
    if (k === '4' || k === '4.5') {
      const uri = art[k] && art[k][pageKey];
      if (typeof uri !== 'string' || !uri.startsWith('data:image/')) {
        const label = 'Cilt ' + k + ' s.' + pageKey;
        if (!missingArt.includes(label)) missingArt.push(label);
      }
    } else {
      const diskPath = path.join(ROOT, cfg.imgDir, `${pageKey}.webp`);
      const uri = art[k] && art[k][pageKey];
      if (!fs.existsSync(diskPath) && (typeof uri !== 'string' || !uri.startsWith('data:image/'))) {
        const label = 'Cilt ' + k + ' s.' + pageKey;
        if (!missingArt.includes(label)) missingArt.push(label);
      }
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

console.log(
  'illüstrasyon (gömülü Cilt 4/4.5):',
  Object.values(art).reduce((a, o) => a + Object.keys(o).length, 0),
  'görsel |',
  (artBody.length / 1048576).toFixed(2),
  'MB',
);
const kb = (body.length / 1024).toFixed(0);
console.log('yazıldı:', path.relative(ROOT, OUT), kb + ' KB', '| sürüm:', hash);
for (const [k, b] of Object.entries(vols)) {
  const paras = b.pages.reduce((a, p) => a + p.tr.length, 0);
  console.log('  Cilt ' + k + ':', b.total, 'sayfa |', paras, 'paragraf |', b.chapters.length, 'bölüm');
}
