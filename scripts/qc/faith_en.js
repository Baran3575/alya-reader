// Kaynağa sadakat denetimi: sayfa düzeyinde sayı/isim/dize tutarlılığı
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/source.json'), 'utf8'));
const tr = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/paragraphs_final.json'), 'utf8'));

const nums = (s) => (String(s).match(/\d+(?:[.,]\d+)?/g) || []);
const names = (s) => [...String(s).matchAll(/(?<!\p{L})(Masachika|Alisa|Yuki|Ayano|Maria|Chisaki|Touya|Sayaka|Nonoa|Sarashina|Kuze|Kujou|Suou|Alya|Masha)(?!\p{L})/gu)].map((m) => m[1]);

const rows = [];
for (const p of src) {
  const en = String(p.text || '').replace(/Goldenagato \| mp4directs\.com/g, ' ').replace(/Page \d+/g, ' ');
  const t = (tr[String(p.page)] || []).join(' ');
  if (!en.trim() || !t.trim()) continue;
  const missNums = nums(en).filter((n) => !t.includes(n));
  const enNames = new Set(names(en));
  const trNames = new Set(names(t));
  const missNames = [...enNames].filter((n) => !trNames.has(n));
  if (missNums.length || missNames.length) rows.push({ page: p.page, missNums, missNames, en: en.slice(0, 90), tr: t.slice(0, 90) });
}
console.log('uyuşmazlık olan sayfa:', rows.length);
rows.slice(0, 15).forEach((r) => console.log(` s${r.page} sayı:${JSON.stringify(r.missNums)} isim:${JSON.stringify(r.missNames)}`));
fs.writeFileSync(path.join(ROOT, 'data/faith_en.json'), JSON.stringify(rows, null, 1));
