// Tembel (lazy) cilt paketleri ve manifest üreticisi (Cilt 4 – 12).
// Sunucuya ihtiyaç duymadan (GitHub Pages veya file://) okuma için:
//   - public/bundles/manifest.js (< 10 KB)
//   - public/bundles/book-<cilt>.json (Türkçe + bölüm üstverisi, fetch + CacheStorage için)
//   - public/bundles/book-<cilt>.js (file:// Türkçe yedek yükleyici)
//   - public/bundles/bundle-en-<cilt>.json ("Orijinal" modu İngilizce metin parçası)
//   - public/bundles/bundle-en-<cilt>.js (file:// İngilizce yedek yükleyici)
//   - public/bundles/art/<cilt>/<sayfa>.webp (Cilt 4 ve 4.5 illüstrasyon görselleri)
// Kullanım: node scripts/build_bundle.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildBook, buildBookEn, VOLUMES, VOLUME_KEYS } = require('../server.js');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const BUNDLES_DIR = path.join(PUB, 'bundles');
const LEGACY_BUNDLE = path.join(PUB, 'bundle.js');
const LEGACY_ART = path.join(PUB, 'bundle-art.js');

fs.mkdirSync(BUNDLES_DIR, { recursive: true });

// Eski tek parça bundle-art.js varsa, silmeden önce WebP dosyalarını çıkar
if (fs.existsSync(LEGACY_ART)) {
  try {
    const rawArt = fs.readFileSync(LEGACY_ART, 'utf8');
    const match = rawArt.match(/window\.ALYA_ART\s*=\s*(\{[\s\S]*\})\s*;?/);
    if (match) {
      const parsed = JSON.parse(match[1]);
      for (const [volKey, entries] of Object.entries(parsed)) {
        const outArtDir = path.join(BUNDLES_DIR, 'art', String(volKey));
        fs.mkdirSync(outArtDir, { recursive: true });
        for (const [nnn, dataUri] of Object.entries(entries || {})) {
          const outFile = path.join(outArtDir, String(nnn).padStart(3, '0') + '.webp');
          if (fs.existsSync(outFile)) continue;
          const b64 = String(dataUri).split(',')[1];
          if (b64) fs.writeFileSync(outFile, Buffer.from(b64, 'base64'));
        }
      }
    }
  } catch (err) {
    console.warn('Uyarı: eski bundle-art.js okunamadı:', err.message);
  }
}

const manifestVolumes = {};
const hashAccumulator = crypto.createHash('sha1');
let totalArtCount = 0;
let totalArtBytes = 0;

