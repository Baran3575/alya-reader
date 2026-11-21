// İngilizce kaynak metindeki OCR ve PDF ligatür bozulmalarını onarır (source.json).
// Sayfa ve paragraf sayısı değişmez; yalnızca metin normalleştirilir.
// Kullanım: node scripts/fix_en_ocr.js [--vol <cilt>] [--dry]
const fs = require('fs');
const path = require('path');
const { VOLUME_KEYS, VOLUMES } = require('./lib/volumes');

const AD_RE = /(zerobooks|jnovels|download our mobile app|download all your|stay up to date|light novels by|thousands of ln readers|join our discord|glucose translation|yen press|patreon|discord\.gg|follow us on|visit www|https?:\/\/|isbn|all rights reserved|translation by)/i;

const FULLWIDTH = /[\uFF01-\uFF5E]/g;
const BOX = /[\u2500-\u257F\u2580-\u259F]/g;

// Güvenli kopuk PDF ff / ffi ligatür birleştirme kuralları
// ("brief", "relief", "chief", "mischief", "handkerchief", "proof", "belief", "behalf", "elf" korunur)
const LIGATURE_RULES = [
  // ffi ligatürleri
  [/\b([Oo])f\s+(icial(?:ly|s)?|ice(?:r|rs|s)?)\b/g, '$1ff$2'],
  [/\b([Dd])if\s+(icult(?:y|ies)?)\b/g, '$1iff$2'],
  [/\b([Tt])raf\s+(ic(?:king|ked)?)\b/g, '$1raff$2'],
  [/\b([Ss])uf\s+(icien(?:t|tly|cy)|ix(?:es)?)\b/g, '$1uff$2'],
  [/\b([Aa])f\s+(iliat(?:e|ed|es|ion)|irm(?:ed|ative|s)?)\b/g, '$1ff$2'],
  [/\b([CcMm])([ou])f\s+(in(?:s)?)\b/g, '$1$2ff$3'],
  // ff ligatürleri
  [/\b([Dd])if\s+(eren(?:t|tly|ce|ces|tiate|tiated|tiating))\b/g, '$1iff$2'],
  [/\b([Ee])f\s+(ect(?:s|ive|ively|iveness)?|ort(?:s|less|lessly)?)\b/g, '$1ff$2'],
  [/\b([Aa])f\s+(ord(?:able|ed|s|ing)?|ect(?:ed|ing|ion|ionate|s)?|air(?:s)?)\b/g, '$1ff$2'],
  [/\b([Oo])f\s+(er(?:ed|ing|ings|s)?|end(?:ed|ing|er|s)?|ens(?:e|es|ive|ively))\b/g, '$1ff$2'],
  [/\b([Ss])uf\s+(er(?:ed|ing|s)?|ocat(?:e|ed|ing|ion))\b/g, '$1uff$2'],
  [/\b([Cc])of\s+(ee)\b/g, '$1off$2'],
  [/\b([Bb])uf\s+(et|er(?:s|ed|ing)?)\b/g, '$1uff$2'],
  [/\b([Ss])tuf(?=\s+[a-z])/g, '$1tuff'],
  [/\b([Ss])troganof\b/g, '$1troganoff'],
  // İki f karakterinin birden düştüğü açık ligatür boşlukları
  [/\b([Oo])\s+(icial(?:ly|s)?|icer(?:s)?)\b/g, '$1ff$2'],
  [/\b([Dd])i\s+(eren(?:t|tly|ce|ces)|icult(?:y|ies)?)\b/g, '$1iff$2'],
  [/\b([Ee])\s+(ect(?:s|ive|ively)?|ort(?:s|less)?)\b/g, '$1ff$2'],
  [/\b([Ss])u\s+(er(?:ed|ing|s)?)\b/g, '$1uff$2'],
];

function fixLigatures(text) {
  let s = String(text || '');
  for (const [re, rep] of LIGATURE_RULES) {
    s = s.replace(re, rep);
  }
  return s;
}

