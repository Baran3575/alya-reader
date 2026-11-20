#!/usr/bin/env node
// GitHub Pages statik site derleyicisi -> dist/
// public/ içeriğini, pages5..pages12 görsellerini ve books/<vol>.json statik kitap paketlerini dist/ dizinine üretir.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildBook } = require('../server');
const { ROOT, VOLUME_KEYS, VOLUMES } = require('./lib/volumes');

const DIST = path.join(ROOT, 'dist');
const PUB = path.join(ROOT, 'public');

// 1) Önce güncel bundle.js / bundle-art.js üret
execFileSync(process.execPath, [path.join(__dirname, 'build_bundle.js')], { stdio: 'inherit' });

// 2) dist/ dizinini temizle ve public/ ağacını kopyala
fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(PUB, DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

// 3) Statik /books/<vol>.json dosyalarını üret ve görsel bütünlüğünü doğrula
const booksDir = path.join(DIST, 'books');
fs.mkdirSync(booksDir, { recursive: true });

let builtCount = 0;
let missingAssets = 0;

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
    sources: cfg.sources,
  });

  for (const p of book.pages) {
    p.img = cfg.relImgPrefix + String(p.n).padStart(3, '0') + '.webp';
    if (p.art && k !== '4' && k !== '4.5') {
      const assetPath = path.join(DIST, p.img);
      if (!fs.existsSync(assetPath)) {
        console.error(`✗ Eksik illüstrasyon dosyası (Cilt ${k}): ${p.img}`);
        missingAssets++;
      }
    }
  }

  fs.writeFileSync(path.join(booksDir, `${k}.json`), JSON.stringify(book));
  builtCount++;
}

if (missingAssets > 0) {
  console.error(`✗ Statik derleme başarısız: ${missingAssets} illüstrasyon dosyası eksik.`);
  process.exit(1);
}

console.log(`✓ Statik site hazır: dist/ (${builtCount} cilt, .nojekyll + books/*.json + WebP varlıkları doğrulandı).`);
