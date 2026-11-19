// Tüm ciltler (4 – 12, 4.5 ve 9.5 dahil) için ortak dizin ve üstveri kaydı.
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const VOLUME_KEYS = ['4', '4.5', '5', '6', '7', '8', '9', '9.5', '10', '11', '12'];

const STITCHED_BOUNDARY_VOLUMES = new Set(['4', '4.5', '11', '12']);

function makeVolume(key) {
  if (key === '4') {
    return {
      key: '4',
      slug: '',
      dataDir: 'data',
      imgDir: 'public/pages',
      imgPrefix: '/pages/',
      relImgPrefix: 'pages/',
      label: 'Cilt 4',
      titlesFile: path.join(ROOT, 'data', 'chapters.json'),
      sourceFile: path.join(ROOT, 'data', 'source.json'),
      sourceRel: 'data/source.json',
      bilingualFile: path.join(ROOT, 'data', 'bilingual.json'),
      bilingualRel: 'data/bilingual.json',
      finalFile: path.join(ROOT, 'data', 'paragraphs_final.json'),
      finalRel: 'data/paragraphs_final.json',
      maxAvgStrict: 0.20,
      stitchedBoundaries: true,
    };
  }
  const suffix = key.replace('.', '');
  const dataDir = `data${suffix}`;
  const imgDir = `public/pages${suffix}`;
  return {
    key,
    slug: suffix,
    dataDir,
    imgDir,
    imgPrefix: `/pages${suffix}/`,
    relImgPrefix: `pages${suffix}/`,
    label: `Cilt ${key}`,
    titlesFile: path.join(ROOT, dataDir, 'chapters.json'),
    sourceFile: path.join(ROOT, dataDir, 'source.json'),
    sourceRel: `${dataDir}/source.json`,
    bilingualFile: path.join(ROOT, dataDir, 'bilingual.json'),
    bilingualRel: `${dataDir}/bilingual.json`,
    finalFile: path.join(ROOT, dataDir, 'paragraphs_final.json'),
    finalRel: `${dataDir}/paragraphs_final.json`,
    maxAvgStrict: 0.20,
    stitchedBoundaries: STITCHED_BOUNDARY_VOLUMES.has(key),
  };
}

const VOLUMES = Object.fromEntries(VOLUME_KEYS.map((k) => [k, makeVolume(k)]));

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
