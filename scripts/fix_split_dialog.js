// Sayfa sonunda yarım kalan tırnaklı repliği, sonraki sayfanın ilk paragrafıyla birleştirir.
// Böylece tırnaklar dengelenir ve cümle bütünlenir.
// node scripts/fix_split_dialog.js [--dry] [--vol 4]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGETS = {
  '4': ['data/paragraphs_final.json', 'data/quality/v4.json'],
  '4.5': ['data45/paragraphs_final.json', 'data/quality/v4.5.json'],
  '5': ['data5/paragraphs_final.json', 'data/quality/v5.json'],
  '6': ['data6/paragraphs_final.json', 'data/quality/v6.json'],
  '7': ['data7/paragraphs_final.json', 'data/quality/v7.json'],
  '8': ['data8/paragraphs_final.json', 'data/quality/v8.json'],
  '9': ['data9/paragraphs_final.json', 'data/quality/v9.json'],
  '9.5': ['data95/paragraphs_final.json', 'data/quality/v9.5.json'],
  '10': ['data10/paragraphs_final.json', 'data/quality/v10.json'],
  '11': ['data11/paragraphs_final.json', 'data/quality/v11.json'],
  '12': ['data12/paragraphs_final.json', 'data/quality/v12.json'],
};

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const only = args.includes('--vol') ? args[args.indexOf('--vol') + 1] : null;
const show = args.includes('--show') ? Number(args[args.indexOf('--show') + 1]) : 0;
let shown = 0;

const openQ = (s) => (s.match(/“/g) || []).length;
const closeQ = (s) => (s.match(/”/g) || []).length;

for (const [vol, files] of Object.entries(TARGETS)) {
  if (only && vol !== only) continue;
  let changed = 0;
  for (const rel of files) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    const book = JSON.parse(fs.readFileSync(p, 'utf8'));
    const pages = Object.keys(book).map(Number).sort((a, b) => a - b);
    for (let i = 0; i < pages.length - 1; i++) {
      const cur = book[String(pages[i])];
      const nxt = book[String(pages[i + 1])];
      if (!Array.isArray(cur) || !Array.isArray(nxt) || !cur.length || !nxt.length) continue;
      const last = cur[cur.length - 1];
      const first = nxt[0];
      if (typeof last !== 'string' || typeof first !== 'string') continue;
      if (openQ(last) <= closeQ(last)) continue;
      if (!/^\s*“/.test(first)) continue;

      let cont = first.replace(/^\s*“\s*/, '').replace(/\s*”\s*$/, '').replace(/^\s*…\s*/, '').trim();
      if (!cont) continue;
      const frag = last.replace(/\s+$/, '');
      const merged = `${frag} ${cont}”`.replace(/\s+/g, ' ');
      if (dry && shown < show) {
        shown++;
        console.log(`  [${vol}] s.${pages[i]} son + s.${pages[i + 1]} ilk\n    ÖNCE : ${JSON.stringify(frag.slice(-70))} + ${JSON.stringify(first)}\n    SONRA: ${JSON.stringify(merged.slice(-110))}`);
      }
      cur[cur.length - 1] = merged;
      nxt.shift();
      changed++;
      if (dry) {
        cur[cur.length - 1] = last;
        nxt.unshift(first);
      }
    }
    if (changed && !dry) fs.writeFileSync(p, JSON.stringify(book, null, 2) + '\n');
  }
  if (changed) console.log(`Cilt ${vol}: ${changed} replik birleştirildi`);
}
console.log(`${dry ? '(deneme) ' : ''}bitti`);
