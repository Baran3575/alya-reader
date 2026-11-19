// Bölüm bölüm kalite özeti: sayfa sayfa değil, bölüm bölüm ilerlemek için.
// node scripts/qc/chapter.js [--vol 4] [--md] [--next]
const fs = require('fs');
const path = require('path');
const { analyze } = require('./fidelity.js');

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
const VOLS = Object.keys(BOOKS);

const args = process.argv.slice(2);
const only = args.includes('--vol') ? args[args.indexOf('--vol') + 1] : null;
const md = args.includes('--md');
const nextMode = args.includes('--next');

const trWords = (arr) => String(arr.join(' ')).split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;

function chaptersOf(vol) {
  const p = path.join(ROOT, 'public', 'books', `v${vol}.json`);
  if (!fs.existsSync(p)) return null;
  const b = JSON.parse(fs.readFileSync(p, 'utf8'));
  const list = (b.chapters || []).slice().sort((a, b2) => a.page - b2.page);
  const total = Math.max(1, Number(b.total) || (list.length ? list[list.length - 1].page : 1));
  return list.map((c, i) => ({
    n: i,
    label: c.label || `Bölüm ${i}`,
    title: c.title || '',
    from: c.page,
    to: i + 1 < list.length ? list[i + 1].page - 1 : Number(b.total) || c.page,
  }));
}

const rows = [];
for (const vol of VOLS) {
  if (only && vol !== only) continue;
  const chs = chaptersOf(vol);
  if (!chs) continue;
  const an = analyze(vol);
  if (!an) continue;
  const tr = JSON.parse(fs.readFileSync(path.join(ROOT, BOOKS[vol]), 'utf8'));
  const byPage = new Map(an.rows.map((r) => [r.page, r]));
  for (const c of chs) {
    const pages = [];
    for (let p = c.from; p <= c.to; p++) {
      const r = byPage.get(p);
      if (r) pages.push(r);
    }
    if (!pages.length) continue;
    const scores = pages.map((r) => r.score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const min = Math.min(...scores);
    const low = scores.filter((s) => s < 70).length;
    let words = 0;
    let short = 0;
    for (let p = c.from; p <= c.to; p++) {
      const arr = tr[String(p)];
      if (!arr || !arr.length) continue;
      const w = trWords(arr);
      words += w;
      if (w < 40) short++;
    }
    rows.push({ vol, ch: c, avg, min, low, words, short, pages: pages.length, from: c.from, to: c.to });
  }
}

if (!rows.length) {
  console.log('Veri yok.');
  process.exit(1);
}

if (md) {
  const out = ['# Bölüm Bazlı Kalite', ''];
  for (const vol of VOLS) {
    const sub = rows.filter((r) => r.vol === vol);
    if (!sub.length) continue;
    out.push(`## Cilt ${vol}`, '');
    out.push('| Bölüm | Sayfa | Ort | Min | <70 | Kelime | Kısa sayfa |');
    out.push('|---|---|---|---|---|---|---|');
    for (const r of sub) {
      out.push(`| ${r.ch.label} — ${r.ch.title} | ${r.from}–${r.to} | ${r.avg.toFixed(1)} | ${r.min.toFixed(0)} | ${r.low} | ${r.words} | ${r.short} |`);
    }
    out.push('');
  }
  fs.writeFileSync(path.join(ROOT, 'docs/chapter-review.md'), out.join('\n'));
  console.log('yazıldı: docs/chapter-review.md');
}

if (nextMode) {
  const worst = rows
    .filter((r) => r.low > 0 || r.min < 70 || r.short > 0)
    .sort((a, b) => a.min - b.min)[0];
  if (!worst) {
    console.log('✓ Tüm bölümler eşik içinde');
    process.exit(0);
  }
  console.log(`Sıradaki bölüm: Cilt ${worst.vol} · ${worst.ch.label} — ${worst.ch.title} (s.${worst.from}–${worst.to})`);
  console.log(`  ort ${worst.avg.toFixed(1)} · min ${worst.min.toFixed(0)} · <70: ${worst.low} · kısa sayfa: ${worst.short}`);
  process.exit(0);
}

let cur = null;
for (const r of rows) {
  if (r.vol !== cur) {
    cur = r.vol;
    console.log(`\n== Cilt ${r.vol} ==`);
    console.log('  bölüm                          sayfa      ort   min  <70  kısa');
  }
  const name = `${r.ch.label} ${r.ch.title}`.slice(0, 30).padEnd(30);
  console.log(
    `  ${name} ${String(r.from + '–' + r.to).padStart(9)}  ${r.avg.toFixed(1).padStart(5)}  ${String(r.min.toFixed(0)).padStart(3)}  ${String(r.low).padStart(3)}  ${String(r.short).padStart(4)}`,
  );
}
const bad = rows.filter((r) => r.low > 0 || r.short > 0);
console.log(`\nBölüm: ${rows.length} · eşik dışı bölüm: ${bad.length}`);
