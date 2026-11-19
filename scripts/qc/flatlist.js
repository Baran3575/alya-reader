// Düz/MT kokan paragrafları puanlayıp listeler.
// node scripts/qc/flatlist.js <vol> [limit]
const fs = require('fs');
const V = { '4': 'data/paragraphs_final.json', '4.5': 'data45/paragraphs_final.json', '5': 'data5/paragraphs_final.json' };
const vol = process.argv[2] || '4';
const limit = Number(process.argv[3] || 40);
const book = JSON.parse(fs.readFileSync(V[vol], 'utf8'));

const CALQUES = [
  [/gibi görünüyordu/g, 2], [/oldukça/g, 1], [/bir şeyler/g, 1],
  [/söylemeye başladı|yapmaya başladı|etmeye başladı/g, 2],
  [/kendini .{0,15}buldu/g, 2], [/söz konusu/g, 1], [/bir tür/g, 1],
  [/Bundan sonra/g, 2], [/Bu sırada/g, 2], [/Ayrıca/g, 1], [/Ancak/g, 1],
  [/…/g, 1], [/—/g, 0],
];

const rows = [];
for (const [page, paras] of Object.entries(book)) {
  (paras || []).forEach((t, i) => {
    if (!t || t.length < 40) return;
    let score = 0;
    const words = t.split(/\s+/).length;
    if (words > 45) score += 4;
    else if (words > 32) score += 2;
    const bir = (t.match(/\bbir\b/g) || []).length;
    if (bir >= 4) score += 3;
    else if (bir >= 3) score += 1;
    for (const [re, w] of CALQUES) score += ((t.match(re) || []).length) * w;
    const dedi = (t.match(/\bdedi\b/g) || []).length;
    if (dedi >= 3) score += 2;
    if (score >= 6) rows.push({ page, i, score, words, t });
  });
}
rows.sort((a, b) => b.score - a.score);
console.log(`Cilt ${vol}: ${rows.length} aday (eşik 6)`);
for (const r of rows.slice(0, limit)) console.log(`s.${r.page}[${r.i}] puan ${r.score} · ${r.words} kelime`);
