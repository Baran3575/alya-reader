// DeepL + Google çevirilerini birleştirir, terim/isim sözlüğü ve noktalama düzeltmesi yapar.
// Çıktı: data/paragraphs_final.json  ({ "1": ["paragraf", ...], ... })
const fs = require('fs');
const path = require('path');
const { orientCurlyQuotes } = require('../scripts/qc/qc6_typography');

const ROOT = path.join(__dirname, '..');
const IN = path.join(ROOT, 'data45/bilingual.json');
const OUT = path.join(ROOT, 'data45/paragraphs_final.json');
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

function loadGlossary() {
  if (fs.existsSync(GLOSSARY_FILE)) {
    try {
      return { ...DEFAULT_GLOSSARY, ...JSON.parse(fs.readFileSync(GLOSSARY_FILE, 'utf8')) };
    } catch {}
  }
  return DEFAULT_GLOSSARY;
}

function polish(text, glossary) {
  let t = text;

  // 1) isim / terim tutarlılığı (kelime sınırlarıyla)
  for (const [from, to] of Object.entries(glossary)) {
    if (from === to) continue;
    const re = new RegExp('(?<![\\p{L}\\p{N}])' + from.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'gu');
    t = t.replace(re, to);
  }

  // 2) baştaki kaçak noktalama (paragraf bölünmesi artığı)
  if (/^[\s]*[,;:]/.test(t)) {
    t = t.replace(/^[\s,;:]+/, '');
    if (t) t = t.charAt(0).toLocaleUpperCase('tr') + t.slice(1);
  }

  // 3) noktalama / boşluk düzeltmeleri ve bağlamsal kıvrık tırnak yönlendirme
  t = t
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/(?<!\d)([,;:])(?=\S)/g, '$1 ')
    .replace(/…\./g, '…')
    .replace(/\u2013/g, '—')
    .replace(/\b(\d+)\.\s*Bölüm\b/g, 'Bölüm $1')
    .replace(/\b(\d+)\.\s*Kısım\b/g, 'Kısım $1')
    .replace(/\.{4,}/g, '…')
    .replace(/\s+—\s+/g, ' — ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();

  t = orientCurlyQuotes(t);
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

const data = JSON.parse(fs.readFileSync(IN, 'utf8'));
const glossary = loadGlossary();
const out = {};
let pickedD = 0;
let pickedG = 0;

for (const [page, paras] of Object.entries(data)) {
  if (!Array.isArray(paras)) continue;
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

fs.writeFileSync(OUT, JSON.stringify(out));
const total = Object.values(out).reduce((a, b) => a + b.length, 0);
console.log('paragraf:', total, '| DeepL:', pickedD, '| Google:', pickedG, '| dosya: data/paragraphs_final.json');
