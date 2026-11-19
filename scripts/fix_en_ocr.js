// İngilizce kaynak metindeki OCR bozulmalarını onarır (source.json).
// Sayfa ve paragraf sayısı değişmez; yalnızca metin normalleştirilir.
// Kullanım: node scripts/fix_en_ocr.js [--dry]
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { VOLUME_KEYS, VOLUMES } = require('./lib/volumes');
const DRY = process.argv.includes('--dry');

const AD_RE = /(zerobooks|jnovels|download our mobile app|download all your|stay up to date|light novels by|thousands of ln readers|join our discord|glucose translation|yen press|patreon|discord\.gg|follow us on|visit www|https?:\/\/|isbn|all rights reserved|translation by)/i;

const FULLWIDTH = /[\uFF01-\uFF5E]/g;
const BOX = /[\u2500-\u257F\u2580-\u259F]/g;

function normalise(t) {
  let s = t;
  const before = s;

  // tam genişlik karakterler -> ASCII eşdeğeri
  s = s.replace(FULLWIDTH, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  s = s.replace(/\uFF5E/g, '~').replace(/\u301C/g, '~');
  // kutu çizim karakterleri -> uzun çizgi
  s = s.replace(BOX, '—');
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

let changedPages = 0;
const report = [];

for (const k of VOLUME_KEYS) {
  const cfg = VOLUMES[k];
  if (!fs.existsSync(cfg.sourceFile)) continue;
  const pages = JSON.parse(fs.readFileSync(cfg.sourceFile, 'utf8'));

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
    // reklam/filigran satırlarını ve tekrar eden üstbilgileri temizle
    const lines = page.text.split(/\n/);
    const kept = lines.filter((l) => !AD_RE.test(l) && !runningHeaders.has(l.trim()));
    if (kept.length !== lines.length) {
      page.text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      changed++;
      continue; // satır temizliği yapıldı; ayrıca normalleştirme gerekiyorsa sonraki çalıştırmada ele alınır
    }

    const fixed = normalise(page.text);
    if (fixed === null) continue;
    if (report.length < 25) report.push({ vol: k, page: page.page, before: page.text.slice(0, 80), after: fixed.slice(0, 80) });
    page.text = fixed;
    changed++;
  }
  if (changed && !DRY) fs.writeFileSync(cfg.sourceFile, JSON.stringify(pages, null, 1) + '\n');
  changedPages += changed;
  console.log(`Cilt ${k}: ${changed} sayfa onarıldı${DRY ? ' (önizleme)' : ''}`);
}

console.log('\ntoplam onarılan sayfa:', changedPages);
for (const r of report.slice(0, 8)) {
  console.log(`  s.${r.page} [Cilt ${r.vol}]`);
  console.log('    önce :', r.before.replace(/\s+/g, ' '));
  console.log('    sonra:', r.after.replace(/\s+/g, ' '));
}