function normalise(t) {
  let s = t;
  const before = s;

  // tam genişlik karakterler -> ASCII eşdeğeri
  s = s.replace(FULLWIDTH, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  s = s.replace(/\uFF5E/g, '~').replace(/\u301C/g, '~');
  // kutu çizim karakterleri -> uzun çizgi
  s = s.replace(BOX, '—');
  // kopuk PDF ff/ffi ligatürlerini birleştir
  s = fixLigatures(s);
  // dekoratif ayraç/simge yığını satırları (OCR'ın sayfa süsü artıkları)
  s = s
    .split(/\n/)
    .filter((l) => !(l.trim().length > 2 && /^[\s{}[\]|<>~_*+=.,;:'"`-]+$/.test(l)))
    .join('\n');
  // satır içi "{}"|" artıkları
  s = s.replace(/[{}[\]|<>]{2,}/g, ' ').replace(/[ \t]{2,}/g, ' ');

  // OCR'da sık görülen kaçış artıkları
  s = s.replace(/\\{2,}/g, ' ').replace(/\s*\\\s*(?=[.,;:!?’”])/g, '');
  s = s.replace(/[ \t]+\\[ \t]+/g, ' ');
  // nokta/ünlem/soru sonrası boşluk
  s = s.replace(/([.!?])(?=[A-ZÇĞİÖŞÜa-zçğıöşü])/g, '$1 ');
  // üçten fazla nokta -> üç nokta
  s = s.replace(/\.{4,}/g, '...');
  // tire çevresindeki gereksiz boşluk
  s = s.replace(/\s+—\s+/g, ' — ');
  // çoklu boşluk (satır sonları korunur)
  s = s.replace(/[ \t]{2,}/g, ' ');

  return s === before ? null : s.trim();
}

function selectVolumes(args) {
  const selected = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '--vol' || a === '--volume' || a === '-v') && args[i + 1]) {
      selected.push(...String(args[i + 1]).split(',').map((x) => x.trim()).filter(Boolean));
      i++;
    } else if (/^--vol(?:ume)?=/.test(a)) {
      selected.push(...a.split('=')[1].split(',').map((x) => x.trim()).filter(Boolean));
    }
  }
  return selected.length ? selected : [...VOLUME_KEYS];
}

function runCli(args = process.argv.slice(2)) {
  const DRY = args.includes('--dry');
  const targets = selectVolumes(args);
  let changedPages = 0;
  const report = [];

  for (const k of targets) {
    const cfg = VOLUMES[k];
    if (!cfg || !fs.existsSync(cfg.sourceFile)) continue;
    const rawFile = fs.readFileSync(cfg.sourceFile, 'utf8');
    const indentMatch = rawFile.match(/^\[\n( +)\{/);
    const indent = indentMatch ? indentMatch[1].length : 2;
    const pages = JSON.parse(rawFile);

    // her sayfada aynı şekilde tekrarlanan ilk satır = üstbilgi
    const firstLineCount = new Map();
    for (const p of pages) {
      if (!p.text) continue;
      const fl = p.text.split(/\n/)[0].trim();
      if (fl.length > 8 && fl.length < 90) firstLineCount.set(fl, (firstLineCount.get(fl) || 0) + 1);
    }
    const runningHeaders = new Set([...firstLineCount].filter(([, c]) => c >= 12).map(([l]) => l));

    let changed = 0;
    for (const page of pages) {
      if (!page || typeof page.text !== 'string' || !page.text) continue;
      const origText = page.text;
      // reklam/filigran satırlarını ve tekrar eden üstbilgileri temizle
      const lines = page.text.split(/\n/);
      const kept = lines.filter((l) => !AD_RE.test(l) && !runningHeaders.has(l.trim()));
      let current = kept.length !== lines.length ? kept.join('\n').replace(/\n{3,}/g, '\n\n').trim() : page.text;

      const fixed = normalise(current);
      if (fixed !== null) current = fixed;

      if (current !== origText) {
        if (report.length < 25) {
          report.push({ vol: k, page: page.page, before: origText.slice(0, 80), after: current.slice(0, 80) });
        }
        page.text = current;
        changed++;
      }
    }
    if (changed && !DRY) fs.writeFileSync(cfg.sourceFile, JSON.stringify(pages, null, indent) + '\n');
    changedPages += changed;
    console.log(`Cilt ${k}: ${changed} sayfa onarıldı${DRY ? ' (önizleme)' : ''}`);
  }

  console.log('\ntoplam onarılan sayfa:', changedPages);
  for (const r of report.slice(0, 8)) {
    console.log(`  s.${r.page} [Cilt ${r.vol}]`);
    console.log('    önce :', r.before.replace(/\s+/g, ' '));
    console.log('    sonra:', r.after.replace(/\s+/g, ' '));
  }
  return { changedPages, report };
}

if (require.main === module) {
  runCli();
}

module.exports = { normalise, fixLigatures, selectVolumes, runCli };
