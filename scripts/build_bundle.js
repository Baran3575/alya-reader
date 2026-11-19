// Tarayıcıya gömülecek veri paketi: Cilt 4 – 12 Türkçe + İngilizce + bölümler + üstveri.
// Sunucuya ihtiyaç duymadan okuma için public/bundle.js ve public/bundle-art.js üretir.
// Kullanım: node scripts/build_bundle.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { buildBook } = require('../server.js');
const { ROOT, ENABLED_VOLUME_KEYS, VOLUMES } = require('./lib/volumes');

const OUT = path.join(ROOT, 'public', 'bundle.js');
const ART_OUT = path.join(ROOT, 'public', 'bundle-art.js');

function loadExistingArtBundle() {
  if (!fs.existsSync(ART_OUT)) return {};
  try {
    const code = fs.readFileSync(ART_OUT, 'utf8');
    const sandbox = { window: {} };
    vm.runInNewContext(code, sandbox, { timeout: 2000 });
    return sandbox.window.ALYA_ART || {};
  } catch {
    return {};
  }
}

const existingArt = loadExistingArtBundle();
const vols = {};
const art = {};
const volumeMeta = [];

for (const id of ENABLED_VOLUME_KEYS) {
  const cfg = VOLUMES[id];
  if (!fs.existsSync(cfg.sourceFile) || !fs.existsSync(cfg.finalFile)) {
    console.warn('uyarı: ' + cfg.label + ' kaynak dosyası yok (' + cfg.dataDir + '), yalnız üstveri eklendi.');
    volumeMeta.push({
      id,
      label: cfg.label,
      subtitle: cfg.subtitle || '',
      imgPrefix: cfg.imgPrefix,
      embedArt: Boolean(cfg.embedArt),
      status: cfg.status || 'complete',
      statusNote: cfg.statusNote || '',
      total: 0,
      chapterCount: 0,
    });
    continue;
  }

  const book = buildBook({
    ...cfg,
    id,
    volume: cfg.label,
    titlesFile: cfg.titlesFile,
  });

  // Statik barındırma (GitHub Pages alt dizini dahil) için göreli görsel yolları kullan
  for (const p of book.pages) {
    p.img = cfg.relImgPrefix + String(p.n).padStart(3, '0') + '.webp';
  }
  vols[id] = book;

  // Ham görsel dizini gitignore'da olan ciltler (embedArt: true) için gömülü data URI'leri koru
  if (cfg.embedArt) {
    art[id] = { ...(existingArt[id] || {}) };
    const diskDir = path.join(ROOT, cfg.imgDir);
    if (fs.existsSync(diskDir)) {
      for (const p of book.pages) {
        if (!p.art) continue;
        const pad = String(p.n).padStart(3, '0');
        const f = path.join(diskDir, `${pad}.webp`);
        if (fs.existsSync(f)) {
          art[id][pad] = 'data:image/webp;base64,' + fs.readFileSync(f).toString('base64');
        }
      }
    }
  }

  volumeMeta.push({
    id,
    label: cfg.label,
    subtitle: cfg.subtitle || '',
    imgPrefix: cfg.imgPrefix,
    embedArt: Boolean(cfg.embedArt),
    status: cfg.status || 'complete',
    statusNote: cfg.statusNote || '',
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
  'illüstrasyon (gömülü):',
  Object.values(art).reduce((a, o) => a + Object.keys(o).length, 0),
  'görsel |',
  (artBody.length / 1048576).toFixed(2),
  'MB'
);
const kb = (body.length / 1024).toFixed(0);
console.log('yazıldı:', path.relative(ROOT, OUT), kb + ' KB', '| sürüm:', hash);
for (const k of ENABLED_VOLUME_KEYS) {
  const b = vols[k];
  if (!b) continue;
  const paras = b.pages.reduce((a, p) => a + p.tr.length, 0);
  console.log('  ' + b.volume + ' (#' + k + '):', b.total, 'sayfa |', paras, 'paragraf |', b.chapters.length, 'bölüm');
}
