// Tüm ciltler (4 – 12, 4.5 ve 9.5 dahil) ve 5 fazlı yayılım (Faz 1..Faz 5) için ortak dizin ve üstveri kaydı.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const VOLUME_KEYS = ['4', '4.5', '5', '6', '7', '8', '9', '9.5', '10', '11', '12'];

const PHASE_BY_VOL = {
  '4': 1,
  '4.5': 1,
  '5': 2,
  '6': 2,
  '7': 3,
  '8': 3,
  '9': 4,
  '9.5': 4,
  '10': 5,
  '11': 5,
  '12': 5,
};

const PHASES = {
  1: { id: 1, name: 'Faz 1: Cilt 4 & 4.5 düzelt/iyileştir', volumes: ['4', '4.5'] },
  2: { id: 2, name: 'Faz 2: Cilt 5 & 6', volumes: ['5', '6'] },
  3: { id: 3, name: 'Faz 3: Cilt 7 & 8', volumes: ['7', '8'] },
  4: { id: 4, name: 'Faz 4: Cilt 9 & 9.5', volumes: ['9', '9.5'] },
  5: { id: 5, name: 'Faz 5: Cilt 10–12', volumes: ['10', '11', '12'] },
};

function makeVolume(key, rootDir = ROOT) {
  const phase = PHASE_BY_VOL[key] || 1;
  const maxAvgStrict = phase === 1 ? 0.12 : 0.20;
  const maxFlaggedShareStrict = phase === 1 ? 0.005 : undefined;

  if (key === '4') {
    const absDir = path.join(rootDir, 'data');
    const finalFile = path.join(absDir, 'paragraphs_final.json');
    const finalRel = 'data/paragraphs_final.json';
    return {
      key: '4',
      slug: '',
      dataDir: 'data',
      absDir,
      imgDir: 'public/pages',
      imgPrefix: '/pages/',
      relImgPrefix: 'pages/',
      bundleImgPrefix: 'pages/',
      label: 'Cilt 4',
      volume: 'Cilt 4',
      phase,
      titlesFile: path.join(absDir, 'chapters.json'),
      sourceFile: path.join(absDir, 'source.json'),
      bilingualFile: path.join(absDir, 'bilingual.json'),
      finalFile,
      finalRel,
      trFile: finalFile,
      trRel: finalRel,
      maxAvgStrict,
      maxFlaggedShareStrict,
    };
  }
  const suffix = key.replace('.', '');
  const dataDir = `data${suffix}`;
  const absDir = path.join(rootDir, dataDir);
  const imgDir = `public/pages${suffix}`;
  const relImgPrefix = `pages${suffix}/`;
  const finalFile = path.join(absDir, 'paragraphs_final.json');
  const finalRel = `${dataDir}/paragraphs_final.json`;
  const label = `Cilt ${key}`;
  return {
    key,
    slug: suffix,
    dataDir,
    absDir,
    imgDir,
    imgPrefix: `/pages${suffix}/`,
    relImgPrefix,
    bundleImgPrefix: relImgPrefix,
    label,
    volume: label,
    phase,
    titlesFile: path.join(absDir, 'chapters.json'),
    sourceFile: path.join(absDir, 'source.json'),
    bilingualFile: path.join(absDir, 'bilingual.json'),
    finalFile,
    finalRel,
    trFile: finalFile,
    trRel: finalRel,
    maxAvgStrict,
    maxFlaggedShareStrict,
  };
}

const VOLUMES = Object.fromEntries(VOLUME_KEYS.map((k) => [k, makeVolume(k, ROOT)]));

function resolveVolume(volKey) {
  const k = String(volKey || '4').trim();
  return VOLUMES[k] || null;
}

function getVolumeConfig(volKey, rootDir = ROOT) {
  const k = String(volKey || '4').trim();
  if (!PHASE_BY_VOL[k]) return null;
  if (rootDir === ROOT) return VOLUMES[k];
  return makeVolume(k, rootDir);
}

function getActiveVolumes(rootDir = ROOT) {
  const active = [];
  for (const key of VOLUME_KEYS) {
    const cfg = getVolumeConfig(key, rootDir);
    if (cfg && fs.existsSync(cfg.finalFile)) {
      active.push(cfg);
    }
  }
  return active;
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
  VOLUME_SPECS: VOLUMES,
  PHASES,
  resolveVolume,
  parseVolumeArg,
  getVolumeConfig,
  getActiveVolumes,
};
