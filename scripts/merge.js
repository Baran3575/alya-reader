// DeepL + Google çevirilerini birleştirir, terim/isim sözlüğü ve noktalama düzeltmesi yapar.
// Çıktı: data/paragraphs_final.json  ({ "1": ["paragraf", ...], ... })
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { resolveVolumePaths, isUsableSourcePage, isTocSourcePage, SKIP_PAGE_RE } = require('./translate3');

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

const GLOSSARY_FILE = path.join(ROOT, 'data/glossary.json');

function loadGlossary(glossaryFile = GLOSSARY_FILE) {
  if (fs.existsSync(glossaryFile)) {
    try {
      return { ...DEFAULT_GLOSSARY, ...JSON.parse(fs.readFileSync(glossaryFile, 'utf8')) };
    } catch {}
  }
  return DEFAULT_GLOSSARY;
}

function polish(text, glossary) {
  let t = text;

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

  // 3) noktalama / boşluk düzeltmeleri
  t = t
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/(?<!\d)([,;:])(?=\S)/g, '$1 ')
    .replace(/…\./g, '…')
    .replace(/\u2019/g, "'")
    .replace(/[\u201c\u201d\u201e]/g, '"')
    .replace(/\u2013/g, '—')
    .replace(/\b(\d+)\.\s*Bölüm\b/g, 'Bölüm $1')
    .replace(/\b(\d+)\.\s*Kısım\b/g, 'Kısım $1')
    .replace(/\.{4,}/g, '…')
    .replace(/\s+—\s+/g, ' — ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();

  return t.trim();
}

function score(text) {
  if (!text) return -1;
  const leftovers = (text.match(EN_LEFTOVER) || []).length;
  const words = text.split(/\s+/).length;
  return -leftovers / Math.max(words, 1);
}

// Cümle sonu var mı (kesilmiş metin tespiti için)
const ENDS = /[.!?"”…~)\]»]$/;
const endsOk = (t) => ENDS.test((t || '').trim());

// DeepL varsayılan; Google yalnızca DeepL belirgin şekilde kırpılmışsa/bozuksa devreye girer
function preferGoogle(d, g) {
  if (!g || g.trim().split(' ').length < 3) return false;
  if (/^(Devamı|Yukarıdaki|Aşağıdaki|Çevirisi|Devam)\b/i.test(g.trim())) return false;
  if (g.length < d.length * 0.8) return false;
  const ld = (d.match(EN_LEFTOVER) || []).length;
  const lg = (g.match(EN_LEFTOVER) || []).length;
  return ld >= 2 && lg === 0;
}

const { splitLeadingSentence, capitalizeTurkishStart } = require('./fix_boundaries');

function stitchMergedPages(out, sourcePages = null) {
  const skipSet = new Set();
  const tocSet = new Set();
  const enSplitAfter = new Set();

  if (Array.isArray(sourcePages)) {
    const usableOrder = [];
    for (const p of sourcePages) {
      const k = String(p.page);
      if (SKIP_PAGE_RE.test(String(p.text || ''))) {
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
      if (cleaned && !/[.!?"”'\u2019…~)\]»*}◇]$/.test(cleaned)) {
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
      curArr[lastIdx] = (base + (base.endsWith('-') ? '' : ' ') + head).replace(/\s{2,}/g, ' ').trim();
      if (tail) {
        nextArr[0] = capitalizeTurkishStart(tail);
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
  const args = process.argv.slice(2);
  const vIdx = args.indexOf('--volume') > -1 ? args.indexOf('--volume') : args.indexOf('--vol');
  const vol = vIdx > -1 && args[vIdx + 1] ? args[vIdx + 1] : '4';
  const { src: SRC, out: IN, fin: OUT, dir } = resolveVolumePaths(vol);

  const data = JSON.parse(fs.readFileSync(IN, 'utf8'));
  const sourcePages = fs.existsSync(SRC) ? JSON.parse(fs.readFileSync(SRC, 'utf8')) : null;
  const glossary = loadGlossary();
  const { out, pickedD, pickedG } = mergeBilingual(data, glossary, sourcePages);

  fs.writeFileSync(OUT, JSON.stringify(out));
  const total = Object.values(out).reduce((a, b) => a + b.length, 0);
  console.log(`paragraf: ${total} | DeepL: ${pickedD} | Google: ${pickedG} | dosya: ${dir}/paragraphs_final.json`);
}

module.exports = { loadGlossary, polish, preferGoogle, stitchMergedPages, mergeBilingual };
