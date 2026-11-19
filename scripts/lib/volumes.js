// Tüm ciltler için tek kaynak data/volumes.json üstveri ve yol çözücüsü.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST_PATH = path.join(ROOT, 'data', 'volumes.json');
const MANIFEST = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

const VOLUME_KEYS = MANIFEST.map((entry) => String(entry.id));
const ENABLED_VOLUME_KEYS = MANIFEST.filter((entry) => entry.enabled).map((entry) => String(entry.id));

function buildVolumeRecord(entry) {
  const key = String(entry.id);
  const dataDir = entry.dataDir;
  const slug = dataDir.slice(4);
  const imgPrefix = entry.imgPrefix;
  const relImgPrefix = imgPrefix.replace(/^\/+/, '');
  const imgDir = 'public/' + relImgPrefix.replace(/\/+$/, '');

  return {
    ...entry,
    id: key,
    key,
    slug,
    dataDir,
    imgDir,
    imgPrefix,
    relImgPrefix,
    label: entry.label,
    titlesFile: path.join(ROOT, entry.chaptersFile),
    sourceFile: path.join(ROOT, dataDir, 'source.json'),
    bilingualFile: path.join(ROOT, dataDir, 'bilingual.json'),
    finalFile: path.join(ROOT, dataDir, 'paragraphs_final.json'),
    finalRel: `${dataDir}/paragraphs_final.json`,
    patchesAbsFile: entry.patchesFile ? path.join(ROOT, entry.patchesFile) : '',
    maxAvgStrict: entry.maxAvgStrict,
    embedArt: Boolean(entry.embedArt),
  };
}

const VOLUMES = Object.fromEntries(MANIFEST.map((entry) => [String(entry.id), buildVolumeRecord(entry)]));

function resolveVolume(volKey) {
  const defaultId = ENABLED_VOLUME_KEYS[0] || VOLUME_KEYS[0] || '';
  const k = String(volKey || defaultId).trim();
  return VOLUMES[k] || null;
}

function parseVolumeArg(argv = process.argv.slice(2), defaultVol = ENABLED_VOLUME_KEYS[0] || VOLUME_KEYS[0] || '') {
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
  MANIFEST,
  VOLUME_KEYS,
  ENABLED_VOLUME_KEYS,
  VOLUMES,
  resolveVolume,
  parseVolumeArg,
};
