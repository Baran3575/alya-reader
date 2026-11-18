// 4.5: bölüm başlığını gövde metninden ayıkla (başlık UI'da gösteriliyor)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'data45/paragraphs_final.json');
const BIL = path.join(ROOT, 'data45/bilingual.json');

const f = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const bil = JSON.parse(fs.readFileSync(BIL, 'utf8'));
const titles = JSON.parse(fs.readFileSync(path.join(ROOT, 'data45/chapters.json'), 'utf8'));

const titleList = Object.values(titles).sort((a, b) => b.length - a.length);
let n = 0;
let restored = 0;

for (const [pg, arr] of Object.entries(f)) {
  if (!arr.length) continue;
  const before = arr[0];
  let after = before;
  for (const t of titleList) {
    const re = new RegExp('^\\s*Bölüm\\s+\\d+\\s*[-–—:]\\s*' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'u');
    if (re.test(after)) { after = after.replace(re, '').trim(); break; }
  }
  if (after === before) continue;
  // çok kısa kaldıysa kaynaktan yeniden al (aşırı kırpma olmasın)
  if (after.length < 25 && bil[pg] && bil[pg][0]) {
    const d = (bil[pg][0].d || bil[pg][0].g || '').trim();
    const idx = d.indexOf('Bölüm');
    after = idx >= 0 ? d.replace(/^\s*Bölüm\s+\d+\s*[-–—:][\s\S]*?\s(?=[“"'‘(\[])/u, '').trim() : d;
    restored++;
  }
  if (after) { f[pg][0] = after; n++; }
}
fs.writeFileSync(FILE, JSON.stringify(f));
console.log('başlık temizlenen sayfa:', n, '| yeniden alınan:', restored);
for (const p of ['9', '38', '63', '84', '327']) console.log(' s' + p + ':', (f[p] || [])[0].slice(0, 90));
