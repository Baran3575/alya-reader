// Çok ciltli ve 5 fazlı yayılım (Faz 1..Faz 5) yapılandırması.
// Şema: her cilt kendi dizininde source.json, bilingual.json, chapters.json ve paragraphs_final.json ({ "sayfa": ["paragraf", ...] }) tutar.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const VOLUME_SPECS = {
  '4': { key: '4', dataDir: 'data', imgPrefix: '/pages/', bundleImgPrefix: 'pages/', volume: 'Cilt 4', label: 'Cilt 4', phase: 1, maxAvgStrict: 0.12 },
  '4.5': { key: '4.5', dataDir: 'data45', imgPrefix: '/pages45/', bundleImgPrefix: 'pages45/', volume: 'Cilt 4.5', label: 'Cilt 4.5', phase: 1, maxAvgStrict: 0.12 },
  '5': { key: '5', dataDir: 'data5', imgPrefix: '/pages5/', bundleImgPrefix: 'pages5/', volume: 'Cilt 5', label: 'Cilt 5', phase: 2, maxAvgStrict: 0.12 },
  '6': { key: '6', dataDir: 'data6', imgPrefix: '/pages6/', bundleImgPrefix: 'pages6/', volume: 'Cilt 6', label: 'Cilt 6', phase: 2, maxAvgStrict: 0.12 },
  '7': { key: '7', dataDir: 'data7', imgPrefix: '/pages7/', bundleImgPrefix: 'pages7/', volume: 'Cilt 7', label: 'Cilt 7', phase: 3, maxAvgStrict: 0.12 },
  '8': { key: '8', dataDir: 'data8', imgPrefix: '/pages8/', bundleImgPrefix: 'pages8/', volume: 'Cilt 8', label: 'Cilt 8', phase: 3, maxAvgStrict: 0.12 },
  '9': { key: '9', dataDir: 'data9', imgPrefix: '/pages9/', bundleImgPrefix: 'pages9/', volume: 'Cilt 9', label: 'Cilt 9', phase: 4, maxAvgStrict: 0.12 },
  '9.5': { key: '9.5', dataDir: 'data95', imgPrefix: '/pages95/', bundleImgPrefix: 'pages95/', volume: 'Cilt 9.5', label: 'Cilt 9.5', phase: 4, maxAvgStrict: 0.12 },
  '10': { key: '10', dataDir: 'data10', imgPrefix: '/pages10/', bundleImgPrefix: 'pages10/', volume: 'Cilt 10', label: 'Cilt 10', phase: 5, maxAvgStrict: 0.12 },
  '11': { key: '11', dataDir: 'data11', imgPrefix: '/pages11/', bundleImgPrefix: 'pages11/', volume: 'Cilt 11', label: 'Cilt 11', phase: 5, maxAvgStrict: 0.12 },
  '12': { key: '12', dataDir: 'data12', imgPrefix: '/pages12/', bundleImgPrefix: 'pages12/', volume: 'Cilt 12', label: 'Cilt 12', phase: 5, maxAvgStrict: 0.12 },
};

const PHASES = {
  1: { id: 1, name: 'Faz 1: Cilt 4 & 4.5 düzelt/iyileştir', volumes: ['4', '4.5'] },
  2: { id: 2, name: 'Faz 2: Cilt 5 & 6', volumes: ['5', '6'] },
  3: { id: 3, name: 'Faz 3: Cilt 7 & 8', volumes: ['7', '8'] },
  4: { id: 4, name: 'Faz 4: Cilt 9 & 9.5', volumes: ['9', '9.5'] },
  5: { id: 5, name: 'Faz 5: Cilt 10–12', volumes: ['10', '11', '12'] },
};

function getVolumeConfig(volKey, rootDir = ROOT) {
  const spec = VOLUME_SPECS[String(volKey)];
  if (!spec) return null;
  const dir = path.join(rootDir, spec.dataDir);
  return {
    ...spec,
    absDir: dir,
    sourceFile: path.join(dir, 'source.json'),
    bilingualFile: path.join(dir, 'bilingual.json'),
    trFile: path.join(dir, 'paragraphs_final.json'),
    trRel: path.posix.join(spec.dataDir, 'paragraphs_final.json'),
    titlesFile: path.join(dir, 'chapters.json'),
  };
}

function getActiveVolumes(rootDir = ROOT) {
  const active = [];
  for (const key of Object.keys(VOLUME_SPECS)) {
    const cfg = getVolumeConfig(key, rootDir);
    if (fs.existsSync(cfg.trFile)) {
      active.push(cfg);
    }
  }
  return active;
}

module.exports = {
  VOLUME_SPECS,
  PHASES,
  getVolumeConfig,
  getActiveVolumes,
};
