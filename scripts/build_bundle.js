// Tarayıcıya gömülecek veri paketi: Türkçe + İngilizce + bölümler (iki cilt).
// Sunucuya ihtiyaç duymadan okuma için public/bundle.js üretir.
// Kullanım: node scripts/build_bundle.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildBook, VOLUMES } = require('../server.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'bundle.js');
const ART_OUT = path.join(ROOT, 'public', 'bundle-art.js');

const registeredVols = VOLUMES || {
  '4': { dataDir: 'data', imgPrefix: '/pages/', volume: 'Cilt 4', titlesFile: path.join(ROOT, 'data/chapters.json') },
  '4.5': { dataDir: 'data45', imgPrefix: '/pages45/', volume: 'Cilt 4.5', titlesFile: path.join(ROOT, 'data45/chapters.json') },
};

const vols = {};
for (const [k, cfg] of Object.entries(registeredVols)) {
  vols[k] = buildBook(cfg);
}

// sayfa görsellerini göreli yoldan yükle (GitHub Pages alt dizin uyumu)
const IMG_BUDGET = 0; // 0 = görselleri gömme, göreli yoldan yükle
for (const [k, book] of Object.entries(vols)) {
  const slug = k === '4' ? '' : k.replace('.', '');
  const prefix = `pages${slug}/`;
  for (const p of book.pages) {
    p.img = prefix + String(p.n).padStart(3, '0') + '.webp';
  }
}

// illüstrasyon sayfalarının görselleri de gömülür (data URI) — sunucusuz inline okuma için
// public/pages*/ dizinleri .gitignore'da olduğundan mevcut bundle-art.js içindeki gömülü görseller korunur
let existingArt = {};
if (fs.existsSync(ART_OUT)) {
  try {
    const prevRaw = fs.readFileSync(ART_OUT, 'utf8');
    const m = prevRaw.match(/window\.ALYA_ART=(\{[\s\S]*\});/);
    if (m) existingArt = JSON.parse(m[1]);
  } catch {}
}

const art = {};
for (const [k, book] of Object.entries(vols)) {
  const slug = k === '4' ? '' : k.replace('.', '');
  const imgDir = `public/pages${slug}/`;
  art[k] = { ...(existingArt[k] || {}) };
  for (const p of book.pages) {
    if (!p.art) continue;
    const key = String(p.n).padStart(3, '0');
    const f = path.join(ROOT, imgDir, key + '.webp');
    if (!fs.existsSync(f)) continue;
    const b64 = fs.readFileSync(f).toString('base64');
    art[k][key] = 'data:image/webp;base64,' + b64;
  }
}

const raw = JSON.stringify({ vols });
const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);

const body =
  '/* otomatik üretildi: scripts/build_bundle.js — elle düzenlemeyin */\n' +
  'window.ALYA_BUNDLE=' + raw + ';\n' +
  'window.ALYA_BUNDLE_VERSION=' + JSON.stringify(hash) + ';\n';

fs.writeFileSync(OUT, body);

const artBody =
  '/* otomatik üretildi: scripts/build_bundle.js — illüstrasyon görselleri (data URI) */\n' +
  'window.ALYA_ART=' + JSON.stringify(art) + ';\n';
fs.writeFileSync(ART_OUT, artBody);
console.log('illüstrasyon:', Object.values(art).reduce((a, o) => a + Object.keys(o).length, 0), 'görsel |',
  (artBody.length / 1048576).toFixed(2), 'MB');
const kb = (body.length / 1024).toFixed(0);
console.log('yazıldı:', path.relative(ROOT, OUT), kb + ' KB', '| sürüm:', hash);
for (const [k, b] of Object.entries(vols)) {
  const paras = b.pages.reduce((a, p) => a + p.tr.length, 0);
  console.log('  Cilt ' + k + ':', b.total, 'sayfa |', paras, 'paragraf |', b.chapters.length, 'bölüm');
}
