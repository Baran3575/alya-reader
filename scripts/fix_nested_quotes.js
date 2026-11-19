// İç içe alıntıların açılış tırnağını düzeltir: ’X -> ‘X (gerekirse boşluk ekler).
// Ayrıca ":’X" -> ": ‘X" kalıbını onarır.
// node scripts/fix_nested_quotes.js [--dry] [--show N]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'data/paragraphs_final.json',
  'data45/paragraphs_final.json',
  'data5/paragraphs_final.json',
  'data6/paragraphs_final.json',
  'data7/paragraphs_final.json',
  'data8/paragraphs_final.json',
  'data9/paragraphs_final.json',
  'data95/paragraphs_final.json',
  'data10/paragraphs_final.json',
  'data11/paragraphs_final.json',
  'data12/paragraphs_final.json',
  'data/quality/v4.json',
  'data/quality/v4.5.json',
  'data/quality/v5.json',
  'data/quality/v6.json',
  'data/quality/v7.json',
  'data/quality/v8.json',
  'data/quality/v9.json',
  'data/quality/v9.5.json',
  'data/quality/v10.json',
  'data/quality/v11.json',
  'data/quality/v12.json',
];

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const show = args.includes('--show') ? Number(args[args.indexOf('--show') + 1]) : 0;
let shown = 0;
let total = 0;

const CAP = 'A-ZÇĞİÖŞÜ';
const rules = [
  // ":’X" veya ": ’X"  ->  ": ‘X"
  [new RegExp(`:\\s*\u2019`, 'gu'), ': \u2018'],
  // "boşluk/noktalama + ’ + küçük harf" -> iç içe alıntı açılışı
  [new RegExp(`([\\s,;])["”]?\u2019(?=[a-zçğıöşü])`, 'gu'), '$1\u2018'],
  // "kelime’X" (boşluksuz) -> "kelime ‘X"
  [new RegExp(`([\\p{L}\\p{N}])["”]?\\u2019(?=[${CAP}])`, 'gu'), '$1 ‘'],
];

for (const rel of FILES) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue;
  const book = JSON.parse(fs.readFileSync(p, 'utf8'));
  let changed = 0;
  for (const k of Object.keys(book)) {
    const arr = book[k];
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      let t = String(arr[i]);
      const before = t;
      for (const [re, rep] of rules) t = t.replace(re, rep);
      if (t !== before) {
        if (dry && shown < show) {
          shown++;
          console.log(`  ${rel} s.${k}[${i}]\n    ÖNCE : ${JSON.stringify(before.slice(0, 140))}\n    SONRA: ${JSON.stringify(t.slice(0, 140))}`);
        }
        arr[i] = t;
        changed++;
        total++;
      }
    }
  }
  if (changed && !dry) fs.writeFileSync(p, JSON.stringify(book, null, 2) + '\n');
  if (changed) console.log(`${rel}: ${changed} paragraf`);
}
console.log(`${dry ? '(deneme) ' : ''}toplam ${total}`);
