// DeepL + Google çevirilerini birleştirir, terim/isim sözlüğü ve noktalama düzeltmesi yapar.
// Çıktı: data<vol>/paragraphs_final.json  ({ "1": ["paragraf", ...], ... })
// Kullanım: node scripts/merge.js [--volume <v>]
const fs = require('fs');
const path = require('path');
const { ROOT, resolveVolume, parseVolumeArg } = require('./lib/volumes');

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
      const raw = JSON.parse(fs.readFileSync(GLOSSARY_FILE, 'utf8'));
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
    .replace(/[「『]+\s*/g, '\u201c')
    .replace(/\s*[」』]+/g, '\u201d')
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

// DeepL varsayılan; Google yalnızca DeepL belirgin şekilde kırpılmışsa/bozuksa devreye girer
function preferGoogle(d, g) {
  if (!g || g.trim().split(' ').length < 3) return false;
  if (/^(Devamı|Yukarıdaki|Aşağıdaki|Çevirisi|Devam)\b/i.test(g.trim())) return false;
  if (g.length < d.length * 0.8) return false;
  const ld = (d.match(EN_LEFTOVER) || []).length;
  const lg = (g.match(EN_LEFTOVER) || []).length;
  return ld >= 2 && lg === 0;
}

if (require.main === module) {
  const volKey = parseVolumeArg(process.argv.slice(2), '4');
  const volCfg = resolveVolume(volKey);
  if (!volCfg) {
    console.error(`Bilinmeyen cilt: ${volKey}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(volCfg.bilingualFile, 'utf8'));
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

  fs.writeFileSync(volCfg.finalFile, JSON.stringify(out));
  const total = Object.values(out).reduce((a, b) => a + b.length, 0);
  console.log(`Cilt ${volCfg.key} | paragraf: ${total} | DeepL: ${pickedD} | Google: ${pickedG} | dosya: ${volCfg.finalRel}`);
}

module.exports = {
  polish,
  balanceCurlyQuotes,
  loadGlossary,
  preferGoogle,
};
