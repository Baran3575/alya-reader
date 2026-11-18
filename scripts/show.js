// Sayfa aralığı için EN kaynak (satır kaydırma düzeltilmiş) + TR mevcut çeviri.
// Kullanım: node scripts/show.js 14 20 [--tr data/paragraphs_final.json] [--en data/source.json]
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const from = Number(args[0]);
const to = Number(args[1]);
const arg = (k, d) => {
  const i = args.indexOf(k);
  return i > -1 ? args[i + 1] : d;
};
const tr = JSON.parse(fs.readFileSync(path.resolve(arg('--tr', 'data/paragraphs_final.json')), 'utf8'));
const src = JSON.parse(fs.readFileSync(path.resolve(arg('--en', 'data/source.json')), 'utf8'));

const pageOf = (n) => src[n - 1] || src[String(n - 1)];
const unwrap = (t) =>
  t
    .replace(/-\n/g, '')
    .replace(/\n(?!\n)/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

for (let n = from; n <= to; n++) {
  const p = pageOf(n);
  const t = tr[String(n)] || tr[n] || [];
  if (!p && !t.length) continue;
  console.log('\n===== SAYFA ' + n + ' =====');
  if (p && p.text) console.log('EN: ' + unwrap(p.text));
  t.forEach((x, i) => console.log('TR[' + i + '] ' + x));
}
