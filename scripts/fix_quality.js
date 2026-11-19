// Elle yeniden yazılan sayfaları uygular.
// data/quality/v<CİLT>.json = { "<sayfa>": ["yeni paragraf", ...], ... }
// Kullanım: node scripts/fix_quality.js [--dry] [--vol 4]
const fs = require('fs');
const path = require('path');
const VOLS = {
  '4': 'data/paragraphs_final.json',
  '4.5': 'data45/paragraphs_final.json',
  '5': 'data5/paragraphs_final.json',
  '6': 'data6/paragraphs_final.json',
  '7': 'data7/paragraphs_final.json',
  '8': 'data8/paragraphs_final.json',
  '9': 'data9/paragraphs_final.json',
  '9.5': 'data95/paragraphs_final.json',
  '10': 'data10/paragraphs_final.json',
  '11': 'data11/paragraphs_final.json',
  '12': 'data12/paragraphs_final.json',
};
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const only = args.includes('--vol') ? args[args.indexOf('--vol') + 1] : null;

let changed = 0;
for (const [vol, target] of Object.entries(VOLS)) {
  if (only && vol !== only) continue;
  const patchFile = path.join('data', 'quality', 'v' + vol + '.json');
  if (!fs.existsSync(patchFile)) continue;
  const patch = JSON.parse(fs.readFileSync(patchFile, 'utf8'));
  const book = JSON.parse(fs.readFileSync(target, 'utf8'));
  let n = 0;
  for (const [page, paras] of Object.entries(patch)) {
    if (!Array.isArray(paras)) continue;
    if (JSON.stringify(book[page]) === JSON.stringify(paras)) continue;
    book[page] = paras;
    n++;
  }
  if (n) {
    changed += n;
    if (!dry) fs.writeFileSync(target, JSON.stringify(book, null, 2) + '\n');
  }
  console.log(`Cilt ${vol}: ${n} sayfa ${dry ? '(deneme)' : 'uygulandı'} — ${target}`);
}
console.log(dry ? 'Toplam (deneme): ' + changed : 'Toplam sayfa: ' + changed);
