// Ortak cilt kaydı yükleyici ve CI/CLI yardımcısı (Cilt 4 – 12)
// Kullanım:
//   node scripts/volumes.js --active-ids      # ["4","4.5"]
//   node scripts/volumes.js --all-ids         # ["4","4.5","5",...,"12"]
//   node scripts/volumes.js --tr-file <cilt>  # data/paragraphs_final.json
//   node scripts/volumes.js --source-files    # aktif <dataDir>/source.json yolları

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.join(__dirname, '..');

function toSlug(id) {
  return String(id).trim().replace(/\./g, '-');
}

function normalizeEntry(entry, rootDir = DEFAULT_ROOT) {
  const id = String(entry.id);
  const slug = entry.slug || toSlug(id);
  const label = entry.label || `Cilt ${id}`;
  const dataDir = entry.dataDir || (id === '4' ? 'data' : `data${id.replace(/\./g, '')}`);
  const imgPrefix = entry.imgPrefix || (id === '4' ? '/pages/' : `/pages${id.replace(/\./g, '')}/`);
  const sourceFile = entry.sourceFile || path.posix.join(dataDir, 'source.json');
  const trFile = entry.trFile || path.posix.join(dataDir, 'paragraphs_final.json');
  const titlesFile = entry.titlesFile || path.posix.join(dataDir, 'chapters.json');
  const backEnFile = entry.backEnFile || path.posix.join(dataDir, 'back_en.json');
  const patchesFile = entry.patchesFile || path.posix.join(dataDir, 'patches.json');
  const pagesRelDir = path.posix.join('public', imgPrefix.replace(/^\/+|\/+$/g, ''));
  const artRelDir = path.posix.join('public', 'art', `vol-${slug}`);

  const absSourceFile = path.resolve(rootDir, sourceFile);
  const absTrFile = path.resolve(rootDir, trFile);
  const absTitlesFile = path.resolve(rootDir, titlesFile);
  const absBackEnFile = path.resolve(rootDir, backEnFile);
  const absPatchesFile = path.resolve(rootDir, patchesFile);
  const absPagesDir = path.resolve(rootDir, pagesRelDir);
  const absArtDir = path.resolve(rootDir, artRelDir);

  const hasSource = fs.existsSync(absSourceFile);
  const hasTr = fs.existsSync(absTrFile);
  const hasPatches = fs.existsSync(absPatchesFile);
  const active = hasSource && hasTr;

  return {
    id,
    slug,
    label,
    volume: label,
    dataDir,
    imgPrefix,
    sourceFile,
    tr: trFile,
    trFile,
    titlesFile,
    backEnFile,
    patchesFile,
    pagesRelDir,
    artRelDir,
    absSourceFile,
    absTrFile,
    absTitlesFile,
    absBackEnFile,
    absPatchesFile,
    absPagesDir,
    absArtDir,
    maxAvgStrict: entry.maxAvgStrict !== undefined ? entry.maxAvgStrict : 0.25,
    knownSplitQuotes: new Set(Array.isArray(entry.knownSplitQuotes) ? entry.knownSplitQuotes : []),
    hasSource,
    hasTr,
    hasPatches,
    active,
  };
}

function loadManifest(rootDir = DEFAULT_ROOT) {
  const manifestPath = path.resolve(rootDir, 'volumes.json');
  const fallbackPath = path.resolve(DEFAULT_ROOT, 'volumes.json');
  const file = fs.existsSync(manifestPath) ? manifestPath : fallbackPath;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = Array.isArray(raw.volumes) ? raw.volumes : [];
  const list = entries.map((e) => normalizeEntry(e, rootDir));

  // Manifest'te yer almayan ancak diskte data<N>/source.json + paragraphs_final.json bulunan ek dizinleri de keşfet
  const knownDirs = new Set(list.map((v) => v.dataDir));
  if (fs.existsSync(rootDir)) {
    const dirEntries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const d of dirEntries) {
      if (!d.isDirectory()) continue;
      if (knownDirs.has(d.name)) continue;
      const m = d.name.match(/^data(\d+)$/);
      if (!m) continue;
      const srcPath = path.join(rootDir, d.name, 'source.json');
      const trPath = path.join(rootDir, d.name, 'paragraphs_final.json');
      if (fs.existsSync(srcPath) && fs.existsSync(trPath)) {
        const rawNum = m[1];
        const inferredId = rawNum.length === 2 && rawNum.endsWith('5') && rawNum !== '15'
          ? `${rawNum[0]}.5`
          : rawNum;
        if (!list.some((v) => v.id === inferredId)) {
          list.push(normalizeEntry({ id: inferredId, dataDir: d.name }, rootDir));
          knownDirs.add(d.name);
        }
      }
    }
  }

  const byId = {};
  for (const item of list) byId[item.id] = item;

  return {
    defaultVolume: raw.defaultVolume || (list[0] ? list[0].id : '4'),
    list,
    byId,
  };
}

function getVolumes(rootDir = DEFAULT_ROOT) {
  return loadManifest(rootDir).byId;
}

function getVolumeList(rootDir = DEFAULT_ROOT) {
  return loadManifest(rootDir).list;
}

function getVolumeIds(rootDir = DEFAULT_ROOT) {
  return loadManifest(rootDir).list.map((v) => v.id);
}

function getVolume(id, rootDir = DEFAULT_ROOT) {
  const key = String(id || '').trim();
  return loadManifest(rootDir).byId[key] || null;
}

function getActiveVolumeList(rootDir = DEFAULT_ROOT) {
  return loadManifest(rootDir).list.filter((v) => v.active);
}

function getActiveVolumes(rootDir = DEFAULT_ROOT) {
  const out = {};
  for (const v of getActiveVolumeList(rootDir)) out[v.id] = v;
  return out;
}

function getActiveVolumeIds(rootDir = DEFAULT_ROOT) {
  return getActiveVolumeList(rootDir).map((v) => v.id);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf('--root');
  const rootDir = rootIdx > -1 && args[rootIdx + 1] ? path.resolve(args[rootIdx + 1]) : DEFAULT_ROOT;

  if (args.includes('--active-ids')) {
    console.log(JSON.stringify(getActiveVolumeIds(rootDir)));
  } else if (args.includes('--all-ids')) {
    console.log(JSON.stringify(getVolumeIds(rootDir)));
  } else if (args.includes('--source-files')) {
    for (const v of getActiveVolumeList(rootDir)) {
      console.log(v.sourceFile);
    }
  } else if (args.includes('--tr-file')) {
    const idx = args.indexOf('--tr-file');
    const volId = args[idx + 1] || '4';
    const v = getVolume(volId, rootDir);
    if (!v) {
      console.error(`Bilinmeyen cilt: ${volId}`);
      process.exit(1);
    }
    console.log(v.trFile);
  } else if (args.includes('--patches-file')) {
    const idx = args.indexOf('--patches-file');
    const volId = args[idx + 1] || '4';
    const v = getVolume(volId, rootDir);
    if (!v) {
      console.error(`Bilinmeyen cilt: ${volId}`);
      process.exit(1);
    }
    console.log(v.patchesFile);
  } else {
    console.log(
      JSON.stringify(
        {
          defaultVolume: loadManifest(rootDir).defaultVolume,
          all: getVolumeIds(rootDir),
          active: getActiveVolumeIds(rootDir),
        },
        null,
        2
      )
    );
  }
}

module.exports = {
  DEFAULT_ROOT,
  toSlug,
  loadManifest,
  getVolumes,
  getVolumeList,
  getVolumeIds,
  getVolume,
  getActiveVolumeList,
  getActiveVolumes,
  getActiveVolumeIds,
};
