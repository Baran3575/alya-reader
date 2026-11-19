// DeepL + Google çevirilerini birleştirir, terim/isim sözlüğü ve kıvrık tipografi/noktalama düzeltmesi yapar.
// Çıktı: data<vol>/paragraphs_final.json  ({ "1": ["paragraf", ...], ... })
// Kullanım:
//   node scripts/merge.js                              # Cilt 4 (tüm sayfalar)
//   node scripts/merge.js --volume 4.5                 # Cilt 4.5 (veya 4..12)
//   node scripts/merge.js --volume 4.5 --pages 306-347 # Yalnızca belirli sayfa aralığını birleştir
const fs = require('fs');
const path = require('path');
const { ROOT, resolveVolume, parseVolumeArg } = require('./lib/volumes');
const { URL_MASK_RE, curlyQuotesAndApostrophes } = require('./norm_typo');
const { DETACHED_QUOTE_SUFFIX_RE } = require('./qc/qc1_punctuation');

const GLOSSARY_FILE = path.join(ROOT, 'data/glossary.json');

const EN_LEFTOVER =
  /(?<!\p{L})(the|and|you|your|was|were|with|that|this|have|has|she|his|they|their|from|what|would|could|should|just|because|about|there|then|when|which|into|been|being|are|but|for|him|how|does|did|of|to|so|if|we|my|me|or)(?!\p{L})/giu;

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
      const raw = JSON.parse(fs.readFileSync(glossaryPath, 'utf8'));
      const clean = {};
      for (const [k, v] of Object.entries(raw)) {
        if (!k.startsWith('_') && typeof v === 'string') clean[k] = v;
      }
      return { ...DEFAULT_GLOSSARY, ...clean };
    } catch {}
  }
  return DEFAULT_GLOSSARY;
}

function balanceCurlyQuotes(text) {
  let t = String(text || '')
    .replace(/[\u02bc`]/g, '\u2019')
    .replace(/[\u201e\u00ab]/g, '\u201c')
    .replace(/\u00bb/g, '\u201d');
  if (t.includes("'")) {
    t = curlyQuotesAndApostrophes(t);
  }

  const hasStraightDouble = t.includes('"');
  const openCount = (t.match(/\u201c/g) || []).length;
  const closeCount = (t.match(/\u201d/g) || []).length;
  let balance = 0;
  let inverted = false;
  for (const ch of t) {
    if (ch === '\u201c') balance++;
    else if (ch === '\u201d') {
      balance--;
      if (balance < 0) inverted = true;
    }
  }

  if (!hasStraightDouble && openCount === closeCount && !inverted) {
    return t;
  }

  // Sıralı çiftleme: tüm çift tırnakları (“ ” ") dengeli açılış/kapanış çiftlerine dönüştür
  let open = true;
  t = t.replace(/["\u201c\u201d]/g, () => {
    const ch = open ? '\u201c' : '\u201d';
    open = !open;
    return ch;
  });

  // Tek sayıda çift tırnak kaldıysa paragraf sonunda kapat
  if (!open) {
    t = t.trimEnd() + '\u201d';
  }
  return t;
}

function polish(text, glossary = loadGlossary()) {
  let t = String(text || '');
  const urls = [];
  t = t.replace(URL_MASK_RE, (m) => {
    urls.push(m);
    return `__URL_${urls.length - 1}__`;
  });

  // 1) isim / terim tutarlılığı (kelime sınırlarıyla)
  for (const [from, to] of Object.entries(glossary)) {
    if (from === to || from.startsWith('_')) continue;
    const re = new RegExp(
      '(?<![\\p{L}\\p{N}])' + from.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '(?![\\p{L}\\p{N}])',
      'gu'
    );
    t = t.replace(re, to);
  }

  // 2) baştaki kaçak noktalama (paragraf bölünmesi artığı)
  if (/^[\s]*[,;:]/.test(t)) {
    t = t.replace(/^[\s,;:]+/, '');
    if (t) t = t.charAt(0).toLocaleUpperCase('tr') + t.slice(1);
  }

  // 3) noktalama / boşluk, Rusça fısıltı ayracı {...} ve kıvrık tipografi düzeltmeleri
  t = t
    .replace(/[\u300E\u300C]\s*/g, '‘')
    .replace(/\s*[\u300F\u300D]/g, '’')
    .replace(/\{\s+/g, '{')
    .replace(/\s+\}/g, '}')
    .replace(/(?<=[\p{L}\p{N},.;:!?…”])\{/gu, ' {')
    .replace(/\}(?=[\p{L}\p{N}“])/gu, '} ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/(?<!\d)([,;:])(?=\S)/g, '$1 ')
    .replace(/\.{2,}/g, '…')
    .replace(/…\.+/g, '…')
    .replace(/,\s*…/g, '…')
    .replace(/([!?])\.+/g, '$1')
    .replace(/[\u201e]/g, '“')
    .replace(/\u2013/g, '—')
    .replace(/(?<!\p{L})(\d+)\.\s*Bölüm(?!\p{L})/gu, 'Bölüm $1')
    .replace(/(?<!\p{L})(\d+)\.\s*Kısım(?!\p{L})/gu, 'Kısım $1')
    .replace(/\s+—\s+/g, ' — ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();

  t = curlyQuotesAndApostrophes(t);
  t = balanceCurlyQuotes(t);
  t = t.replace(DETACHED_QUOTE_SUFFIX_RE, '$1');
  t = t.replace(/__URL_(\d+)__/g, (_, idx) => urls[Number(idx)]);

  return t.trim();
}

// DeepL varsayılan; Google yalnızca DeepL belirgin şekilde kırpılmışsa/bozuksa devreye girer
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
  const volCfg = resolveVolume(volKey);
  if (!volCfg && !options.inFile) {
    throw new Error(`Bilinmeyen cilt: ${volKey}`);
  }
  const inFile = options.inFile || volCfg.bilingualFile;
  const outFile = options.outFile || volCfg.finalFile;
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
      `Cilt ${volCfg ? volCfg.key : volKey} | paragraf: ${total} | DeepL: ${pickedD} | Google: ${pickedG} | dosya: ${path.relative(ROOT, outFile)}`
    );
  }
  return { out, total, pickedD, pickedG };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const volume = parseVolumeArg(args, '4');
  const pIdx = args.indexOf('--pages');
  const pages = pIdx > -1 && args[pIdx + 1] ? String(args[pIdx + 1]) : null;
  if (!resolveVolume(volume)) {
    console.error(`Bilinmeyen cilt: ${volume}`);
    process.exit(1);
  }
  runMerge({ volume, pages });
}

module.exports = {
  DEFAULT_GLOSSARY,
  loadGlossary,
  balanceCurlyQuotes,
  polish,
  preferGoogle,
  parsePageRange,
  runMerge,
};
