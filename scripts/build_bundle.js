// Tarayıcıya gömülecek veri paketi: Türkçe + İngilizce + bölümler (iki cilt).
// Sunucuya ihtiyaç duymadan okuma için public/bundle.js üretir.
// Kullanım: node scripts/build_bundle.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildBook } = require('../server.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'bundle.js');
const ART_OUT = path.join(ROOT, 'public', 'bundle-art.js');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'volumes.json'), 'utf8'));
const ENABLED = MANIFEST.filter((entry) => entry.enabled);

let existingArt = {};
if (fs.existsSync(ART_OUT)) {
  try {
    const prev = fs.readFileSync(ART_OUT, 'utf8');
    const m = prev.match(/window\.ALYA_ART\s*=\s*(\{[\s\S]*\});/);
    if (m) existingArt = JSON.parse(m[1]);
  } catch {}
}

const vols = {};
const art = {};
const volumeMeta = [];

for (const entry of ENABLED) {
  const id = String(entry.id);
  const srcPath = path.join(ROOT, entry.dataDir, 'source.json');
  if (!fs.existsSync(srcPath)) {
    console.warn('uyarı: ' + entry.label + ' kaynak dosyası yok (' + entry.dataDir + '/source.json), yalnız üstveri eklendi.');
    volumeMeta.push({
      id,
      label: entry.label,
      subtitle: entry.subtitle || '',
      imgPrefix: entry.imgPrefix,
      status: entry.status || 'complete',
      statusNote: entry.statusNote || '',
      total: 0,
      chapterCount: 0,
    });
    continue;
  }
  const book = buildBook({
    ...entry,
    id,
    volume: entry.label,
    titlesFile: path.join(ROOT, entry.chaptersFile),
  });
  const relPrefix = String(entry.imgPrefix || '/pages/').replace(/^\/+/, '');
  art[id] = {};

  for (const p of book.pages) {
    const pageKey = String(p.n).padStart(3, '0');
    p.img = relPrefix + pageKey + '.webp';
    if (!p.art) continue;
    const f = path.join(ROOT, 'public', relPrefix, pageKey + '.webp');
    if (fs.existsSync(f)) {
      const b64 = fs.readFileSync(f).toString('base64');
      art[id][pageKey] = 'data:image/webp;base64,' + b64;
    } else if (existingArt[id] && existingArt[id][pageKey]) {
      art[id][pageKey] = existingArt[id][pageKey];
    }
  }

  vols[id] = book;
  volumeMeta.push({
    id,
    label: entry.label,
    subtitle: entry.subtitle || '',
    imgPrefix: entry.imgPrefix,
    status: entry.status || 'complete',
    statusNote: entry.statusNote || '',
    total: book.total,
    chapterCount: book.chapters.length,
  });
}

const raw = JSON.stringify({ vols });
const volumesRaw = JSON.stringify(volumeMeta);
const hash = crypto
  .createHash('sha1')
  .update(volumesRaw + '\n' + raw)
  .digest('hex')
  .slice(0, 12);

const body =
  '/* otomatik üretildi: scripts/build_bundle.js — elle düzenlemeyin */\n' +
  'window.ALYA_VOLUMES=' + volumesRaw + ';\n' +
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
  'görsel |',
  (artBody.length / 1048576).toFixed(2),
  'MB'
);
const kb = (body.length / 1024).toFixed(0);
console.log('yazıldı:', path.relative(ROOT, OUT), kb + ' KB', '| sürüm:', hash);
for (const [k, b] of Object.entries(vols)) {
  const paras = b.pages.reduce((a, p) => a + p.tr.length, 0);
  console.log('  ' + b.volume + ' (#' + k + '):', b.total, 'sayfa |', paras, 'paragraf |', b.chapters.length, 'bölüm');
}
