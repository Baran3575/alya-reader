// Kaynak (EN) metinlerdeki çevirmen notlarını (TN) sayfa sayfa çıkarır.
// node scripts/tn_extract.js            -> tüm ciltler, özet
// node scripts/tn_extract.js 4.5        -> tek cilt, notları döker
const fs = require('fs');
const path = require('path');

const VOLS = {
  '4': 'data/source.json',
  '4.5': 'data45/source.json',
  '5': 'data5/source.json',
  '6': 'data6/source.json',
  '7': 'data7/source.json',
  '8': 'data8/source.json',
  '9': 'data9/source.json',
  '9.5': 'data95/source.json',
  '10': 'data10/source.json',
  '11': 'data11/source.json',
  '12': 'data12/source.json',
};

const TN = /\((?:TN|ÇN)\s*:\s*([^)]{3,400})\)/giu;

function unwrap(t) {
  return String(t || '')
    .replace(/-\n/g, '')
    .replace(/\n(?!\n)/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function scan(file) {
  const src = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pages = Array.isArray(src) ? src : Object.values(src);
  const out = [];
  pages.forEach((p, i) => {
    const text = unwrap(p && p.text);
    let m;
    TN.lastIndex = 0;
    while ((m = TN.exec(text))) {
      out.push({ page: i + 1, note: m[1].replace(/\s+/g, ' ').trim() });
    }
  });
  return out;
}

const arg = process.argv[2];
const vols = arg ? [arg] : Object.keys(VOLS);
let total = 0;
for (const v of vols) {
  const file = path.join(__dirname, '..', VOLS[v]);
  if (!fs.existsSync(file)) continue;
  const notes = scan(file);
  total += notes.length;
  console.log(`Cilt ${v}: ${notes.length} not`);
  if (arg) notes.forEach((n) => console.log(`  s.${n.page}: ${n.note}`));
}
console.log('toplam:', total);
