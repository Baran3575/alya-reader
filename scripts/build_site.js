#!/usr/bin/env node
// GitHub Pages statik site derleyicisi -> dist/
// public/ içeriğini, pages..pages12 görsellerini ve books/{v<vol>,<vol>,art-<vol>,index}.json statik paketlerini dist/ dizinine üretir.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { ROOT, VOLUME_KEYS, VOLUMES } = require('./lib/volumes');

const DIST = path.join(ROOT, 'dist');
const PUB = path.join(ROOT, 'public');

// 1) bundle.js, bundle-art.js ve public/books/* parçalarını güncelle
execFileSync(process.execPath, [path.join(__dirname, 'build_bundle.js')], { stdio: 'inherit' });

// 2) dist/ dizinini sıfırla ve public/ içeriğini kopyala
fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(PUB, DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

try {
  const bundleCode = fs.readFileSync(path.join(PUB, 'bundle.js'), 'utf8');
  const sbManifest = { window: {} };
  vm.runInNewContext(bundleCode, sbManifest, { timeout: 2000 });
  if (Array.isArray(sbManifest.window.ALYA_VOLUMES)) {
    fs.mkdirSync(path.join(DIST, 'books'), { recursive: true });
    fs.writeFileSync(
      path.join(DIST, 'books', 'index.json'),
      JSON.stringify(
        {
          version: sbManifest.window.ALYA_BUNDLE_VERSION || 'static',
          volumes: sbManifest.window.ALYA_VOLUMES,
        },
        null,
        2
      ) + '\n'
    );
  }
} catch {}

// 3) Cilt 4 ve 4.5 için gömülü ALYA_ART illüstrasyonlarını dist/pages* altına da aç
let embeddedArt = {};
try {
  const artCode = fs.readFileSync(path.join(PUB, 'bundle-art.js'), 'utf8');
  const sb = { window: {} };
  vm.runInNewContext(artCode, sb, { timeout: 2000 });
  embeddedArt = sb.window.ALYA_ART || {};
} catch {}

for (const k of ['4', '4.5']) {
  const pack = embeddedArt[k] || {};
  const entries = Object.entries(pack);
  if (entries.length === 0) continue;
  const targetDir = path.join(DIST, VOLUMES[k].relImgPrefix);
  fs.mkdirSync(targetDir, { recursive: true });
  for (const [pad, uri] of entries) {
    const m = typeof uri === 'string' && uri.match(/^data:image\/webp;base64,(.+)$/);
    if (m) fs.writeFileSync(path.join(targetDir, `${pad}.webp`), Buffer.from(m[1], 'base64'));
  }
}

// 4) Tüm ciltlerin JSON parçalarını ve WebP varlıklarını doğrula
let builtCount = 0;
let missingAssets = 0;

for (const k of VOLUME_KEYS) {
  const vChunk = path.join(DIST, 'books', `v${k}.json`);
  if (!fs.existsSync(vChunk)) {
    console.error(`✗ Eksik kitap parçası: books/v${k}.json`);
    missingAssets++;
    continue;
  }
  const book = JSON.parse(fs.readFileSync(vChunk, 'utf8'));
  for (const p of book.pages) {
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
  console.error(`✗ Statik derleme başarısız: ${missingAssets} varlık eksik.`);
  process.exit(1);
}

console.log(`✓ Statik site hazır: dist/ (${builtCount} cilt, .nojekyll + books/v*.json + WebP varlıkları doğrulandı).`);
