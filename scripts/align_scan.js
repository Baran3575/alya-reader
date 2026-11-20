// PDF sayfa metinleri ile kitap sayfalarını hizalar; data<X>/scan_map.json üretir.
// Kullanım: node scripts/align_scan.js --vol 5 --pdf-text .work/pdf_text5.json --count 278
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};

const vol = arg('vol');
const pdfTextFile = arg('pdf-text');
const count = Number(arg('count', 0));
const dataDir = vol === '4' ? 'data' : 'data' + String(vol).replace('.', '');

const norm = (s) =>
  String(s)
    .normalize('NFKD')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const pdfPages = JSON.parse(fs.readFileSync(pdfTextFile, 'utf8')).map(norm);
const starts = [];
const joined = [];
let pos = 0;
for (const t of pdfPages) {
  starts.push(pos);
  joined.push(t);
  pos += t.length + 1;
}
const full = joined.join(' ');
const book = JSON.parse(fs.readFileSync(path.join('public', 'books', `v${vol}.json`), 'utf8'));

const pageOf = (idx) => {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= idx) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
};

const map = [];
let cursor = 0;
let miss = 0;
for (const p of book.pages) {
  const words = norm((p.en || []).slice(0, 3).join(' ')).split(' ').slice(0, 9).join(' ');
  if (!words) {
    map.push(null);
    continue;
  }
  let idx = full.indexOf(words, Math.max(0, cursor - 400));
  if (idx < 0) idx = full.indexOf(words);
  if (idx < 0) {
    map.push(null);
    miss += 1;
    continue;
  }
  cursor = idx;
  map.push(pageOf(idx));
}

// boşlukları komşularla doldur
let prev = null;
for (let i = 0; i < map.length; i++) {
  if (map[i] === null) {
    const nxt = map.slice(i + 1).find((x) => x);
    map[i] = prev || nxt || 1;
  }
  prev = map[i];
}

fs.writeFileSync(
  path.join(dataDir, 'scan_map.json'),
  JSON.stringify({ map, dir: 'scan', count: count || pdfPages.length })
);

const bad = map.filter((v, i) => i > 0 && v < map[i - 1]).length;
console.log(
  `✓ Cilt ${vol}: ${map.length} sayfa eşlendi (eşleşmeyen ${miss}, geri gidiş ${bad}), ` +
    `PDF ${map[0]}–${map[map.length - 1]} -> ${dataDir}/scan_map.json`
);
