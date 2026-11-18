// EN kaynağı ile TR çevirisi arasında sayfa bazlı sadakat ölçümü
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const vol = process.argv[2] || '4';
const pick = (a, b) => (vol === '4' ? a : b);
const src = JSON.parse(fs.readFileSync(path.join(root, pick('data/source.json', 'data45/source.json')), 'utf8'));
const tr = JSON.parse(fs.readFileSync(path.join(root, pick('data/paragraphs_final.json', 'data45/paragraphs_final.json')), 'utf8'));

const NAMES = ['Masachika', 'Kuze', 'Alisa', 'Alya', 'Maria', 'Masha', 'Yuki', 'Ayano', 'Sayaka', 'Touya', 'Chisaki', 'Nonoa', 'Kinjou', 'Mimiko', 'Sarashina', 'Kenzaki', 'Suou'];
const words = (t) => (t.match(/[\p{L}\p{N}]+/gu) || []).length;
const sents = (t) => (t.match(/[.!?…]/g) || []).length;
const nums = (t) => (t.match(/\d+/g) || []).sort().join(',');
const quotes = (t) => (t.match(/[“”"]/g) || []).length / 2;

const rows = [];
for (const p of src) {
  const en = p.text || '';
  const t = (tr[String(p.page)] || []).join(' ');
  if (!en.trim()) continue;
  const wEn = words(en), wTr = words(t);
  const ratio = wEn ? wTr / wEn : 0;
  const missing = NAMES.filter((n) => (en.match(new RegExp('\\b' + n + '\\b', 'g')) || []).length > (t.match(new RegExp('\\b' + n + '\\b', 'g')) || []).length);
  const extra = NAMES.filter((n) => (t.match(new RegExp('\\b' + n + '\\b', 'g')) || []).length > (en.match(new RegExp('\\b' + n + '\\b', 'g')) || []).length);
  const numOk = nums(en) === nums(t);
  rows.push({ page: p.page, wEn, wTr, ratio, sEn: sents(en), sTr: sents(t), missing, extra, numOk, dq: Math.round(quotes(en)), dtq: Math.round(quotes(t)) });
}

const avg = rows.reduce((a, r) => a + r.ratio, 0) / rows.length;
const low = rows.filter((r) => r.ratio < 0.72).sort((a, b) => a.ratio - b.ratio);
const high = rows.filter((r) => r.ratio > 1.18).sort((a, b) => b.ratio - a.ratio);
const numBad = rows.filter((r) => !r.numOk);
const nameBad = rows.filter((r) => r.missing.length || r.extra.length);

const out = [];
out.push(`SADAKAT RAPORU — Cilt ${vol}`);
out.push(`sayfa: ${rows.length} | kelime EN ${rows.reduce((a, r) => a + r.wEn, 0)} / TR ${rows.reduce((a, r) => a + r.wTr, 0)} | ortalama TR/EN kelime oranı: ${(avg * 100).toFixed(1)}%`);
out.push(`cümle EN ${rows.reduce((a, r) => a + r.sEn, 0)} / TR ${rows.reduce((a, r) => a + r.sTr, 0)}`);
out.push(`\n[1] Kısa kalan sayfalar (<%72): ${low.length}`);
low.slice(0, 12).forEach((r) => out.push(`  s${String(r.page).padStart(3)}  ${(r.ratio * 100).toFixed(0)}%  EN ${r.wEn} → TR ${r.wTr}`));
out.push(`\n[2] Şişkin sayfalar (>%118): ${high.length}`);
high.slice(0, 8).forEach((r) => out.push(`  s${String(r.page).padStart(3)}  ${(r.ratio * 100).toFixed(0)}%  EN ${r.wEn} → TR ${r.wTr}`));
out.push(`\n[3] Sayı uyuşmayan sayfalar: ${numBad.length}`);
numBad.slice(0, 12).forEach((r) => out.push(`  s${r.page}`));
out.push(`\n[4] İsim sayısı uyuşmayan sayfalar: ${nameBad.length}`);
nameBad.slice(0, 15).forEach((r) => out.push(`  s${r.page}  eksik: ${r.missing.join(',') || '-'}  fazla: ${r.extra.join(',') || '-'}`));
out.push(`\n[5] Tırnak (diyalog) dengesi: EN ${rows.reduce((a, r) => a + r.dq, 0)} / TR ${rows.reduce((a, r) => a + r.dtq, 0)}`);

fs.writeFileSync(path.join(root, pick('data/fidelity_report.txt', 'data45/fidelity_report.txt')), out.join('\n'));
console.log(out.slice(0, 14).join('\n'));
