// Referans metinle hizalama: her novzon bölümünü benim sayfalarımla eşleştir
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const ref = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/ref_novzon.json'), 'utf8'));
const mine = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/paragraphs_final.json'), 'utf8'));

const flat = [];
for (const p of Object.keys(mine).map(Number).sort((a, b) => a - b)) {
  mine[p].forEach((t, i) => flat.push({ page: p, i, t }));
}

const norm = (s) => s.toLocaleLowerCase('tr').replace(/[«»“”‘’"'`.,;:!?…\-–—()\[\]{}<>]/g, ' ')
  .replace(/\s+/g, ' ').trim();
const toks = (s) => norm(s).split(' ').filter((w) => w.length > 3);
const setOf = (s) => new Set(toks(s));

function sim(a, b) {
  const A = typeof a === 'string' ? setOf(a) : a;
  const B = typeof b === 'string' ? setOf(b) : b;
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}

// her bölümün ilk paragrafını en iyi eşleşen sayfa olarak bul
const bounds = [];
for (const c of ref) {
  const head = c.paras.slice(0, 2).join(' ');
  let best = null;
  for (let k = 0; k < flat.length; k++) {
    const s = sim(head, flat[k].t) * 0.7 + sim(head, flat.slice(k, k + 2).map((x) => x.t).join(' ')) * 0.3;
    if (!best || s > best.s) best = { s, k };
  }
  bounds.push({ n: c.n, title: c.title.replace(/^.*Bölüm /, 'Bölüm ').replace(/ Türkçe Oku$/, ''), start: flat[best.k].page, score: best.s });
}
bounds.forEach((b) => console.log(`n${b.n} ${b.score.toFixed(2)} p${b.start}  ${b.title.slice(0, 60)}`));

fs.writeFileSync(path.join(ROOT, 'data/nz_bounds.json'), JSON.stringify(bounds, null, 1));
