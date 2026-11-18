// Kalite kontrolü için bölümlerden örnek paragraflar (EN + TR yan yana)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/source.json'), 'utf8'));
const fin = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/paragraphs_final.json'), 'utf8'));
const chs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/chapters.json'), 'utf8'));

function paragraphs(text) {
  const lines = text.split('\n').map((s) => s.trim()).filter((s) => s && !/(Goldenagato|mp4directs|jnovels|zerobooks)/i.test(s));
  const blocks = [];
  let cur = [];
  const endPunct = /[.!?"”’]$/;
  for (const ln of lines) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      if (endPunct.test(prev) && (ln.startsWith('"') || (prev.length < 48 && endPunct.test(prev)))) { blocks.push(cur.join(' ')); cur = []; }
    }
    cur.push(ln);
  }
  if (cur.length) blocks.push(cur.join(' '));
  const out = [];
  for (const b of blocks) {
    const clean = b.replace(/Page\s+\d+/gi, '').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    if (clean.length <= 520) { out.push(clean); continue; }
    const sents = clean.match(/[^.!?]+[.!?]+["”]?|\S[^.!?]*$/g) || [clean];
    let buf = '';
    for (const x of sents) {
      if ((buf + x).length > 480 && buf) { out.push(buf.trim()); buf = ''; }
      buf += x;
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

const starts = Object.keys(chs).map((k, i, arr) => i).map(() => 0);
const bounds = [1, 14, 20, 47, 72, 101, 121, 152, 172, 194, 217, 239, 271, 283];
const out = [];
for (let c = 0; c < bounds.length - 1; c++) {
  const from = bounds[c];
  const to = bounds[c + 1];
  const target = [0.25, 0.55, 0.85].map((f) => Math.round(from + (to - from - 1) * f));
  for (const pg of target) {
    const p = src.find((x) => x.page === pg);
    if (!p) continue;
    const en = paragraphs(p.text || '');
    const tr = fin[String(pg)] || [];
    // en uzun anlatı paragrafını seç
    let best = -1;
    let bestLen = 0;
    tr.forEach((t, i) => {
      if (/^"/.test(t)) return;
      if (t.length > bestLen) { bestLen = t.length; best = i; }
    });
    if (best < 0) best = 0;
    out.push({ page: pg, i: best, en: (en[best] || '').slice(0, 320), tr: (tr[best] || '').slice(0, 420) });
  }
}
const txt = out.map((x) => `[s${x.page}.${x.i}]\nEN: ${x.en}\nTR: ${x.tr}\n`).join('\n');
fs.writeFileSync(path.join(ROOT, 'data/sample.txt'), txt);
console.log(out.length, 'örnek yazıldı');
