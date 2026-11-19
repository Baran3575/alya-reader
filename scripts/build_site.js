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

function removeBakFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removeBakFiles(full);
    } else if (entry.name.endsWith('.bak')) {
      fs.rmSync(full, { force: true });
    }
  }
}

// 1) Önce güncel bundle.js / bundle-art.js üret ve sw.js sürümünü damgala
execFileSync(process.execPath, [path.join(__dirname, 'build_bundle.js')], { stdio: 'inherit' });

// 2) dist/ dizinini temizle, public/ ağacını kopyala, ham tarama/yedek dosyalarını ayıkla
fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(PUB, DIST, { recursive: true });
fs.rmSync(path.join(DIST, 'pages'), { recursive: true, force: true });
fs.rmSync(path.join(DIST, 'pages45'), { recursive: true, force: true });
removeBakFiles(DIST);
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
  book.scansAvailable = false;

  fs.writeFileSync(path.join(booksDir, `${k}.json`), JSON.stringify(book));
  builtCount++;
}

for (const reqFile of ['index.html', 'style.css', 'app.js', 'bundle.js', 'bundle-art.js', 'sw.js']) {
  if (!fs.existsSync(path.join(DIST, reqFile))) {
    console.error(`✗ Eksik statik kabuk dosyası: ${reqFile}`);
    missingAssets++;
  }
}

if (missingAssets > 0) {
  console.error(`✗ Statik derleme başarısız: ${missingAssets} varlık eksik.`);
  process.exit(1);
}

console.log(`✓ Statik site hazır: dist/ (${builtCount} cilt, .nojekyll + books/*.json + WebP varlıkları doğrulandı).`);
