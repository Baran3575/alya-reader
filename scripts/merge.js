// DeepL + Google çevirilerini birleştirir, terim/isim sözlüğü ve Türkçe kıvrık tırnak / noktalama düzeltmesi yapar.
// Kullanım:
//   node scripts/merge.js [--volume <4|4.5|5|...|12>] [--dir <dataDir>]
const fs = require('fs');
const path = require('path');
const { resolveVolumeDir } = require('./volumes');

const ROOT = path.join(__dirname, '..');
const GLOSSARY_FILE = path.join(ROOT, 'data/glossary.json');

const EN_LEFTOVER =
  /\b(the|and|you|your|was|were|with|that|this|have|has|she|her|his|they|their|from|what|would|could|just|because|about|there|then|when|which|into|been|being|are|but|for|him|how|does|did|of|on|to|so|if|we|my|me|or|an)\b/gi;

const DEFAULT_GLOSSARY = {
  Masaçika: 'Masachika',
  Maşaçika: 'Masachika',
  'Masachika-chan': 'Masachika-chan',
  Alişa: 'Alisa',
  Alisa: 'Alisa',
  Yuki: 'Yuki',
  Ayano: 'Ayano',
  Sayaka: 'Sayaka',
  Çisaki: 'Chisaki',
  Chisaki: 'Chisaki',
  Maşa: 'Masha',
  Suo: 'Suou',
  Toya: 'Touya',
  Nonoa: 'Nonoa',
  Saraşina: 'Sarashina',
  Kujo: 'Kujou',
  Kimishima: 'Kimishima',
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

function toCurlyQuotesAndBalanced(input) {
  let s = String(input || '');

  // Kelime içi kesme işaretlerini kıvrık kesmeye (’) dönüştür
  s = s.replace(/([\p{L}\p{N}])['‘`]([\p{L}\p{N}])/gu, '$1’$2');
  s = s.replace(/(\d)['‘`]([a-zçğıöşü])/giu, '$1’$2');

  // Kalan tek tırnakları bağlama göre kesme veya konuşma tırnağına dönüştür
  s = s.replace(/['‘`]/g, '’');

  // Mevcut tüm çift tırnak türevlerini sırayla “ ve ” olarak eşleştir
  s = s.replace(/[„«]/g, '“').replace(/[»]/g, '”');
  let open = true;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === '“' || ch === '”') {
      out += open ? '“' : '”';
      open = !open;
    } else {
      out += ch;
    }
  }
  // Sayfa bölünmesinden kalan tek tırnak varsa paragraf sonunda kapat
  if (!open) {
    out = out.trimEnd() + '”';
  }
  return out;
}

function balanceParentheses(input) {
  let s = String(input || '');
  let depth = 0;
  let out = '';
  for (const ch of s) {
    if (ch === '(') {
      depth++;
      out += ch;
    } else if (ch === ')') {
      if (depth > 0) {
        depth--;
        out += ch;
      }
    } else {
      out += ch;
    }
  }
  if (depth > 0) out += ')'.repeat(depth);
  return out;
}

function polish(text, glossary) {
  let t = String(text || '');

  // Çevirmen notu kalıntılarını temizle
  t = t
    .replace(/\((?:ÇN|TN|TL\s*note|Çevirmen\s*Notu)\s*:[^)]*\)/gi, '')
    .replace(/(?<!\p{L})(?:ÇN|TN)\s*:\s*/gu, '');

  // 1) İsim / terim tutarlılığı
  for (const [from, to] of Object.entries(glossary)) {
    if (from === to) continue;
    const re = new RegExp(
      '(?<![\\p{L}\\p{N}])' + from.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&') + '(?![\\p{L}\\p{N}])',
      'gu'
    );
    t = t.replace(re, to);
  }

  // 2) Baştaki kaçak noktalama
  if (/^[\s]*[,;:]/.test(t)) {
    t = t.replace(/^[\s,;:]+/, '');
    if (t) t = t.charAt(0).toLocaleUpperCase('tr') + t.slice(1);
  }

  // 3) Noktalama, üç nokta ve kıvrık tırnak düzeltmeleri
  t = t
    .replace(/\.{2,}/g, '…')
    .replace(/…+\.+/g, '…')
    .replace(/\.+…+/g, '…')
    .replace(/[!?]\.+/g, (m) => m[0])
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?…])/g, '$1')
    .replace(/(?<!\d)([,;:])(?=\S)/g, '$1 ')
    .replace(/\u2013/g, '—')
    .replace(/(?:^|(?<=[.!?]\s))—\s+/g, '—')
    .replace(/\b(\d+)\.\s*Bölüm\b/g, 'Bölüm $1')
    .replace(/\b(\d+)\.\s*Kısım\b/g, 'Kısım $1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();

  t = toCurlyQuotesAndBalanced(t);
  t = balanceParentheses(t);
  t = t.replace(/\s+([,.;:!?…])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();

  return t;
}

function preferGoogle(d, g) {
  if (!g || g.trim().split(' ').length < 3) return false;
  if (/^(Devamı|Yukarıdaki|Aşağıdaki|Çevirisi|Devam)\b/i.test(g.trim())) return false;
  if (g.length < d.length * 0.8) return false;
  const ld = (d.match(EN_LEFTOVER) || []).length;
  const lg = (g.match(EN_LEFTOVER) || []).length;
  return ld >= 2 && lg === 0;
}

function mergeVolume(dataDir) {
  const inFile = path.join(ROOT, dataDir, 'bilingual.json');
  const outFile = path.join(ROOT, dataDir, 'paragraphs_final.json');
  const data = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  const glossary = loadGlossary();
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
      .filter((s) => s.length > 0);
  }

  fs.writeFileSync(outFile, JSON.stringify(out) + '\n');
  const total = Object.values(out).reduce((a, b) => a + b.length, 0);
  console.log(
    `✓ [${dataDir}] birleştirildi -> paragraf: ${total} | DeepL: ${pickedD} | Google: ${pickedG} | ${path.relative(ROOT, outFile)}`
  );
  return outFile;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const vIdx = args.indexOf('--volume') > -1 ? args.indexOf('--volume') : args.indexOf('--vol');
  const dIdx = args.indexOf('--dir');
  const dataDir = dIdx > -1 && args[dIdx + 1]
    ? args[dIdx + 1]
    : resolveVolumeDir(vIdx > -1 ? args[vIdx + 1] : '4');
  mergeVolume(dataDir);
}

module.exports = { loadGlossary, polish, toCurlyQuotesAndBalanced, balanceParentheses, mergeVolume };
