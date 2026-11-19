// Tüm ciltler (4 – 12, 4.5 ve 9.5 dahil) için ortak dizin ve üstveri kaydı.
// Tek doğruluk kaynağı olarak kök volumes.json manifestini (scripts/volumes.js üzerinden) kullanır.
const path = require('path');
const { DEFAULT_ROOT, loadManifest } = require('../volumes');

const ROOT = DEFAULT_ROOT;
const manifest = loadManifest(ROOT);

const VOLUME_KEYS = manifest.list.map((v) => v.id);

function toLegacyEntry(v) {
  const legacySlug = v.id === '4' ? '' : v.id.replace(/\./g, '');
  const relImgPrefix = v.imgPrefix.replace(/^\/+/, '');
  return {
    key: v.id,
    slug: legacySlug,
    bundleSlug: v.slug,
    dataDir: v.dataDir,
    imgDir: v.pagesRelDir,
    imgPrefix: v.imgPrefix,
    relImgPrefix,
    label: v.label,
    titlesFile: v.absTitlesFile,
    sourceFile: v.absSourceFile,
    bilingualFile: path.join(ROOT, v.dataDir, 'bilingual.json'),
    finalFile: v.absTrFile,
    finalRel: v.trFile,
    maxAvgStrict: v.maxAvgStrict,
  };
}

const VOLUMES = Object.fromEntries(manifest.list.map((v) => [v.id, toLegacyEntry(v)]));

function resolveVolume(volKey) {
  const k = String(volKey || '4').trim();
  return VOLUMES[k] || null;
}

function parseVolumeArg(argv = process.argv.slice(2), defaultVol = '4') {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--volume' || a === '--vol' || a === '-v') && argv[i + 1]) {
      return String(argv[i + 1]).trim();
    }
    if (a.startsWith('--volume=')) return a.slice('--volume='.length).trim();
    if (a.startsWith('--vol=')) return a.slice('--vol='.length).trim();
  }
  return defaultVol;
}

module.exports = {
  ROOT,
  VOLUME_KEYS,
  VOLUMES,
  resolveVolume,
  parseVolumeArg,
};
