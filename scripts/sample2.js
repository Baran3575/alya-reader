// İkinci örnek: diyalog ağırlıklı paragraflar (akıcılık kontrolü)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const b = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/bilingual.json'), 'utf8'));
const f = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/paragraphs_final.json'), 'utf8'));
const pages = [24, 58, 97, 111, 128, 144, 163, 181, 208, 228, 248, 266];
const out = [];
for (const pg of pages) {
  const arr = f[String(pg)] || [];
  const idx = arr.findIndex((t) => t.startsWith('"') && t.length > 40);
  if (idx >= 0) out.push(`[s${pg}.${idx}]\n${arr[idx]}\n`);
}
fs.writeFileSync(path.join(ROOT, 'data/sample2.txt'), out.join('\n'));
console.log(out.length, 'diyalog örneği');
