// Nadir kelime indeksiyle çapa eşleşmeleri: ref paragraf <-> benim paragraf
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const ref = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/ref_novzon.json'), 'utf8'));
const mine = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/paragraphs_final.json'), 'utf8'));

const norm = (s) => s.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const toks = (s) => norm(s).split(' ').filter((w) => w.length > 4);

const flat = [];
for (const p of Object.keys(mine).map(Number).sort((a, b) => a - b)) mine[p].forEach((t, i) => flat.push({ page: p, i, t, set: new Set(toks(t)) }));

const df = new Map();
for (const f of flat) for (const w of f.set) df.set(w, (df.get(w) || 0) + 1);
const rare = (w) => df.has(w) && df.get(w) <= 12;

const idx = new Map();
flat.forEach((f, k) => { for (const w of f.set) if (rare(w)) { if (!idx.has(w)) idx.set(w, []); idx.get(w).push(k); } });

const sim = (A, B) => { let h = 0; for (const w of A) if (B.has(w)) h++; return h / Math.max(1, Math.min(A.size, B.size)); };

const anchors = [];
ref.forEach((c) => {
  c.paras.forEach((t, j) => {
    const A = new Set(toks(t));
    const rareA = [...A].filter(rare);
    if (rareA.length < 3) return;
    const score = new Map();
    for (const w of rareA) for (const k of idx.get(w) || []) score.set(k, (score.get(k) || 0) + 1);
    let best = { s: 0, k: -1 };
    for (const [k, cnt] of score) {
      if (cnt < 2) continue;
      const s = sim(A, flat[k].set);
      if (s > best.s) best = { s, k };
    }
    if (best.s >= 0.45) anchors.push({ ch: c.n, j, k: best.k, page: flat[best.k].page, s: +best.s.toFixed(2), refLen: t.length, myLen: flat[best.k].t.length });
  });
});

anchors.sort((a, b) => a.k - b.k);
// monotonik olmayanları at
const mono = [];
for (const a of anchors) if (!mono.length || a.k >= mono[mono.length - 1].k) mono.push(a);
console.log('çapa:', anchors.length, '| monotonik:', mono.length);
const div = mono.filter((a) => a.s >= 0.45 && (a.myLen / a.refLen > 1.35 || a.refLen / a.myLen > 1.35));
console.log('uzunluk sapması olan:', div.length);
fs.writeFileSync(path.join(ROOT, 'data/nz_anchors.json'), JSON.stringify({ mono, div }, null, 1));
div.slice(0, 12).forEach((a) => console.log(` n${a.ch} p${a.page}.${a.i} s=${a.s} ref=${a.refLen} my=${a.myLen}`));
