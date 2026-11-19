// Tüm ciltler için bölüm bazlı kalite defteri üretir: docs/quality-review.md
// node scripts/qc/ledger.js
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

const CHECKS = [
  ['bir şey', /\bbir şey\b/gu],
  ['şey', /\bşey(ler)?\b/gu],
  ['gerçekten', /\bgerçekten\b/gu],
  ['sadece', /\bsadece\b/gu],
  ['cümle başı Ama', /(?:^|[.!?…]\s+)Ama\s/gu],
  ['cümle başı Ve', /(?:^|[.!?…]\s+)Ve\s/gu],
  ['senin/benim/onun', /\b(senin|benim|onun)\b/gu],
  ['tarafından', /\btarafından\b/gu],
  ['olduğunu', /\bolduğunu\b/gu],
  ['çevirmen notu', /(?<!\p{L})ÇN\s*:/gu],
];

const lines = [
  '# Kalite İncelemesi — Bölüm Bazlı Defter',
  '',
  'Her bölüm için ölçülen göstergeler ve o bölümün en sorunlu sayfaları.',
  'Puan: metin kalitesi göstergelerinin ağırlıklı toplamı (düşük = daha temiz).',
  '',
  '| Cilt | Bölüm | Kelime | Ort. cümle | Not | En yüksek göstergeler | En sorunlu sayfalar |',
  '| --- | --- | ---: | ---: | ---: | --- | --- |',
];

function pageScore(paras) {
  let score = 0;
  for (const raw of paras) {
    const s = String(raw);
    if (s.startsWith('ÇN:')) continue;
    const sents = s.split(/(?<=[.!?…])\s+/).filter(Boolean);
    const words = s.split(/\s+/).filter(Boolean).length;
    const opens = (s.match(/“/g) || []).length;
    const closes = (s.match(/”/g) || []).length;
    if (opens !== closes) score += 4;
    if (sents.length >= 4 && words > 60) score += sents.length;
    if (words > 0 && words / Math.max(1, sents.length) > 32) score += 3;
    score += ((s.match(/\b(senin|benim|onun)\b/gu) || []).length) * 2;
    score += ((s.match(/\btarafından\b/gu) || []).length) * 3;
    score += (s.match(/(?:^|[.!?…]\s+)Ve\s/gu) || []).length * 3;
  }
  return score;
}

for (const [vol, rel] of Object.entries(BOOKS)) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue;
  const book = JSON.parse(fs.readFileSync(p, 'utf8'));
  const metaPath = path.join(ROOT, `public/books/v${vol}.json`);
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
  const chapters = meta.chapters || [];
  const pages = Object.keys(book).map(Number).sort((a, b) => a - b);

  const buckets = new Map();
  for (const pnum of pages) {
    const entry = book[pnum];
    const paras = Array.isArray(entry) ? entry : entry.p || entry.paragraphs;
    if (!Array.isArray(paras)) continue;
    let ch = 0;
    chapters.forEach((c, i) => { if (pnum >= (c.page ?? 0)) ch = i; });
    if (!buckets.has(ch)) buckets.set(ch, []);
    buckets.get(ch).push({ pnum, paras });
  }

  for (const [ch, list] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    const c = chapters[ch];
    const label = c ? `${c.label} — ${c.title}` : `Bölüm ${ch}`;
    const allParas = list.flatMap((x) => x.paras.map(String)).filter((t) => !t.startsWith('ÇN:'));
    const words = allParas.join(' ').split(/\s+/).filter(Boolean).length;
    const sents = allParas.reduce((s, t) => s + t.split(/(?<=[.!?…])\s+/).filter(Boolean).length, 0);
    const notes = list.flatMap((x) => x.paras.map(String)).filter((t) => t.startsWith('ÇN:')).length;
    const counts = CHECKS.map(([name, re]) => [name, (allParas.join(' ').match(re) || []).length]).filter(
      ([, n]) => n > 0
    );
    counts.sort((a, b) => b[1] - a[1]);
    const hot = counts.slice(0, 4).map(([n, v]) => `${n}: ${v}`).join(', ');
    const worst = list
      .map((x) => ({ pnum: x.pnum, score: pageScore(x.paras) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .filter((x) => x.score > 0)
      .map((x) => `s.${x.pnum}(${x.score})`)
      .join(', ');
    lines.push(
      `| ${vol} | ${label} | ${words} | ${(words / Math.max(1, sents)).toFixed(1)} | ${notes} | ${hot || '—'} | ${worst || '—'} |`
    );
  }
}

const out = path.join(ROOT, 'docs/quality-review.md');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log('yazıldı:', out, `(${lines.length - 7} satır)`);
