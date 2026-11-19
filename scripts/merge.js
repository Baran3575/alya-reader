// DeepL + Google çevirilerini birleştirir, terim/isim sözlüğü ve kıvrık tipografi/noktalama düzeltmesi yapar.
// Kullanım:
//   node scripts/merge.js                              # Cilt 4 (tüm sayfalar)
//   node scripts/merge.js --volume 4.5                 # Cilt 4.5 (tüm sayfalar)
//   node scripts/merge.js --volume 4.5 --pages 306-347 # Yalnızca belirli sayfa aralığını birleştir
const fs = require('fs');
const path = require('path');
const { getVolumeConfig } = require('./volumes');
const { curlyQuotesAndApostrophes } = require('./norm_typo');
const { DETACHED_QUOTE_SUFFIX_RE } = require('./qc/qc1_punctuation');

const ROOT = path.join(__dirname, '..');
const GLOSSARY_FILE = path.join(ROOT, 'data/glossary.json');

const EN_LEFTOVER = /(?<!\p{L})(the|and|you|your|was|were|with|that|this|have|has|she|his|they|their|from|what|would|could|should|just|because|about|there|then|when|which|into|been|being|are|but|for|him|how|does|did|of|to|so|if|we|my|me|or)(?!\p{L})/giu;

function countLeftovers(s) {
  return (String(s || '').replace(/https?:\/\/\S+/gi, '').match(EN_LEFTOVER) || []).length;
}

const DEFAULT_GLOSSARY = {
  // sık görülen çeviri varyantları -> tek yazım
  'Masaçika': 'Masachika',
  'Maşaçika': 'Masachika',
  'Masachika-chan': 'Masachika-chan',
  'Alişa': 'Alisa',
  'Alisa': 'Alisa',
  'Yuki': 'Yuki',
  'Ayano': 'Ayano',
  'Sayaka': 'Sayaka',
  'Çisaki': 'Chisaki',
  'Chisaki': 'Chisaki',
  'Maşa': 'Masha',
  'Suo': 'Suou',
  'Toya': 'Touya',
  'Nonoa': 'Nonoa',
  'Saraşina': 'Sarashina',
  'Kujo': 'Kujou',
  'Kimishima': 'Kimishima',
  'Onii-chan': 'Onii-chan',
};

function loadGlossary(glossaryPath = GLOSSARY_FILE) {
  if (fs.existsSync(glossaryPath)) {
    try {
      return { ...DEFAULT_GLOSSARY, ...JSON.parse(fs.readFileSync(glossaryPath, 'utf8')) };
    } catch {}
  }
  return DEFAULT_GLOSSARY;
}

const URL_MASK_RE =
  /(?:https?:\/\/|(?:www|discord)\.)\S+|(?<![\p{L}\p{N}])[a-z0-9-]+\.(?:com|org|net|me|gg|io|jp)(?:\/\S*)?(?![\p{L}\p{N}])/gu;

function polish(text, glossary) {
  let t = String(text || '');
  const urls = [];
  t = t.replace(URL_MASK_RE, (m) => {
    urls.push(m);
    return `__URL_${urls.length - 1}__`;
  });

  // 1) isim / terim tutarlılığı (kelime sınırlarıyla)
  for (const [from, to] of Object.entries(glossary)) {
    if (from === to) continue;
    const re = new RegExp('(?<![\\p{L}\\p{N}])' + from.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'gu');
    t = t.replace(re, to);
  }

  // 2) baştaki kaçak noktalama (paragraf bölünmesi artığı)
  if (/^[\s]*[,;:]/.test(t)) {
    t = t.replace(/^[\s,;:]+/, '');
    if (t) t = t.charAt(0).toLocaleUpperCase('tr') + t.slice(1);
  }

  // 3) noktalama, kıvrık tipografi ve boşluk düzeltmeleri
  t = t
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/(?<!\d)([,;:])(?=\S)/g, '$1 ')
    .replace(/\.{3,}/g, '…')
    .replace(/…\./g, '…')
    .replace(/[\u201e]/g, '“')
    .replace(/\u2013/g, '—')
    .replace(/(?<!\p{L})(\d+)\.\s*Bölüm(?!\p{L})/gu, 'Bölüm $1')
    .replace(/(?<!\p{L})(\d+)\.\s*Kısım(?!\p{L})/gu, 'Kısım $1')
    .replace(/\s+—\s+/g, ' — ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();

  t = curlyQuotesAndApostrophes(t);
  t = t.replace(DETACHED_QUOTE_SUFFIX_RE, '$1');
  t = t.replace(/__URL_(\d+)__/g, (_, idx) => urls[Number(idx)]);

  return t.trim();
}

function preferGoogle(d, g) {
  if (!g || g.trim().split(' ').length < 3) return false;
  if (/^(Devamı|Yukarıdaki|Aşağıdaki|Çevirisi|Devam)\b/i.test(g.trim())) return false;
  if (g.length < d.length * 0.8) return false;
  const ld = countLeftovers(d);
  const lg = countLeftovers(g);
  return ld >= 2 && lg === 0;
}

function parsePageRange(rangeStr) {
  if (!rangeStr) return null;
  const m = String(rangeStr).match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : start;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function runMerge(options = {}) {
  const volKey = options.volume || '4';
  const volCfg = getVolumeConfig(volKey, ROOT);
  const inFile = options.inFile || (volCfg ? volCfg.bilingualFile : path.join(ROOT, 'data/bilingual.json'));
  const outFile = options.outFile || (volCfg ? volCfg.trFile : path.join(ROOT, 'data/paragraphs_final.json'));
  const range = typeof options.pages === 'string' ? parsePageRange(options.pages) : options.pages || null;

  const data = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  const glossary = loadGlossary();
  const out = range && fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
  let pickedD = 0;
  let pickedG = 0;

  for (const [page, paras] of Object.entries(data)) {
    if (!Array.isArray(paras)) continue;
    const pageNum = Number(page);
    if (range && (pageNum < range.start || pageNum > range.end)) continue;

    out[page] = paras.map((p) => {
      const d = (p && p.d) || '';
      const g = (p && p.g) || '';
      let chosen = d;
      if (!d) chosen = g;
      else if (g && preferGoogle(d, g)) chosen = g;
      if (chosen === d && d) pickedD++;
      else if (chosen === g && g) pickedG++;
      return polish(chosen, glossary);
    });
  }

  fs.writeFileSync(outFile, JSON.stringify(out));
  const total = Object.values(out).reduce((a, b) => a + b.length, 0);
  if (!options.silent) {
    console.log(
      'paragraf:',
      total,
      '| DeepL:',
      pickedD,
      '| Google:',
      pickedG,
      '| dosya:',
      path.relative(ROOT, outFile)
    );
  }
  return { out, total, pickedD, pickedG };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const vIdx = args.indexOf('--volume') > -1 ? args.indexOf('--volume') : args.indexOf('--vol');
  const pIdx = args.indexOf('--pages');
  const volume = vIdx > -1 && args[vIdx + 1] ? String(args[vIdx + 1]) : '4';
  const pages = pIdx > -1 && args[pIdx + 1] ? String(args[pIdx + 1]) : null;
  runMerge({ volume, pages });
}

module.exports = { DEFAULT_GLOSSARY, loadGlossary, polish, preferGoogle, parsePageRange, runMerge };
