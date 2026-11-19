// Tarayıcıya gömülecek veri paketi: Cilt 4 – 12 Türkçe + İngilizce + bölümler (kayıtlı tüm ciltler).
// İlk yüklemenin hafif kalması için public/bundle.js içine yalnızca cilt manifesti,
// public/books/v<cilt>.json ve public/books/art-<cilt>.json içine ise cilt parçaları üretir.
// Kullanım: node scripts/build_bundle.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { buildBook } = require('../server.js');
const { ROOT, VOLUME_KEYS, VOLUMES } = require('./lib/volumes');

function loadExistingArt(artFile) {
  if (!artFile || !fs.existsSync(artFile)) return {};
  try {
    const src = fs.readFileSync(artFile, 'utf8');
    const trimmed = src.trim();
    if (trimmed.startsWith('{')) return JSON.parse(trimmed);
    const match = src.match(/window\.ALYA_ART\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
    if (match) return JSON.parse(match[1]);
    const ctx = { window: {} };
    vm.runInNewContext(src, ctx, { timeout: 2000 });
    if (ctx.window.ALYA_ART && typeof ctx.window.ALYA_ART === 'object') {
      return ctx.window.ALYA_ART;
    }
  } catch {}
  return {};
}

function loadVolumeSeedArt(rootDir, dataDir, booksDir, volKey) {
  const candidates = [
    path.join(rootDir, dataDir, 'art.json'),
    booksDir ? path.join(booksDir, 'art-' + volKey + '.json') : null,
    path.join(rootDir, 'public', 'books', 'art-' + volKey + '.json'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        return parsed;
      }
    } catch {}
  }
  return {};
}

function normalizeImgPrefix(prefix) {
  const clean = String(prefix || '/pages/').replace(/^\/+/, '');
  return clean.endsWith('/') ? clean : clean + '/';
}

