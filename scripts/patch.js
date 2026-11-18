// Elle düzeltmeler: patches.json { "sayfa.index": "yeni metin" }
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const file = path.join(ROOT, 'data/paragraphs_final.json');
const fin = JSON.parse(fs.readFileSync(file, 'utf8'));
const patches = JSON.parse(fs.readFileSync(path.join(__dirname, 'patches.json'), 'utf8'));
let n = 0;
for (const [key, text] of Object.entries(patches)) {
  const [pg, idx] = key.split('.');
  if (!fin[pg] || fin[pg][Number(idx)] === undefined) { console.log('atlandı (yok):', key); continue; }
  fin[pg][Number(idx)] = text;
  n++;
}
fs.writeFileSync(file, JSON.stringify(fin));
console.log(n, 'yama uygulandı');