for (const volKey of VOLUME_KEYS) {
  const cfg = VOLUMES[volKey];
  if (!cfg) continue;
  const srcPath = path.join(ROOT, cfg.dataDir, 'source.json');
  const trPath = path.join(ROOT, cfg.dataDir, 'paragraphs_final.json');
  if (!fs.existsSync(srcPath) || !fs.existsSync(trPath)) continue;

  const relImgPrefix = String(cfg.imgPrefix || 'pages/').replace(/^\/+/, '');
  const usesBundledArt = volKey === '4' || volKey === '4.5';
  const artRelDir = usesBundledArt ? `bundles/art/${volKey}/` : relImgPrefix;
  const outArtDir = path.join(PUB, artRelDir);
  if (usesBundledArt) fs.mkdirSync(outArtDir, { recursive: true });

  const book = buildBook({ ...cfg, volKey });
  const bookEn = buildBookEn({ ...cfg, volKey });

  // Yerel sayfa taramaları mevcutsa illüstrasyon WebP dosyalarını güncelle ve doğrula
  for (const p of book.pages) {
    const nnn = String(p.n).padStart(3, '0');
    if (p.art) {
      if (usesBundledArt) {
        const localScan = path.join(PUB, relImgPrefix, nnn + '.webp');
        const bundledArt = path.join(outArtDir, nnn + '.webp');
        if (fs.existsSync(localScan)) {
          fs.copyFileSync(localScan, bundledArt);
        }
        if (fs.existsSync(bundledArt)) {
          p.img = artRelDir + nnn + '.webp';
          totalArtCount += 1;
          totalArtBytes += fs.statSync(bundledArt).size;
        } else {
          p.img = relImgPrefix + nnn + '.webp';
        }
      } else {
        p.img = relImgPrefix + nnn + '.webp';
        const diskImg = path.join(PUB, p.img);
        if (fs.existsSync(diskImg)) {
          totalArtCount += 1;
          totalArtBytes += fs.statSync(diskImg).size;
        }
      }
    } else {
      p.img = relImgPrefix + nnn + '.webp';
    }
    delete p.en;
  }

  const jsonRel = `bundles/book-${volKey}.json`;
  const jsRel = `bundles/book-${volKey}.js`;
  const enJsonRel = `bundles/bundle-en-${volKey}.json`;
  const enJsRel = `bundles/bundle-en-${volKey}.js`;

  const rawJson = JSON.stringify(book);
  const rawEnJson = JSON.stringify(bookEn);
  const volHash = crypto.createHash('sha1').update(rawJson).digest('hex').slice(0, 12);
  const enHash = crypto.createHash('sha1').update(rawEnJson).digest('hex').slice(0, 12);
  hashAccumulator.update(`${volKey}:${volHash}:${enHash};`);

  fs.writeFileSync(path.join(PUB, jsonRel), rawJson);
  fs.writeFileSync(path.join(PUB, enJsonRel), rawEnJson);

  const jsBody =
    '/* otomatik üretildi: scripts/build_bundle.js — elle düzenlemeyin */\n' +
    '(window.ALYA_CHUNKS=window.ALYA_CHUNKS||{})[' +
    JSON.stringify(volKey) +
    ']=' +
    rawJson +
    ';\n';
  fs.writeFileSync(path.join(PUB, jsRel), jsBody);

  const enJsBody =
    '/* otomatik üretildi: scripts/build_bundle.js — elle düzenlemeyin */\n' +
    '(window.ALYA_EN_CHUNKS=window.ALYA_EN_CHUNKS||{})[' +
    JSON.stringify(volKey) +
    ']=' +
    rawEnJson +
    ';\n';
  fs.writeFileSync(path.join(PUB, enJsRel), enJsBody);

  manifestVolumes[volKey] = {
    volume: book.volume,
    total: book.total,
    chapters: book.chapters.length,
    fullScans: Boolean(book.fullScans),
    hash: volHash,
    enHash,
    json: jsonRel,
    js: jsRel,
    enJson: enJsonRel,
    enJs: enJsRel,
  };

  const paras = book.pages.reduce((acc, p) => acc + p.tr.length, 0);
  const enPages = Object.keys(bookEn.pages).length;
  console.log(
    `  Cilt ${volKey.padEnd(4)}:`,
    `${String(book.total).padStart(3)} sayfa |`,
    `${String(paras).padStart(4)} TR paragraf |`,
    `${String(enPages).padStart(3)} EN sayfa |`,
    `${String(book.chapters.length).padStart(2)} bölüm |`,
    `TR ${(Buffer.byteLength(rawJson) / 1024).toFixed(1)} KB + EN ${(Buffer.byteLength(rawEnJson) / 1024).toFixed(1)} KB`
  );
}

const version = hashAccumulator.digest('hex').slice(0, 12);
const order = VOLUME_KEYS.filter((k) => Boolean(manifestVolumes[k]));
const defaultVol = manifestVolumes['4'] ? '4' : order[0] || '4';
const manifest = {
  version,
  defaultVol,
  order,
  volumes: manifestVolumes,
};

const manifestPath = path.join(BUNDLES_DIR, 'manifest.js');
const manifestBody =
  '/* otomatik üretildi: scripts/build_bundle.js — elle düzenlemeyin */\n' +
  'window.ALYA_MANIFEST=' +
  JSON.stringify(manifest) +
  ';\n';

fs.writeFileSync(manifestPath, manifestBody);

// Eski bloklayıcı tek parça paketleri kaldır
fs.rmSync(LEGACY_BUNDLE, { force: true });
fs.rmSync(LEGACY_ART, { force: true });

console.log(
  'manifest:',
  path.relative(ROOT, manifestPath),
  Buffer.byteLength(manifestBody) + ' B',
  '| sürüm:',
  version
);
console.log(
  'illüstrasyon:',
  totalArtCount,
  'WebP görsel |',
  (totalArtBytes / 1048576).toFixed(2) + ' MB (istek üzerine tembel yüklenir)'
);
