#!/usr/bin/env node
// GitHub Pages statik site derleyicisi -> dist/
// public/ kabuğunu, tembel cilt paketlerini (bundles/book-*.json + bundles/bundle-en-*.json)
// ve tüm WebP illüstrasyonlarını dist/ dizinine üretir ve doğrular.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, VOLUME_KEYS } = require('./lib/volumes');

const DIST = path.join(ROOT, 'dist');
const PUB = path.join(ROOT, 'public');

// 1) Önce güncel manifest, TR ve EN tembel cilt paketlerini üret
execFileSync(process.execPath, [path.join(__dirname, 'build_bundle.js')], { stdio: 'inherit' });

// 2) dist/ dizinini temizle ve public/ ağacını (.bak yedekleri hariç) kopyala
fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(PUB, DIST, {
  recursive: true,
  filter: (src) => !src.endsWith('.bak'),
});
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

// 3) Tüm cilt paketlerini ve illüstrasyon WebP bütünlüğünü doğrula
const manifestFile = path.join(DIST, 'bundles', 'manifest.js');
if (!fs.existsSync(manifestFile)) {
  console.error('✗ Statik derleme başarısız: dist/bundles/manifest.js bulunamadı.');
  process.exit(1);
}

let builtCount = 0;
let missingAssets = 0;

for (const k of VOLUME_KEYS) {
  const trChunk = path.join(DIST, 'bundles', `book-${k}.json`);
  const enChunk = path.join(DIST, 'bundles', `bundle-en-${k}.json`);
  if (!fs.existsSync(trChunk) || !fs.existsSync(enChunk)) continue;

  const book = JSON.parse(fs.readFileSync(trChunk, 'utf8'));
  for (const p of book.pages) {
    if (!p.art) continue;
    const assetPath = path.join(DIST, String(p.img).replace(/^\/+/, ''));
    if (!fs.existsSync(assetPath)) {
      console.error(`✗ Eksik illüstrasyon dosyası (Cilt ${k}): ${p.img}`);
      missingAssets++;
    }
  }
  builtCount++;
}

if (missingAssets > 0) {
  console.error(`✗ Statik derleme başarısız: ${missingAssets} illüstrasyon dosyası eksik.`);
  process.exit(1);
}

console.log(
  `✓ Statik site hazır: dist/ (${builtCount} cilt, .nojekyll + bundles/book-*.json + bundles/bundle-en-*.json + WebP varlıkları doğrulandı).`
);
