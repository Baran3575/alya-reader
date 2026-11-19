#!/usr/bin/env node
// GitHub Pages statik site derleyicisi -> dist/
// Tembel yüklenen Türkçe cilt JSON parçalarını (public/bundles/vol-<slug>.json), manifest.json dosyasını
// ve bağımsız ikili .webp illüstrasyonları (public/art/vol-<slug>/) dist/ dizinine üretir ve doğrular.
const fs = require('fs');
const path = require('path');
const { buildBundles } = require('./build_bundle');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PUB = path.join(ROOT, 'public');

// 1) Önce güncel manifest.json, vol-<slug>.json ve art/vol-<slug>/*.webp çıktılarını üret
const { manifest } = buildBundles(ROOT);

// 2) dist/ dizinini temizle, public/ ağacını kopyala ve eski .bak yedeklerini ayıkla
fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(PUB, DIST, { recursive: true });
for (const entry of fs.readdirSync(DIST)) {
  if (entry.endsWith('.bak')) {
    fs.rmSync(path.join(DIST, entry), { force: true });
  }
}
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

// 3) Tembel yüklenen JSON parçalarını ve WebP görsel bütünlüğünü doğrula
let missingAssets = 0;
let verifiedChunks = 0;

for (const id of manifest.order) {
  const meta = manifest.volumes[id];
  const chunkPath = path.join(DIST, meta.file);
  if (!fs.existsSync(chunkPath)) {
    console.error(`✗ Eksik cilt JSON paketi (${meta.label}): ${meta.file}`);
    missingAssets++;
    continue;
  }

  const book = JSON.parse(fs.readFileSync(chunkPath, 'utf8'));
  for (const p of book.pages) {
    if ('en' in p) {
      console.error(`✗ İstenmeyen p.en alanı bulundu (${meta.label}, sayfa ${p.n})`);
      missingAssets++;
    }
    if (p.art) {
      const assetPath = path.join(DIST, String(p.img || '').replace(/^\/+/, ''));
      if (!fs.existsSync(assetPath)) {
        console.error(`✗ Eksik illüstrasyon dosyası (${meta.label}): ${p.img}`);
        missingAssets++;
      }
    }
  }
  verifiedChunks++;
}

if (missingAssets > 0) {
  console.error(`✗ Statik derleme başarısız: ${missingAssets} varlık/şema hatası bulundu.`);
  process.exit(1);
}

console.log(
  `✓ Statik site hazır: dist/ (${verifiedChunks} cilt, .nojekyll + bundles/manifest.json + vol-*.json + WebP varlıkları doğrulandı).`
);
