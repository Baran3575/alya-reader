// Tarayıcıya gömülecek statik veri paketi: Cilt 4, 4.5, 5 ve 6.
// Hem GitHub Pages statik barındırması için public/books/<cilt>.json dosyalarını,
// hem de sunucusuz (file://) okuma için public/bundle.js ve public/bundle-art.js dosyalarını üretir.
// Kullanım: node scripts/build_bundle.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { buildBook, VOLUMES, VOLUME_ORDER } = require('../server.js');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const OUT = path.join(PUB, 'bundle.js');
const ART_OUT = path.join(PUB, 'bundle-art.js');
const BOOKS_DIR = path.join(PUB, 'books');

const vols = {};
for (const k of VOLUME_ORDER) {
  const cfg = VOLUMES[k];
  const book = buildBook(cfg);
  const relPrefix = cfg.imgPrefix.replace(/^\/+/, '');
  for (const p of book.pages) {
    p.img = relPrefix + String(p.n).padStart(3, '0') + '.webp';
  }
  vols[k] = book;
}

// Mevcut bundle-art.js içindeki gömülü görselleri koru (public/pages ve public/pages45 gitignore'dadır)
function loadExistingArt() {
  if (!fs.existsSync(ART_OUT)) return {};
  try {
    const code = fs.readFileSync(ART_OUT, 'utf8');
    const sandbox = { window: {} };
    vm.runInNewContext(code, sandbox, { timeout: 2000 });
    return sandbox.window.ALYA_ART && typeof sandbox.window.ALYA_ART === 'object'
      ? sandbox.window.ALYA_ART
      : {};
  } catch {
    return {};
  }
}

const existingArt = loadExistingArt();
const EMBED_ART_VOLS = ['4', '4.5'];
const art = {};

for (const k of EMBED_ART_VOLS) {
  art[k] = { ...(existingArt[k] || {}) };
  const relDir = VOLUMES[k].imgPrefix.replace(/^\/+/, '');
  const absDir = path.join(PUB, relDir);

  for (const p of vols[k].pages) {
    if (!p.art && p.tr.length > 0) continue;
    const key = String(p.n).padStart(3, '0');
    const f = path.join(absDir, key + '.webp');
    if (fs.existsSync(f)) {
      const b64 = fs.readFileSync(f).toString('base64');
      art[k][key] = 'data:image/webp;base64,' + b64;
    }
  }

  // Statik dağıtım (GitHub Pages vb.) için gömülü görselleri diske de aç
  const entries = Object.entries(art[k]);
  if (entries.length > 0) {
    fs.mkdirSync(absDir, { recursive: true });
    for (const [key, dataUri] of entries) {
      const target = path.join(absDir, key + '.webp');
      if (!fs.existsSync(target) && typeof dataUri === 'string') {
        const m = dataUri.match(/^data:image\/webp;base64,(.+)$/);
        if (m) fs.writeFileSync(target, Buffer.from(m[1], 'base64'));
      }
    }
  }
}

// Her sayfanın statik görselinin (diskte veya ALYA_ART içinde) mevcut olup olmadığını işaretle
for (const k of VOLUME_ORDER) {
  const artPack = art[k] || {};
  for (const p of vols[k].pages) {
    const key = String(p.n).padStart(3, '0');
    const onDisk = fs.existsSync(path.join(PUB, p.img));
    p.hasImg = Boolean(artPack[key] || onDisk);
  }
}

const raw = JSON.stringify({ vols });
const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);

// 1. Cilt bazlı hafif statik JSON dosyaları (GitHub Pages / HTTP statik sunum için)
fs.mkdirSync(BOOKS_DIR, { recursive: true });
const manifestVolumes = [];
for (const k of VOLUME_ORDER) {
  const b = vols[k];
  const volJson = JSON.stringify(b);
  const volHash = crypto.createHash('sha1').update(volJson).digest('hex').slice(0, 12);
  fs.writeFileSync(path.join(BOOKS_DIR, `${k}.json`), volJson);
  manifestVolumes.push({
    id: k,
    short: k,
    label: b.volume,
    total: b.total,
    chapters: b.chapters.length,
    version: volHash,
    file: `books/${k}.json`,
  });
}
fs.writeFileSync(
  path.join(BOOKS_DIR, 'index.json'),
  JSON.stringify({ version: hash, volumes: manifestVolumes }, null, 2) + '\n'
);

// 2. Birleşik JS paketi (file:// ve çevrimdışı yedek için)
const body =
  '/* otomatik üretildi: scripts/build_bundle.js — elle düzenlemeyin */\n' +
  'window.ALYA_VOLUMES=' + JSON.stringify(manifestVolumes) + ';\n' +
  'window.ALYA_BUNDLE=' + raw + ';\n' +
  'window.ALYA_BUNDLE_VERSION=' + JSON.stringify(hash) + ';\n';

fs.writeFileSync(OUT, body);

const artBody =
  '/* otomatik üretildi: scripts/build_bundle.js — illüstrasyon görselleri (data URI) */\n' +
  'window.ALYA_ART=' + JSON.stringify(art) + ';\n';
fs.writeFileSync(ART_OUT, artBody);

console.log(
  'illüstrasyon:',
  Object.values(art).reduce((a, o) => a + Object.keys(o).length, 0),
  'gömülü görsel |',
  (artBody.length / 1048576).toFixed(2),
  'MB'
);
const kb = (body.length / 1024).toFixed(0);
console.log('yazıldı:', path.relative(ROOT, OUT), kb + ' KB', '| sürüm:', hash);
for (const k of VOLUME_ORDER) {
  const b = vols[k];
  const paras = b.pages.reduce((a, p) => a + p.tr.length, 0);
  const vkb = (fs.statSync(path.join(BOOKS_DIR, `${k}.json`)).size / 1024).toFixed(0);
  console.log(
    '  Cilt ' + k + ':',
    b.total,
    'sayfa |',
    paras,
    'paragraf |',
    b.chapters.length,
    'bölüm | books/' + k + '.json (' + vkb + ' KB)'
  );
}
