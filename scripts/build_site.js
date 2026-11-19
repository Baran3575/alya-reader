#!/usr/bin/env node
// GitHub Pages statik site derleyicisi -> dist/
// public/ içeriğini, pages5..pages12 görsellerini ve books/{v,bundle-en-}*.json statik kitap parçalarını dist/ dizinine üretir.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, VOLUME_KEYS, VOLUMES } = require('./lib/volumes');

const DIST = path.join(ROOT, 'dist');
const PUB = path.join(ROOT, 'public');

// 1) Önce güncel bundle.js / bundle-art.js üret
execFileSync(process.execPath, [path.join(__dirname, 'build_bundle.js')], { stdio: 'inherit' });

// 2) dist/ dizinini temizle ve public/ ağacını (.bak yedekleri hariç) kopyala
fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(PUB, DIST, {
  recursive: true,
  filter: (src) => !src.endsWith('.bak'),
});
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

// 3) Statik /books/v<vol>.json + /books/bundle-en-<vol>.json parçalarını ve görsel bütünlüğünü doğrula
const booksDir = path.join(DIST, 'books');
fs.mkdirSync(booksDir, { recursive: true });

let builtCount = 0;
let missingAssets = 0;

for (const k of VOLUME_KEYS) {
  const cfg = VOLUMES[k];
  if (!fs.existsSync(cfg.sourceFile) || !fs.existsSync(cfg.finalFile)) continue;

  const vPath = path.join(booksDir, `v${k}.json`);
  const enPath = path.join(booksDir, `bundle-en-${k}.json`);
  if (!fs.existsSync(vPath) || !fs.existsSync(enPath)) {
    console.error(`✗ Eksik cilt parçası (Cilt ${k}): books/v${k}.json veya books/bundle-en-${k}.json`);
    missingAssets++;
    continue;
  }

  const book = JSON.parse(fs.readFileSync(vPath, 'utf8'));
  for (const p of book.pages) {
    if ('en' in p) {
      console.error(`✗ books/v${k}.json sayfa ${p.n} içinde p.en kalıntısı var`);
      missingAssets++;
    }
    if (p.art && k !== '4' && k !== '4.5') {
      const assetPath = path.join(DIST, p.img);
      if (!fs.existsSync(assetPath)) {
        console.error(`✗ Eksik illüstrasyon dosyası (Cilt ${k}): ${p.img}`);
        missingAssets++;
      }
    }
  }

  builtCount++;
}

if (missingAssets > 0) {
  console.error(`✗ Statik derleme başarısız: ${missingAssets} varlık/parça doğrulaması başarısız.`);
  process.exit(1);
}

console.log(`✓ Statik site hazır: dist/ (${builtCount} cilt, .nojekyll + books/v*.json + books/bundle-en-*.json + WebP varlıkları doğrulandı).`);
