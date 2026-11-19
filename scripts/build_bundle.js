// Sunucusuz (GitHub Pages / çevrimdışı) okuma için cilt bazlı tembel yüklenen (lazy-loaded) JSON paketleri üretir.
// Tekil devasa bundle yerine:
//   - public/volumes/<cilt>.json  (her cilt yalnızca açıldığında indirilir)
//   - public/bundle.js            (~2 KB katalog manifestosu ve sürüm özeti)
//   - public/bundle-art.js        (geriye dönük uyumluluk için hafif sarmalayıcı; görseller public/art/ altından tembel yüklenir)
// Kullanım: node scripts/build_bundle.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { VOLUME_ORDER, VOLUMES, buildBook } = require('../server.js');

const ROOT = path.join(__dirname, '..');
const VOL_DIR = path.join(ROOT, 'public', 'volumes');
const OUT_MANIFEST = path.join(ROOT, 'public', 'bundle.js');
const OUT_ART_STUB = path.join(ROOT, 'public', 'bundle-art.js');

fs.mkdirSync(VOL_DIR, { recursive: true });

const catalog = [];
const hashes = [];

for (const key of VOLUME_ORDER) {
  const cfg = VOLUMES[key];
  const book = buildBook(cfg);
  // Statik ortamda tüm görsel yollarının göreli (başında / olmadan) olduğundan emin ol
  for (const p of book.pages) {
    if (p.img && p.img.startsWith('/')) p.img = p.img.slice(1);
    if (p.scanImg && p.scanImg.startsWith('/')) p.scanImg = p.scanImg.slice(1);
  }

  const rawBook = JSON.stringify(book);
  const volHash = crypto.createHash('sha1').update(rawBook).digest('hex').slice(0, 12);
  hashes.push(`${key}:${volHash}`);

  const relFile = `volumes/${key}.json`;
  fs.writeFileSync(path.join(ROOT, 'public', relFile), rawBook);

  const paras = book.pages.reduce((a, p) => a + p.tr.length, 0);
  const arts = book.pages.filter((p) => p.art).length;
  catalog.push({
    key,
    label: cfg.label || key,
    volume: book.volume,
    file: relFile,
    hash: volHash,
    total: book.total,
    chapters: book.chapters.length,
    paragraphs: paras,
    illustrations: arts,
    chapterNative: Boolean(book.chapterNative),
    ongoing: Boolean(book.ongoing),
  });
}

const globalHash = crypto.createHash('sha1').update(hashes.join('|')).digest('hex').slice(0, 12);

const manifestBody =
  '/* otomatik üretildi: scripts/build_bundle.js — elle düzenlemeyin */\n' +
  'window.ALYA_CATALOG=' +
  JSON.stringify(catalog) +
  ';\n' +
  'window.ALYA_BUNDLE_VERSION=' +
  JSON.stringify(globalHash) +
  ';\n' +
  'window.ALYA_BUNDLE={lazy:true,version:' +
  JSON.stringify(globalHash) +
  ',catalog:window.ALYA_CATALOG,vols:{}};\n';

fs.writeFileSync(OUT_MANIFEST, manifestBody);

const artStubBody =
  '/* otomatik üretildi: scripts/build_bundle.js — görseller public/art/ altından tembel yüklenir */\n' +
  'window.ALYA_ART=window.ALYA_ART||{};\n';
fs.writeFileSync(OUT_ART_STUB, artStubBody);

console.log(
  `yazıldı: ${path.relative(ROOT, OUT_MANIFEST)} (${(manifestBody.length / 1024).toFixed(1)} KB) | sürüm: ${globalHash}`
);
for (const c of catalog) {
  const sizeKb = (fs.statSync(path.join(ROOT, 'public', c.file)).size / 1024).toFixed(0);
  console.log(
    `  ${c.volume.padEnd(10)} -> public/${c.file.padEnd(16)} (${sizeKb.padStart(4)} KB) | ${c.total} birim | ${c.paragraphs} paragraf | ${c.chapters} bölüm | ${c.illustrations} görsel`
  );
}
