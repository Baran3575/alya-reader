// Sayfa bazlı Türkçe kalite puanı: en sorunlu sayfaları bölüm bölüm listeler.
// node scripts/qc/badpages.js --vol 4 [--chapter 6] [--top 8]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BOOKS = {
  '4': 'data/paragraphs_final.json',
  '4.5': 'data45/paragraphs_final.json',
  '5': 'data5/paragraphs_final.json',
  '6': 'data6/paragraphs_final.json',
  '7': 'data7/paragraphs_final.json',
  '8': 'data8/paragraphs_final.json',
  '9': 'data9/paragraphs_final.json',
  '9.5': 'data95/paragraphs_final.json',
  '10': 'data10/paragraphs_final.json',
  '11': 'data11/paragraphs_final.json',
  '12': 'data12/paragraphs_final.json',
};

const args = process.argv.slice(2);
const vol = args.includes('--vol') ? args[args.indexOf('--vol') + 1] : '4';
const only = args.includes('--chapter') ? Number(args[args.indexOf('--chapter') + 1]) : null;
const top = args.includes('--top') ? Number(args[args.indexOf('--top') + 1]) : 8;

const book = JSON.parse(fs.readFileSync(path.join(ROOT, BOOKS[vol]), 'utf8'));
const metaPath = path.join(ROOT, `public/books/v${vol}.json`);
const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
const chapters = meta.chapters || [];

const WEIGHTS = [
  [/\b(senin|benim|onun)\b/gu, 2],
  [/\btarafından\b/gu, 3],
  [/\bolduğunu\b/gu, 1],
  [/(?:^|[.!?…]\s+)Ve\s/gu, 3],
  [/(?:^|[.!?…]\s+)Ama\s/gu, 1],
  [/\bbir şey\b/gu, 1],
  [/\bşey\b/gu, 1],
  [/\bgerçekten\b/gu, 1],
  [/\bsadece\b/gu, 1],
  [/--/gu, 2],
  [/\.\.\./gu, 2],
  [/[ \t]{2,}/gu, 3],
  [/\s+[,.!?;:]/gu, 3],
];

function pageScore(paras) {
  let score = 0;
  const marks = [];
  for (const t of paras) {
    const s = String(t);
    if (s.startsWith('ÇN:')) continue;
    for (const [re, w] of WEIGHTS) {
      re.lastIndex = 0;
      const m = s.match(re);
      if (m) {
        score += m.length * w;
        marks.push(`${re.source.slice(0, 18)}x${m.length}`);
      }
    }
    const sents = s.split(/(?<=[.!?…])\s+/).filter(Boolean);
    const words = s.split(/\s+/).filter(Boolean).length;
    if (sents.length >= 4 && words > 60) {
      score += sents.length;
      marks.push(`uzun-paragraf(${sents.length}c/${words}k)`);
    }
    if (words > 0 && words / sents.length > 32) {
      score += 3;
      marks.push('ort-cumle>32');
    }
    const open = (s.match(/“/g) || []).length;
    const close = (s.match(/”/g) || []).length;
    if (open !== close) { score += 4; marks.push('tırnak'); }
  }
  return { score, marks: marks.slice(0, 8) };
}

const rows = [];
for (const p of Object.keys(book).map(Number).sort((a, b) => a - b)) {
  const entry = book[p];
  const paras = Array.isArray(entry) ? entry : entry.p || entry.paragraphs;
  if (!Array.isArray(paras)) continue;
  let ch = 0;
  chapters.forEach((c, i) => { if (p >= (c.page ?? 0)) ch = i; });
  if (only !== null && ch !== only) continue;
  const { score, marks } = pageScore(paras);
  rows.push({ p, ch, score, marks, words: paras.join(' ').split(/\s+/).length });
}

const byCh = new Map();
for (const r of rows) {
  if (!byCh.has(r.ch)) byCh.set(r.ch, []);
  byCh.get(r.ch).push(r);
}

for (const [ch, list] of [...byCh.entries()].sort((a, b) => a[0] - b[0])) {
  const c = chapters[ch];
  const label = c ? `${c.label}: ${c.title}` : `Bölüm ${ch}`;
  const sorted = list.sort((a, b) => b.score - a.score).slice(0, top);
  const avg = (list.reduce((s, r) => s + r.score, 0) / Math.max(1, list.length)).toFixed(1);
  console.log(`\n[${ch}] ${label}  (sayfa:${list.length} ort.puan:${avg})`);
  for (const r of sorted) {
    console.log(`   s.${String(r.p).padEnd(4)} puan:${String(r.score).padStart(3)}  ${r.marks.join(' ')}`);
  }
}
