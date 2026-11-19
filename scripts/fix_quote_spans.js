// Sayfa içinde bölünmüş tırnakları (açılış bir paragrafta, kapanış sonrakinde) yeniden birleştirir.
// node scripts/fix_quote_spans.js [--dry]
const fs = require('fs');
const VOLS = {
  '4': 'data/paragraphs_final.json', '4.5': 'data45/paragraphs_final.json', '5': 'data5/paragraphs_final.json',
  '6': 'data6/paragraphs_final.json', '7': 'data7/paragraphs_final.json', '8': 'data8/paragraphs_final.json',
  '9': 'data9/paragraphs_final.json', '9.5': 'data95/paragraphs_final.json', '10': 'data10/paragraphs_final.json',
  '11': 'data11/paragraphs_final.json', '12': 'data12/paragraphs_final.json',
};
const dry = process.argv.includes('--dry');
const o = (t) => (t.match(/“/g) || []).length;
const c = (t) => (t.match(/”/g) || []).length;

let total = 0;
for (const [vol, file] of Object.entries(VOLS)) {
  if (!fs.existsSync(file)) continue;
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  let n = 0;
  for (const page of Object.keys(book)) {
    const ps = book[page];
    if (!Array.isArray(ps)) continue;
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < ps.length - 1; i++) {
        const a = ps[i];
        const b = ps[i + 1];
        if (!a || !b) continue;
        const aOpen = o(a) - c(a);
        const bClose = c(b) - o(b);
        if (aOpen === 1 && bClose === 1 && !b.trimStart().startsWith('“')) {
          ps.splice(i, 2, a.trimEnd() + ' ' + b.trimStart());
          n++;
          changed = true;
          break;
        }
      }
    }
  }
  if (n) {
    total += n;
    if (!dry) fs.writeFileSync(file, JSON.stringify(book, null, 2) + '\n');
    console.log(`Cilt ${vol}: ${n} bölünmüş tırnak birleştirildi${dry ? ' (deneme)' : ''}`);
  }
}
console.log('Toplam: ' + total);
