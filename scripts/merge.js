// DeepL + Google çevirilerini birleştirir, terim/isim sözlüğü ve noktalama düzeltmesi yapar.
// Çıktı: data<vol>/paragraphs_final.json  ({ "1": ["paragraf", ...], ... })
// Kullanım: node scripts/merge.js [--volume <v>]
const fs = require('fs');
const path = require('path');
const { ROOT, resolveVolume, parseVolumeArg } = require('./lib/volumes');
const { isUsableSourcePage, isTocSourcePage, SKIP_PAGE_RE } = require('./translate3');
const { splitLeadingSentence, capitalizeTurkishStart } = require('./fix_boundaries');

const GLOSSARY_FILE = path.join(ROOT, 'data/glossary.json');

const EN_LEFTOVER = /\b(the|and|you|your|was|were|with|that|this|have|has|she|her|his|they|their|from|what|would|could|just|because|about|there|then|when|which|into|been|being|are|but|for|him|how|does|did|of|on|to|so|if|we|my|me|or|an)\b/gi;

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

function loadGlossary(glossaryFile = GLOSSARY_FILE) {
  if (fs.existsSync(glossaryFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(glossaryFile, 'utf8'));
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
    .replace(/['\u2018\u02bc`]/g, '\u2019')
    .replace(/[\u201e\u00ab]/g, '\u201c')
    .replace(/\u00bb/g, '\u201d');

  const hasStraightDouble = t.includes('"');
  const openCount = (t.match(/\u201c/g) || []).length;
  const closeCount = (t.match(/\u201d/g) || []).length;

  if (!hasStraightDouble && openCount === closeCount) {
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

  // 1) isim / terim tutarlılığı (kelime sınırlarıyla)
  for (const [from, to] of Object.entries(glossary)) {
    if (from === to || from.startsWith('_')) continue;
    const re = new RegExp('(?<![\\p{L}\\p{N}])' + from.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'gu');
    t = t.replace(re, to);
  }

  // 2) baştaki kaçak noktalama (paragraf bölünmesi artığı)
  if (/^[\s]*[,;:]/.test(t)) {
    t = t.replace(/^[\s,;:]+/, '');
    if (t) t = t.charAt(0).toLocaleUpperCase('tr') + t.slice(1);
  }

  // 3) noktalama / boşluk, Rusça fısıltı ayracı {...} ve kıvrık tırnak düzeltmeleri
  t = t
    .replace(/\{\s+/g, '{')
    .replace(/\s+\}/g, '}')
    .replace(/(?<=[\p{L}\p{N},.;:!?…”])\{/gu, ' {')
    .replace(/\}(?=[\p{L}\p{N}“])/gu, '} ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/(?<!\d)([,;:])(?=\S)/g, '$1 ')
    .replace(/\.{2,}/g, '…')
    .replace(/…\.+/g, '…')
    .replace(/([!?])\.+/g, '$1')
    .replace(/\u2013/g, '—')
    .replace(/\b(\d+)\.\s*Bölüm\b/g, 'Bölüm $1')
    .replace(/\b(\d+)\.\s*Kısım\b/g, 'Kısım $1')
    .replace(/\s+—\s+/g, ' — ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();

  t = balanceCurlyQuotes(t);
  return t.trim();
}

const ENDS = /[.!?"”'\u2019…~)\]»*}◇⋆]$/;

// DeepL varsayılan; Google yalnızca DeepL belirgin şekilde kırpılmışsa/bozuksa devreye girer
function preferGoogle(d, g) {
  if (!g || g.trim().split(' ').length < 3) return false;
  if (/^(Devamı|Yukarıdaki|Aşağıdaki|Çevirisi|Devam)\b/i.test(g.trim())) return false;
  if (g.length < d.length * 0.8) return false;
  const ld = (d.match(EN_LEFTOVER) || []).length;
  const lg = (g.match(EN_LEFTOVER) || []).length;
  return ld >= 2 && lg === 0;
}

function stitchMergedPages(out, sourcePages = null) {
  const skipSet = new Set();
  const tocSet = new Set();
  const enSplitAfter = new Set();

  if (Array.isArray(sourcePages)) {
    const usableOrder = [];
    for (const p of sourcePages) {
      const k = String(p.page);
      if ((p && p.pending) || SKIP_PAGE_RE.test(String(p.text || ''))) {
        skipSet.add(k);
        out[k] = [];
        continue;
      }
      if (isTocSourcePage(p)) {
        tocSet.add(k);
        continue;
      }
      if (isUsableSourcePage(p)) {
        usableOrder.push(p);
      }
    }
    for (let i = 0; i < usableOrder.length - 1; i++) {
      const cur = usableOrder[i];
      const cleaned = String(cur.text || '')
        .replace(/Page\s+\d+/gi, '')
        .replace(/(Goldenagato|mp4directs|jnovels|zerobooks).*$/gim, '')
        .trim();
      if (cleaned && !/[.!?"”'\u2019…~)\]»*}◇⋆]$/.test(cleaned)) {
        enSplitAfter.add(String(cur.page));
      }
    }
  }

  const pageKeys = Object.keys(out)
    .filter((k) => /^\d+$/.test(k) && !skipSet.has(k) && !tocSet.has(k) && Array.isArray(out[k]) && out[k].length > 0)
    .map(Number)
    .sort((a, b) => a - b)
    .map(String);

  for (let i = 0; i < pageKeys.length - 1; i++) {
    const pk = pageKeys[i];
    const nk = pageKeys[i + 1];
    const curArr = out[pk];
    const nextArr = out[nk];
    if (!curArr || !curArr.length || !nextArr || !nextArr.length) continue;
    if (/^İçindekiler\b/i.test(curArr[0] || '')) continue;

    const lastIdx = curArr.length - 1;
    const lastPara = curArr[lastIdx].trim();
    const firstNext = nextArr[0].trim();

    const opensP = (lastPara.match(/\(/g) || []).length > (lastPara.match(/\)/g) || []).length;
    const opensQ = (lastPara.match(/[“”"]/g) || []).length % 2 !== 0;
    const lacksEnd = !ENDS.test(lastPara);
    const nextLower = /^[a-zçğıöşü,;:\])]/.test(firstNext);

    if (lacksEnd || opensP || opensQ || nextLower || (enSplitAfter.has(pk) && nextLower)) {
      const [head, tail] = splitLeadingSentence(firstNext, { needCloseParen: opensP, needCloseQuote: opensQ });
      const base = nextLower && /\.\s*$/.test(lastPara) ? lastPara.replace(/\.\s*$/, '') : lastPara;
      curArr[lastIdx] = balanceCurlyQuotes((base + (base.endsWith('-') ? '' : ' ') + head).replace(/\s{2,}/g, ' ').trim());
      if (tail) {
        nextArr[0] = balanceCurlyQuotes(capitalizeTurkishStart(tail));
      } else {
        nextArr.shift();
      }
    }
  }
  return out;
}

function mergeBilingual(data, glossary = loadGlossary(), sourcePages = null) {
  const out = {};
  let pickedD = 0;
  let pickedG = 0;

  for (const [page, paras] of Object.entries(data)) {
    if (!Array.isArray(paras)) continue;
    out[page] = paras
      .map((p) => {
        const d = (p && p.d) || '';
        const g = (p && p.g) || '';
        let chosen = d;
        if (!d) chosen = g;
        else if (g && preferGoogle(d, g)) chosen = g;
        if (chosen === d && d) pickedD++;
        else if (chosen === g && g) pickedG++;
        return polish(chosen, glossary);
      })
      .filter(Boolean);
  }

  stitchMergedPages(out, sourcePages);
  return { out, pickedD, pickedG };
}

if (require.main === module) {
  const volKey = parseVolumeArg(process.argv.slice(2), '4');
  const volCfg = resolveVolume(volKey);
  if (!volCfg) {
    console.error(`Bilinmeyen cilt: ${volKey}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(volCfg.bilingualFile, 'utf8'));
  const sourcePages = fs.existsSync(volCfg.sourceFile)
    ? JSON.parse(fs.readFileSync(volCfg.sourceFile, 'utf8'))
    : null;
  const glossary = loadGlossary();
  const { out, pickedD, pickedG } = mergeBilingual(data, glossary, sourcePages);

  fs.writeFileSync(volCfg.finalFile, JSON.stringify(out));
  const total = Object.values(out).reduce((a, b) => a + b.length, 0);
  console.log(`Cilt ${volCfg.key} | paragraf: ${total} | DeepL: ${pickedD} | Google: ${pickedG} | dosya: ${volCfg.finalRel}`);
}

module.exports = {
  polish,
  balanceCurlyQuotes,
  loadGlossary,
  preferGoogle,
  stitchMergedPages,
  mergeBilingual,
};
