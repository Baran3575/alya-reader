// Tembel yüklenen Türkçe JSON paketleri + ikili .webp illüstrasyon çıkarıcı.
// Üretilen dosyalar:
//   public/bundles/manifest.json
//   public/bundles/vol-<slug>.json   (p.en olmadan yalnız Türkçe metin ve bölüm verisi)
//   public/art/vol-<slug>/<NNN>.webp (bağımsız ikili WebP illüstrasyonlar)
// Kullanım: node scripts/build_bundle.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildBook } = require('../server');
const { loadManifest, getActiveVolumeList } = require('./volumes');

const DEFAULT_ROOT = path.join(__dirname, '..');

function buildBundles(rootDir = DEFAULT_ROOT) {
  const manifestCfg = loadManifest(rootDir);
  const activeVolumes = getActiveVolumeList(rootDir);
  const bundlesDir = path.join(rootDir, 'public', 'bundles');
  fs.mkdirSync(bundlesDir, { recursive: true });

  const manifestVolumes = {};
  const order = [];
  let totalArtFiles = 0;
  let totalChunkBytes = 0;

  for (const cfg of activeVolumes) {
    const artDir = path.join(rootDir, 'public', 'art', `vol-${cfg.slug}`);
    fs.mkdirSync(artDir, { recursive: true });

    const relPagesPrefix = cfg.imgPrefix.replace(/^\/+/, '');
    const srcPagesDir = path.join(rootDir, 'public', relPagesPrefix);

    const book = buildBook({
      rootDir,
      id: cfg.id,
      slug: cfg.slug,
      dataDir: cfg.dataDir,
      imgPrefix: relPagesPrefix,
      volume: cfg.label,
      titlesFile: cfg.absTitlesFile,
      includeEn: false,
    });

    for (const p of book.pages) {
      delete p.en;
      const nnn = String(p.n).padStart(3, '0') + '.webp';
      const srcWebp = path.join(srcPagesDir, nnn);
      const destWebp = path.join(artDir, nnn);

      if (p.art && fs.existsSync(srcWebp)) {
        fs.copyFileSync(srcWebp, destWebp);
      }

      if (fs.existsSync(destWebp)) {
        p.img = `art/vol-${cfg.slug}/${nnn}`;
        totalArtFiles++;
      } else {
        p.img = `${relPagesPrefix}${nnn}`;
      }
    }

    const chunkJson = JSON.stringify(book);
    const hash = crypto.createHash('sha1').update(chunkJson).digest('hex').slice(0, 12);
    const chunkRel = `bundles/vol-${cfg.slug}.json`;
    const chunkPath = path.join(rootDir, 'public', chunkRel);
    fs.writeFileSync(chunkPath, chunkJson + '\n');
    totalChunkBytes += Buffer.byteLength(chunkJson);

    order.push(cfg.id);
    manifestVolumes[cfg.id] = {
      id: cfg.id,
      slug: cfg.slug,
      label: cfg.label,
      file: chunkRel,
      hash,
      total: book.total,
      chapters: book.chapters.length,
    };
  }

  const defaultVolume = manifestVolumes[manifestCfg.defaultVolume]
    ? manifestCfg.defaultVolume
    : order[0] || '4';

  const outManifest = {
    defaultVolume,
    order,
    volumes: manifestVolumes,
  };

  const manifestPath = path.join(bundlesDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(outManifest, null, 2) + '\n');

  return {
    manifestPath,
    manifest: outManifest,
    totalArtFiles,
    totalChunkBytes,
  };
}

if (require.main === module) {
  const { manifestPath, manifest, totalArtFiles, totalChunkBytes } = buildBundles(DEFAULT_ROOT);
  console.log(
    `yazıldı: ${path.relative(DEFAULT_ROOT, manifestPath)} | ${manifest.order.length} cilt | ${(totalChunkBytes / 1024).toFixed(0)} KB toplam JSON | ${totalArtFiles} WebP illüstrasyon`
  );
  for (const id of manifest.order) {
    const v = manifest.volumes[id];
    const chunkFile = path.join(DEFAULT_ROOT, 'public', v.file);
    const kb = (fs.statSync(chunkFile).size / 1024).toFixed(0);
    console.log(
      `  ${v.label.padEnd(9)}: ${v.file} (${kb} KB, hash=${v.hash}) | ${v.total} sayfa | ${v.chapters} bölüm`
    );
  }
}

module.exports = { buildBundles };
