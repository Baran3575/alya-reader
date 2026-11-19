// Fan çevirmeni kredi/reklam sayfalarını temizler, içindekiler sayfasını chapters.json başlıklarıyla yeniden yazar.
// Kullanım:
//   node scripts/fix_frontmatter.js                 # Kayıtlı tüm ciltler (4 – 12)
//   node scripts/fix_frontmatter.js --volume 4.5    # Belirli cilt
const fs = require('fs');
const path = require('path');
const { ROOT, VOLUME_KEYS, resolveVolume, parseVolumeArg } = require('./lib/volumes');

const SKIP_CREDIT_RE =
  /(discord\.gg|glucosetl|novelupdates|lightnovelreader|TLed and Edited\s*by|fan translators? and editors?|Volume\s+\d+(?:\.\d+)?,?\s+Fan\s+Translation|Do not reupload our chapters behind ad-link shorteners|Join our Discord|Download all your Favorite Light Novels|Stay up to date On Light Novels)/i;

const VOLUME_FRONTMATTER = {
  '4': {
    dataDir: 'data',
    skipPages: ['12'],
    tocPage: '13',
    tocSuffix: ['Resimler'],
  },
  '4.5': {
    dataDir: 'data45',
    skipPages: ['7', '347'],
    tocPage: '8',
    tocSuffix: [],
  },
};

function resolveVolumeConfig(vol) {
  const v = String(vol).trim();
  if (VOLUME_FRONTMATTER[v]) return VOLUME_FRONTMATTER[v];
  const reg = resolveVolume(v);
  const dataDir = reg ? reg.dataDir : v === '4' ? 'data' : 'data' + v.replace(/\./g, '');
  return { dataDir, skipPages: [], tocPage: null, tocSuffix: [] };
}

const LBL = (k) =>
  k === 'Prologue' ? 'Önsöz' : k === 'Epilogue' ? 'Sonsöz' : k.replace(/^Chapter (\d+)$/, 'Bölüm $1');

function normalizeCurlyQuotes(str) {
  return String(str || '')
    .replace(/(\S)'(\S)/g, '$1’$2')
    .replace(/'/g, '’')
    .replace(/(^|[\s(\[])"(?=\S)/g, '$1“')
    .replace(/"/g, '”');
}

function fixFrontmatterForVolume(vol, rootDir = ROOT) {
  const cfg = resolveVolumeConfig(vol);
  const finPath = path.join(rootDir, cfg.dataDir, 'paragraphs_final.json');
  if (!fs.existsSync(finPath)) return null;

  const rawOrig = fs.readFileSync(finPath, 'utf8');
  const fin = JSON.parse(rawOrig);
  const origSerialized = JSON.stringify(fin);
  const isPretty = rawOrig.includes('\n ');
  const chaptersPath = path.join(rootDir, cfg.dataDir, 'chapters.json');
  const bilPath = path.join(rootDir, cfg.dataDir, 'bilingual.json');
  const srcPath = path.join(rootDir, cfg.dataDir, 'source.json');

  const skipSet = new Set(cfg.skipPages.map(String));

  // source.json varsa kredi/reklam sayfalarını otomatik de yakala
  if (fs.existsSync(srcPath)) {
    const src = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
    for (const p of src) {
      if (!p.pending && SKIP_CREDIT_RE.test(String(p.text || ''))) {
        skipSet.add(String(p.page));
      }
    }
  }

  for (const pg of skipSet) {
    fin[pg] = [];
  }

  if (fs.existsSync(bilPath)) {
    const bil = JSON.parse(fs.readFileSync(bilPath, 'utf8'));
    let bilDirty = false;
    for (const pg of skipSet) {
      if (Array.isArray(bil[pg]) && bil[pg].length > 0) {
        bil[pg] = [];
        bilDirty = true;
      }
    }
    if (bilDirty) {
      fs.writeFileSync(bilPath, JSON.stringify(bil));
    }
  }

  let tocPage = cfg.tocPage;
  if (!tocPage && fs.existsSync(srcPath)) {
    const src = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
    const hit = src.find((p) => /^Table of contents\b/i.test(String(p.text || '').trim()));
    if (hit) tocPage = String(hit.page);
  }

  if (tocPage && fs.existsSync(chaptersPath)) {
    const chapters = JSON.parse(fs.readFileSync(chaptersPath, 'utf8'));
    let rows = [];
    if (Array.isArray(chapters.chapters)) {
      rows = chapters.chapters
        .filter((c) => c && !/^İllüstrasyon|^Başlangıç/i.test(c.label || ''))
        .map((c) => normalizeCurlyQuotes(`${c.label}: ${c.title || c.enTitle || ''}`));
    } else {
      rows = Object.entries(chapters).map(([k, v]) => normalizeCurlyQuotes(`${LBL(k)}: ${v}`));
    }
    fin[String(tocPage)] = ['İçindekiler', ...rows, ...(cfg.tocSuffix || [])];
  }

  if (JSON.stringify(fin) !== origSerialized) {
    fs.writeFileSync(finPath, (isPretty ? JSON.stringify(fin, null, 1) : JSON.stringify(fin)) + '\n');
  }
  return { vol: String(vol), skipped: [...skipSet], tocPage };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const hasVolFlag = args.some((a) => a === '--volume' || a === '--vol' || a === '-v' || a.startsWith('--volume=') || a.startsWith('--vol='));
  const targets = hasVolFlag ? [parseVolumeArg(args, '4')] : VOLUME_KEYS;
  for (const v of targets) {
    const res = fixFrontmatterForVolume(v);
    if (res && (res.skipped.length || res.tocPage)) {
      console.log(
        `Cilt ${res.vol}: reklam/kredi sayfaları temizlendi [${res.skipped.join(', ')}]${res.tocPage ? `, içindekiler güncellendi (s.${res.tocPage})` : ''}`
      );
    }
  }
}

module.exports = { VOLUME_FRONTMATTER, SKIP_CREDIT_RE, resolveVolumeConfig, fixFrontmatterForVolume, normalizeCurlyQuotes };
