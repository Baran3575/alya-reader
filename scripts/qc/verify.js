// 5 geçişin sonucunu ölçer
const fs = require('fs');
const path = require('path');
const FILE = process.env.ALYA_TR_FILE
  ? path.resolve(process.env.ALYA_TR_FILE)
  : path.join(__dirname, '..', '..', 'data', 'paragraphs_final.json');
const f = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const paras = [];
for (const [p, arr] of Object.entries(f)) arr.forEach((t, i) => paras.push({ p, i, t }));

const count = (re) => paras.reduce((a, x) => a + (x.t.match(re) || []).length, 0);
const rows = [];
const row = (label, n, note = '') => rows.push([label, n, note]);

row('1. noktalama', count(/\.{2,}/g), 'çift nokta');
row('  ', count(/\s+[,.;:!?]/g), 'noktalama öncesi boşluk');
row('  ', count(/[!?]\./g), '"?." kalıbı');
let unbalQ = 0;
let unbalP = 0;
for (const x of paras) {
  if ((x.t.match(/[“”]/g) || []).length % 2) unbalQ++;
  if ((x.t.match(/\(/g) || []).length !== (x.t.match(/\)/g) || []).length) unbalP++;
}
row('  ', unbalQ, 'tek sayıda tırnak (sayfa bölünmesi olabilir)');
row('  ', unbalP, 'dengesiz parantez');

row('2. doğal ifade', count(/\bAncak\b/g), '"Ancak"');
row('  ', count(/\bAyrıca\b/g), '"Ayrıca"');
row('  ', count(/\bsöz konusu\b/g), '"söz konusu"');
row('  ', count(/\bdiye söyledi\b/g), '"diye söyledi"');

row('3. tekrar', count(/\bardından\b/gi), '"ardından"');
row('  ', count(/\bbir şekilde\b/gi), '"bir şekilde"');
let worst = 0;
let worstWord = '';
for (const x of paras) {
  const ws = (x.t.toLocaleLowerCase('tr').match(/[\p{L}]{4,}/gu) || []);
  const m = new Map();
  for (const w of ws) m.set(w, (m.get(w) || 0) + 1);
  for (const [w, c] of m) if (c > worst) { worst = c; worstWord = w; }
}
row('  ', worst, 'tek paragrafta en çok yinelenen kelime: ' + worstWord);

row('4. fiil/zarf', count(/maktadır|mektedir/g), '"-maktadır"');
row('  ', count(/mıştır|miştir/g), '"-mıştır"');
row('  ', count(/\bdeğildir\b/g), '"değildir"');
row('  ', count(/\bolmuştur\b/g), '"olmuştur"');
row('  ', count(/\bbulunmaktadır\b/g), '"bulunmaktadır"');

row('5. gramer', count(/\b(herşey|birşey|herkez|yanlız|bir çok)\b/gi), 'bitişik/imla hatası');
row('  ', count(/\b([\p{L}]{3,})\s+\1\b/giu), 'ikiz kelime');

const w = 26;
for (const [label, n, note] of rows) console.log(String(n).padStart(6), (label + ' ' + note).padEnd(60));
console.log('\nparagraf:', paras.length, '| sayfa:', Object.keys(f).length);
