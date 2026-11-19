#!/usr/bin/env node
// GitHub Pages statik site derleyicisi -> dist/
// public/ içeriğini, pages..pages12 görsellerini ve books/<vol>.json + books/index.json statik kitap paketlerini dist/ dizinine üretir.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
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

// Cilt 4 ve 4.5 için gömülü ALYA_ART illüstrasyonlarını dist/pages* altına da aç
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

// 3) Statik /books/<vol>.json + /books/index.json dosyalarını üret ve görsel bütünlüğünü doğrula
const booksDir = path.join(DIST, 'books');
fs.mkdirSync(booksDir, { recursive: true });

let builtCount = 0;
let missingAssets = 0;
const manifestVolumes = [];
const hashInput = crypto.createHash('sha1');

for (const k of VOLUME_KEYS) {
  const cfg = VOLUMES[k];
  if (!fs.existsSync(cfg.sourceFile) || !fs.existsSync(cfg.finalFile)) continue;

  const book = buildBook({
    dataDir: cfg.dataDir,
    imgPrefix: cfg.imgPrefix,
    volume: cfg.label,
    titlesFile: cfg.titlesFile,
  });

  const artPack = embeddedArt[k] || {};
  for (const p of book.pages) {
    const pad = String(p.n).padStart(3, '0');
    p.img = cfg.relImgPrefix + pad + '.webp';
    const assetPath = path.join(DIST, p.img);
    const existsOnDisk = fs.existsSync(assetPath);
    p.hasImg = Boolean(artPack[pad] || existsOnDisk);

    if (p.art && k !== '4' && k !== '4.5' && !existsOnDisk) {
      console.error(`✗ Eksik illüstrasyon dosyası (Cilt ${k}): ${p.img}`);
      missingAssets++;
    }
  }

  const volJson = JSON.stringify(book);
  const volHash = crypto.createHash('sha1').update(volJson).digest('hex').slice(0, 12);
  hashInput.update(volHash);
  fs.writeFileSync(path.join(booksDir, `${k}.json`), volJson);

  manifestVolumes.push({
    id: k,
    short: k,
    label: book.volume,
    total: book.total,
    chapters: book.chapters.length,
    hasPending: book.chapters.some((c) => c.pending),
    version: volHash,
    file: `books/${k}.json`,
  });
  builtCount++;
}

fs.writeFileSync(
  path.join(booksDir, 'index.json'),
  JSON.stringify({ version: hashInput.digest('hex').slice(0, 12), volumes: manifestVolumes }, null, 2) + '\n'
);

if (missingAssets > 0) {
  console.error(`✗ Statik derleme başarısız: ${missingAssets} illüstrasyon dosyası eksik.`);
  process.exit(1);
}

console.log(`✓ Statik site hazır: dist/ (${builtCount} cilt, .nojekyll + books/*.json + WebP varlıkları doğrulandı).`);
