// Tüm ciltler (4 – 12, 4.5 ve 9.5 dahil) için ortak dizin ve üstveri kaydı.
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const VOLUME_KEYS = ['4', '4.5', '5', '6', '7', '8', '9', '9.5', '10', '11', '12'];

// Cilt başına kaynak listesi: data/sources.json (tek doğru kaynak).
// Her kayıt: { label, url, embed } — embed=true ise Orijinal görünümde iframe ile gömülür.
const SOURCES = require(path.join(ROOT, 'data', 'sources.json'));

function sourcesOf(key) {
  return Array.isArray(SOURCES[key]) ? SOURCES[key] : [];
}

// Gömülebilir ilk kaynak (flipbook) ve ilk bağlantı
function flipOf(key) {
  const s = sourcesOf(key).find((x) => x.embed);
  return s ? s.url : null;
}
function sourceOf(key) {
  const s = sourcesOf(key)[0];
  return s ? s.url : null;
}

const SOURCE_URLS = Object.fromEntries(VOLUME_KEYS.map((k) => [k, sourceOf(k)]));
const FLIP_URLS = Object.fromEntries(VOLUME_KEYS.map((k) => [k, flipOf(k)]));

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
      bilingualFile: path.join(ROOT, 'data', 'bilingual.json'),
      finalFile: path.join(ROOT, 'data', 'paragraphs_final.json'),
      finalRel: 'data/paragraphs_final.json',
      flip: FLIP_URLS['4'] || null,
      source: SOURCE_URLS['4'] || null,
      sources: sourcesOf('4'),
      maxAvgStrict: 0.20,
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
    bilingualFile: path.join(ROOT, dataDir, 'bilingual.json'),
    finalFile: path.join(ROOT, dataDir, 'paragraphs_final.json'),
    finalRel: `${dataDir}/paragraphs_final.json`,
    flip: FLIP_URLS[key] || null,
    source: SOURCE_URLS[key] || null,
    sources: sourcesOf(key),
    maxAvgStrict: 0.20,
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