function buildBundles(opt = {}) {
  const rootDir = opt.rootDir || ROOT;
  const outDir = opt.outDir || path.join(rootDir, 'public');
  const booksDir = opt.booksDir !== undefined ? opt.booksDir : path.join(outDir, 'books');
  const emitLegacyBookFiles = Boolean(opt.emitLegacyBookFiles);
  const volumes = opt.volumes || VOLUMES;
  const orderedKeys = opt.volumes ? Object.keys(opt.volumes) : VOLUME_KEYS.filter((k) => volumes[k]);
  const artSourceFile =
    opt.artSourceFile !== undefined ? opt.artSourceFile : path.join(rootDir, 'public', 'bundle-art.js');
  const quiet = Boolean(opt.quiet);

  fs.mkdirSync(outDir, { recursive: true });

  const existingArt = loadExistingArt(artSourceFile);
  const vols = {};
  const art = {};

  for (const [volKey, existingEntries] of Object.entries(existingArt)) {
    if (existingEntries && typeof existingEntries === 'object' && Object.keys(existingEntries).length > 0) {
      art[volKey] = { ...existingEntries };
    }
  }

  for (const k of orderedKeys) {
    const cfg = volumes[k];
    if (!cfg) continue;
    const dataDir = cfg.dataDir || 'data';
    const sourceFile = opt.rootDir
      ? path.join(rootDir, dataDir, 'source.json')
      : cfg.sourceFile || path.join(rootDir, dataDir, 'source.json');
    const finalFile = opt.rootDir
      ? path.join(rootDir, dataDir, 'paragraphs_final.json')
      : cfg.finalFile || path.join(rootDir, dataDir, 'paragraphs_final.json');
    if (!fs.existsSync(sourceFile) || !fs.existsSync(finalFile)) continue;

    const relPrefix = normalizeImgPrefix(cfg.relImgPrefix || cfg.imgPrefix);
    const titlesFile = cfg.titlesFile
      ? path.isAbsolute(cfg.titlesFile) && opt.rootDir
        ? path.join(rootDir, dataDir, 'chapters.json')
        : cfg.titlesFile
      : path.join(rootDir, dataDir, 'chapters.json');
    const volumeLabel = cfg.volume || cfg.label || 'Cilt ' + k;

    const book = buildBook({
      ...cfg,
      rootDir,
      dataDir,
      imgPrefix: relPrefix,
      volume: volumeLabel,
      titlesFile,
    });
    for (const p of book.pages) {
      p.img = relPrefix + String(p.n).padStart(3, '0') + '.webp';
    }

    // Cilt 4 ve 4.5'te ham tarama klasörleri gitignore'da olduğundan tohum/mevcut data URI'leri koru
    const seedArt =
      k === '4' || k === '4.5' || cfg.embedArt
        ? loadVolumeSeedArt(rootDir, dataDir, opt.rootDir ? booksDir : null, k)
        : {};
    if (k === '4' || k === '4.5' || cfg.embedArt || existingArt[k] || Object.keys(seedArt).length > 0) {
      art[k] = { ...seedArt, ...(art[k] || {}) };
      const imgDir = path.join(rootDir, 'public', relPrefix);
      const hasDiskDir = fs.existsSync(imgDir);
      if (hasDiskDir) {
        for (const p of book.pages) {
          if (!p.art) continue;
          const pageKey = String(p.n).padStart(3, '0');
          const f = path.join(imgDir, pageKey + '.webp');
          if (fs.existsSync(f)) {
            art[k][pageKey] = 'data:image/webp;base64,' + fs.readFileSync(f).toString('base64');
          }
        }
      } else if ((k === '4' || k === '4.5') && Object.keys(art[k]).length > 0) {
        // Temiz klonlarda ham tarama klasörü yokken yalnızca gömülü illüstrasyonu olan sayfaları işaretle
        for (const p of book.pages) {
          const pageKey = String(p.n).padStart(3, '0');
          p.art = Boolean(art[k][pageKey]);
        }
      }
      if (Object.keys(art[k]).length === 0) {
        delete art[k];
      }
    }

    vols[k] = book;
  }

  const manifestVols = {};
  if (booksDir) {
    fs.mkdirSync(booksDir, { recursive: true });
  }
  for (const [k, book] of Object.entries(vols)) {
    const artEntries = art[k] && Object.keys(art[k]).length > 0 ? art[k] : null;
    if (booksDir) {
      const bookJson = JSON.stringify(book);
      fs.writeFileSync(path.join(booksDir, 'v' + k + '.json'), bookJson);
      if (emitLegacyBookFiles) {
        fs.writeFileSync(path.join(booksDir, k + '.json'), bookJson);
      }
      const artFile = path.join(booksDir, 'art-' + k + '.json');
      if (artEntries) {
        fs.writeFileSync(artFile, JSON.stringify(artEntries));
      } else if (fs.existsSync(artFile)) {
        fs.unlinkSync(artFile);
      }
    }
    manifestVols[k] = {
      label: book.volume || 'Cilt ' + k,
      total: book.total,
      chapters: book.chapters,
      artCount: artEntries ? Object.keys(artEntries).length : 0,
    };
  }

  const raw = JSON.stringify({ vols: manifestVols });
  // Sürüm özeti hem manifesti hem cilt metinlerini kapsasın ki çeviri değiştiğinde önbellek yenilensin
  const versionHasher = crypto.createHash('sha1').update(raw);
  for (const k of Object.keys(vols)) {
    versionHasher.update('\0' + k + '\0');
    versionHasher.update(JSON.stringify(vols[k].pages));
  }
  const hash = versionHasher.digest('hex').slice(0, 12);

  const body =
    '/* otomatik üretildi: scripts/build_bundle.js — elle düzenlemeyin */\n' +
    '/* yalnızca cilt manifesti; metin public/books/v<CİLT>.json dosyalarından yüklenir */\n' +
    'window.ALYA_BUNDLE=' + raw + ';\n' +
    'window.ALYA_BUNDLE_VERSION=' + JSON.stringify(hash) + ';\n';

  const bundleOut = path.join(outDir, 'bundle.js');
  fs.writeFileSync(bundleOut, body);

  const artIndex = Object.fromEntries(
    Object.entries(art).map(([k, v]) => [k, Object.keys(v).length]),
  );
  const artBody =
    '/* otomatik üretildi: scripts/build_bundle.js — illüstrasyon görselleri cilt başına public/books/art-<cilt>.json içinde */\n' +
    'window.ALYA_ART_INDEX=' + JSON.stringify(artIndex) + ';\n';
  const artOut = path.join(outDir, 'bundle-art.js');
  fs.writeFileSync(artOut, artBody);

  const artCount = Object.values(art).reduce((a, o) => a + Object.keys(o).length, 0);
  const artBytes = Object.values(art).reduce((a, o) => a + Buffer.byteLength(JSON.stringify(o)), 0);

  if (!quiet) {
    console.log(
      'illüstrasyon (gömülü Cilt 4/4.5):',
      artCount,
      'görsel |',
      (artBytes / 1048576).toFixed(2),
      'MB',
    );
    const kb = (body.length / 1024).toFixed(0);
    console.log('yazıldı:', path.relative(rootDir, bundleOut), kb + ' KB', '| sürüm:', hash);
    for (const [k, b] of Object.entries(vols)) {
      const paras = b.pages.reduce((a, p) => a + p.tr.length, 0);
      console.log('  Cilt ' + k + ':', b.total, 'sayfa |', paras, 'paragraf |', b.chapters.length, 'bölüm');
    }
  }

  return {
    vols,
    manifestVols,
    art,
    artIndex,
    artCount,
    artBytes,
    bundleBytes: Buffer.byteLength(body),
    hash,
  };
}

if (require.main === module) {
  buildBundles();
}

module.exports = { buildBundles, loadExistingArt, normalizeImgPrefix };
