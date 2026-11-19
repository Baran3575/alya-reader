// GitHub Pages için temiz dist/ dizini hazırlar (.nojekyll, Cilt 4–12 illüstrasyonlar, books/<cilt>.json, hash'li sw.js).
// Kullanım: node scripts/build_site.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { VOLUMES } = require('./lib/volumes');
const { buildBundles } = require('./build_bundle.js');

const ROOT = path.join(__dirname, '..');
const GENERATED_TOP_FILES = new Set(['bundle.js', 'bundle-art.js', 'sw.js']);
const GITIGNORED_SCAN_DIRS = new Set(['pages', 'pages45']);

function shouldExclude(relPosix, isTopLevel, isDir) {
  const base = path.posix.basename(relPosix);
  if (/\.bak$/i.test(base)) return true;
  if (isTopLevel && GENERATED_TOP_FILES.has(base)) return true;
  if (isTopLevel && isDir && GITIGNORED_SCAN_DIRS.has(base.toLowerCase())) return true;
  return false;
}

function copyPublicAssets(srcDir, destDir, relBase = '') {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const relPosix = relBase ? relBase + '/' + entry.name : entry.name;
    const isTopLevel = relBase === '';
    if (shouldExclude(relPosix, isTopLevel, entry.isDirectory())) continue;

    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyPublicAssets(srcPath, destPath, relPosix);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function listFilesSorted(dir, relBase = '') {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relPosix = relBase ? relBase + '/' + entry.name : entry.name;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesSorted(fullPath, relPosix));
    } else if (entry.isFile()) {
      results.push({ relPosix, fullPath });
    }
  }
  return results.sort((a, b) => a.relPosix.localeCompare(b.relPosix));
}

function computeSiteHash(swTemplate, distDir) {
  const hash = crypto.createHash('sha1');
  hash.update('sw-template\0');
  hash.update(swTemplate);
  for (const file of listFilesSorted(distDir)) {
    if (file.relPosix === '.nojekyll' || file.relPosix === 'sw.js') continue;
    hash.update('\0' + file.relPosix + '\0');
    hash.update(fs.readFileSync(file.fullPath));
  }
  return hash.digest('hex').slice(0, 12);
}

function verifyDist(distDir, bundleInfo, swVersion) {
  const required = ['.nojekyll', 'index.html', 'style.css', 'app.js', 'bundle.js', 'bundle-art.js', 'sw.js'];
  for (const rel of required) {
    if (!fs.existsSync(path.join(distDir, rel))) {
      throw new Error('Eksik derleme çıktısı: dist/' + rel);
    }
  }
  for (const [volKey, book] of Object.entries(bundleInfo.vols)) {
    const bookJson = path.join(distDir, 'books', volKey + '.json');
    if (!fs.existsSync(bookJson)) {
      throw new Error('Eksik statik cilt dosyası: dist/books/' + volKey + '.json');
    }
    for (const p of book.pages) {
      if (!p.art) continue;
      const pad = String(p.n).padStart(3, '0');
      const hasEmbedded = Boolean(bundleInfo.art[volKey] && bundleInfo.art[volKey][pad]);
      const hasDiskAsset = fs.existsSync(path.join(distDir, p.img));
      if (!hasEmbedded && !hasDiskAsset) {
        throw new Error('Eksik illüstrasyon dosyası (Cilt ' + volKey + '): ' + p.img);
      }
    }
  }
  const allFiles = listFilesSorted(distDir);
  const bakFiles = allFiles.filter((f) => /\.bak$/i.test(f.relPosix));
  if (bakFiles.length > 0) {
    throw new Error('dist/ içinde .bak yedek dosyası bulundu: ' + bakFiles.map((f) => f.relPosix).join(', '));
  }
  const swText = fs.readFileSync(path.join(distDir, 'sw.js'), 'utf8');
  if (!swText.includes("const VERSION = '" + swVersion + "';")) {
    throw new Error('dist/sw.js VERSION enjeksiyonu doğrulanamadı');
  }
}

function buildSite(opt = {}) {
  const rootDir = opt.rootDir || ROOT;
  const publicDir = opt.publicDir || path.join(rootDir, 'public');
  const distDir = opt.distDir || path.join(rootDir, 'dist');
  const volumes = opt.volumes || VOLUMES;
  const quiet = Boolean(opt.quiet);

  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  copyPublicAssets(publicDir, distDir);

  const bundleInfo = buildBundles({
    rootDir,
    outDir: distDir,
    booksDir: path.join(distDir, 'books'),
    volumes,
    artSourceFile: path.join(publicDir, 'bundle-art.js'),
    quiet,
  });

  fs.writeFileSync(path.join(distDir, '.nojekyll'), '');

  const swTemplate = fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf8');
  const swHash = computeSiteHash(swTemplate, distDir);
  const swVersion = 'alya-' + swHash;
  const versionPattern = /const\s+VERSION\s*=\s*['"][^'"]+['"]\s*;/;
  if (!versionPattern.test(swTemplate)) {
    throw new Error('public/sw.js içinde VERSION tanımı bulunamadı');
  }
  const swOut = swTemplate.replace(versionPattern, "const VERSION = '" + swVersion + "';");
  fs.writeFileSync(path.join(distDir, 'sw.js'), swOut);

  const builtVolumes = Object.keys(bundleInfo.vols);
  verifyDist(distDir, bundleInfo, swVersion);

  if (!quiet) {
    console.log(
      'hazır:',
      path.relative(rootDir, distDir) || 'dist',
      '| ciltler:',
      builtVolumes.join(', '),
      '| sw:',
      swVersion,
    );
  }

  return {
    distDir,
    swHash,
    swVersion,
    bundleHash: bundleInfo.hash,
    artCount: bundleInfo.artCount,
    artBytes: bundleInfo.artBytes,
    volumes: builtVolumes,
  };
}

if (require.main === module) {
  buildSite();
}

module.exports = { buildSite, computeSiteHash };
