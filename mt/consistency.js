// Terim tutarlılığı: eğitilen öbek tablosundan aynı İngilizce öbeğin Türkçe
// varyantlarını çıkarır ve metinde azınlıkta kalan varyantı çoğunluk yazımına çeker.
// (Bu roman için öğrenilmiş sözlük — genel MT motorları bunu garanti etmez.)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const model = JSON.parse(fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8'));
const dry = process.argv.includes('--dry');

function lev(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const pairs = [];
for (const [en, list] of Object.entries(model.phrases)) {
  const variants = list.filter(([, c]) => c >= 3);
  if (variants.length < 2) continue;
  const [topTr, topC] = variants[0];
  for (const [tr, c] of variants.slice(1)) {
    if (tr === topTr) continue;
    if (topC < c * 3) continue;
    const wt = topTr.split(' ');
    const wv = tr.split(' ');
    if (wv.length < 2 && wt.length < 2) continue;
    if (Math.abs(wt.length - wv.length) > 1) continue;
    const d = lev(topTr, tr);
    if (d > Math.max(3, Math.round(tr.length * 0.25))) continue;
    pairs.push({ en, from: tr, to: topTr, c, topC });
  }
}
pairs.sort((a, b) => b.c - a.c);
console.log('öğrenilen varyant çifti:', pairs.length);
for (const p of pairs.slice(0, 15)) console.log(`  "${p.from}" -> "${p.to}"  (${p.en}; ${p.c} vs ${p.topC})`);

if (dry) process.exit(0);

const file = path.join(ROOT, 'data/paragraphs_final.json');
const fin = JSON.parse(fs.readFileSync(file, 'utf8'));
let changed = 0;
const samples = [];
for (const [pg, arr] of Object.entries(fin)) {
  arr.forEach((t, i) => {
    let out = t;
    for (const p of pairs) {
      const re = new RegExp('(?<![\\p{L}\\p{N}])' + p.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'giu');
      if (re.test(out)) {
        out = out.replace(re, (m) => (m[0] === m[0].toLocaleUpperCase('tr') ? p.to.charAt(0).toLocaleUpperCase('tr') + p.to.slice(1) : p.to));
        if (samples.length < 6) samples.push([pg, i, p.from, p.to]);
      }
    }
    if (out !== t) {
      changed++;
      fin[pg][i] = out;
    }
  });
}
fs.writeFileSync(file, JSON.stringify(fin));
console.log('tutarlılık düzeltmesi:', changed, 'paragraf');
for (const [pg, i, a, b] of samples) console.log(`  s${pg}.${i}: "${a}" -> "${b}"`);
