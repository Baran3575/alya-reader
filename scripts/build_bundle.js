// Tarayıcıya gömülecek veri paketi: Cilt 4 – 12 Türkçe + İngilizce + bölümler.
// Sunucuya ihtiyaç duymadan okuma için public/bundle.js ve public/bundle-art.js üretir.
// Kullanım: node scripts/build_bundle.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { buildBook } = require('../server.js');
const { ROOT, VOLUME_KEYS, VOLUMES } = require('./lib/volumes');

const OUT = path.join(ROOT, 'public', 'bundle.js');
const ART_OUT = path.join(ROOT, 'public', 'bundle-art.js');
const BOOKS_DIR = path.join(ROOT, 'public', 'books');

function loadExistingArtBundle() {
  const result = { data: {}, index: null };
  for (const k of ['4', '4.5']) {
    const chunkFile = path.join(BOOKS_DIR, `art-${k}.json`);
    if (fs.existsSync(chunkFile)) {
      try {
        result.data[k] = JSON.parse(fs.readFileSync(chunkFile, 'utf8'));
      } catch {}
    }
  }

  if (fs.existsSync(ART_OUT)) {
    try {
      const code = fs.readFileSync(ART_OUT, 'utf8');
      const sandbox = { window: {} };
      vm.runInNewContext(code, sandbox, { timeout: 2000 });
      if (sandbox.window.ALYA_ART_INDEX) result.index = sandbox.window.ALYA_ART_INDEX;
      if (sandbox.window.ALYA_ART) {
        for (const k of ['4', '4.5']) {
          if (!result.data[k] && sandbox.window.ALYA_ART[k]) {
            result.data[k] = sandbox.window.ALYA_ART[k];
          }
        }
      }
    } catch {}
  }

  // Temiz klonlarda gitignore altındaki public/pages/ ve public/books/art-*.json yoksa git geçmişinden gömülü veriyi kurtar
  if (!result.data['4'] || !Object.keys(result.data['4']).length) {
    try {
      const revs = execFileSync('git', ['log', '--format=%H', '--', 'public/bundle-art.js'], {
        cwd: ROOT,
        encoding: 'utf8',
      })
        .trim()
        .split(/\r?\n/)
        .filter(Boolean);
      for (const rev of revs) {
        const legacyCode = execFileSync('git', ['show', `${rev}:public/bundle-art.js`], {
          cwd: ROOT,
          encoding: 'utf8',
          maxBuffer: 24 * 1024 * 1024,
        });
        if (!legacyCode.includes('window.ALYA_ART=')) continue;
        const sandbox = { window: {} };
        vm.runInNewContext(legacyCode, sandbox, { timeout: 3000 });
        if (sandbox.window.ALYA_ART) {
          for (const k of ['4', '4.5']) {
            if (!result.data[k] && sandbox.window.ALYA_ART[k]) {
              result.data[k] = sandbox.window.ALYA_ART[k];
            }
          }
          break;
        }
      }
    } catch {}
  }

  return result;
}

const existingArtBundle = loadExistingArtBundle();
const existingArt = existingArtBundle.data;
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
    flip: cfg.flip,
    source: cfg.source,
  });

  // Statik barındırma (GitHub Pages alt dizini dahil) için var olan görsel yollarını göreli yap
  for (const p of book.pages) {
    if (p.img || k === '4' || k === '4.5') {
      p.img = cfg.relImgPrefix + String(p.n).padStart(3, '0') + '.webp';
    }
  }
  vols[k] = book;

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

// cilt başına ayrı JSON parçaları (ilk yükleme hafif olsun)
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
  manifestVols[k] = {
    label: book.volume || 'Cilt ' + k,
    total: book.total,
    chapters: book.chapters,
    scan: book.pages.some((p) => p.scan),
  };
}

// Sürüm damgası: manifest + tarama haritaları + kaynak listesi.
// Böylece yeni sayfa taraması eklendiğinde tarayıcı önbelleği (localStorage) kendiliğinden düşer.
const dataSig = ['4', '4.5', '5', '6', '7', '8', '9', '9.5', '10', '11', '12']
  .map((k) => {
    const dir = k === '4' ? 'data' : 'data' + k.replace('.', '');
    const f = path.join(ROOT, dir, 'scan_map.json');
    return fs.existsSync(f) ? k + ':' + fs.readFileSync(f, 'utf8').length : '';
  })
  .join('|');
// Görsel içerik imzası: bir illüstrasyon dosyası değiştiğinde (aynı ad, yeni çizim)
// istemci önbelleği kendiliğinden düşsün. Yalnızca gövde illüstrasyonları (scan/ hariç).
const imgSigParts = [];
for (const k of ['4', '4.5', '5', '6', '7', '8', '9', '9.5', '10', '11', '12']) {
  const dir = path.join(ROOT, VOLUMES[k].imgDir);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.webp')) continue;
    const fp = path.join(dir, f);
    if (!fs.statSync(fp).isFile()) continue;
    imgSigParts.push(k + '/' + f + ':' + crypto.createHash('sha1').update(fs.readFileSync(fp)).digest('hex').slice(0, 10));
  }
}
const imgSig = imgSigParts.join('|');
const srcSig = fs.existsSync(path.join(ROOT, 'data', 'sources.json'))
  ? fs.readFileSync(path.join(ROOT, 'data', 'sources.json'), 'utf8')
  : '';
const raw = JSON.stringify({ vols: manifestVols });
const hash = crypto
  .createHash('sha1')
  .update(raw + dataSig + srcSig + imgSig)
  .digest('hex')
  .slice(0, 12);

const body =
  '/* otomatik üretildi: scripts/build_bundle.js — elle düzenlemeyin */\n' +
  '/* yalnızca cilt manifesti; metin public/books/v<CİLT>.json dosyalarından yüklenir */\n' +
  'window.ALYA_BUNDLE=' + raw + ';\n' +
  'window.ALYA_BUNDLE_VERSION=' + JSON.stringify(hash) + ';\n';

fs.writeFileSync(OUT, body);

const hasRawV4Dirs =
  fs.existsSync(path.join(ROOT, VOLUMES['4'].imgDir)) || fs.existsSync(path.join(ROOT, VOLUMES['4.5'].imgDir));
const artIndex =
  !hasRawV4Dirs && existingArtBundle.index
    ? existingArtBundle.index
    : Object.fromEntries(Object.entries(art).map(([k, v]) => [k, Object.keys(v).length]));

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
