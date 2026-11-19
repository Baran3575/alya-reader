// Bir sayfanın EN kaynağını ve TR paragraflarını tam gösterir.
// node scripts/pg.js <vol> <from> <to>
const fs = require('fs');
const path = require('path');
const V = {
  '4': ['data/source.json', 'data/paragraphs_final.json'],
  '4.5': ['data45/source.json', 'data45/paragraphs_final.json'],
  '5': ['data5/source.json', 'data5/paragraphs_final.json'],
};
const [vol, from, to] = process.argv.slice(2);
const [srcF, trF] = V[vol];
const src = JSON.parse(fs.readFileSync(srcF, 'utf8'));
const tr = JSON.parse(fs.readFileSync(trF, 'utf8'));
const pageOf = (n) => src[n - 1] || src[String(n - 1)];
const unwrap = (t) => t.replace(/-\n/g, '').replace(/\n(?!\n)/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
for (let n = Number(from); n <= Number(to); n++) {
  const p = pageOf(n);
  const t = tr[String(n)] || [];
  console.log(`\n===== Cilt ${vol} · SAYFA ${n} =====`);
  if (p && p.text) console.log('EN: ' + unwrap(p.text));
  t.forEach((x, i) => console.log(`TR[${i}] ${x}`));
}
