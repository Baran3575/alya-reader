// Nesnel kusur listesi: üslup tercihleri değil, ölçülebilir hatalar.
// - dengesiz tırnak / parantez / süslü parantez
// - 45+ kelimelik cümle (okunaksız, bölünmeli)
// - yinelenen paragraf (aynı sayfa içinde / ardışık sayfada)
// - metne sadakat < 70 veya uzunluk oranı < 0.6 (içerik atlanmış)
// - İngilizce kalıntı, Kiril, Japonca köşe tırnak, düz tırnak
// node scripts/qc/clean.js [--vol 4] [--md]
const fs = require('fs');
const path = require('path');
const { analyze, PAIRS } = require('./fidelity.js');

const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const only = args.includes('--vol') ? args[args.indexOf('--vol') + 1] : null;
const md = args.includes('--md');
const { range } = require('./chapters.js');
const chArg = args.includes('--bolum') ? args[args.indexOf('--bolum') + 1] : args.includes('--chapter') ? args[args.indexOf('--chapter') + 1] : null;

function pageText(arr) {
  return arr.filter((t) => !String(t).startsWith('ÇN:')).join('\n');
}
function words(t) {
  return t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
}
function sentences(t) {
  return t.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
}
function depth(s, a, b) {
  let d = 0;
  for (const ch of s) {
    if (ch === a) d++;
    else if (ch === b) d--;
  }
  return d;
}

const REPORT = [];
let totalDefects = 0;

for (const vol of Object.keys(PAIRS)) {
  if (only && vol !== only) continue;
  const bookPath = path.join(ROOT, PAIRS[vol][1]);
  if (!fs.existsSync(bookPath)) continue;
  const book = JSON.parse(fs.readFileSync(bookPath, 'utf8'));
  const defects = [];
  const pages = Object.keys(book).map(Number).sort((a, b) => a - b);
  const seen = new Map();

  const cr = chArg ? range(vol, chArg) : null;
  for (const p of pages) {
    if (cr && (p < cr.from || p > cr.to)) continue;
    const arr = book[String(p)];
    if (!Array.isArray(arr)) continue;
    arr.forEach((raw, i) => {
      if (typeof raw !== 'string') return;
      if (raw.startsWith('ÇN:')) return;
      const t = raw;
      const quoteOpen = (t.match(/“/g) || []).length;
      const quoteClose = (t.match(/”/g) || []).length;
      if (quoteOpen !== quoteClose) defects.push({ p, i, kind: 'dengesiz tırnak', text: t.slice(0, 90) });
      if (depth(t, '(', ')') !== 0) defects.push({ p, i, kind: 'dengesiz parantez', text: t.slice(0, 90) });
      if (depth(t, '{', '}') !== 0) defects.push({ p, i, kind: 'dengesiz süslü parantez', text: t.slice(0, 90) });
      if (depth(t, '[', ']') !== 0) defects.push({ p, i, kind: 'dengesiz köşeli parantez', text: t.slice(0, 90) });
      const EN = /(?<![A-Za-zÇĞİÖŞÜçğıöşü])(the|and|with|that|you|from|about|because|something|really)(?![A-Za-zÇĞİÖŞÜçğıöşü])/u;
      const enHit = t.match(EN);
      if (enHit) {
        const at = enHit.index;
        const ctx = t.slice(Math.max(0, at - 30), at + enHit[0].length + 30);
        defects.push({ p, i, kind: 'İngilizce kalıntı', text: ctx });
      }
      if (/[\u0400-\u04FF]/.test(t)) defects.push({ p, i, kind: 'Kiril', text: t.slice(0, 90) });
      if (/[『』「」]/.test(t)) defects.push({ p, i, kind: 'Japonca köşe tırnak', text: t.slice(0, 90) });
      if (/\b(birşey|herşey|hiçbirşey|yanlız|herkez)\b/.test(t))
        defects.push({ p, i, kind: 'birleşik/yanlış yazım', text: t.slice(0, 90) });
      for (const s of sentences(t)) {
        const n = words(s).length;
        if (n > 45) defects.push({ p, i, kind: `uzun cümle (${n})`, text: s.slice(0, 110) });
      }
      const key = t.trim();
      if (key.length > 40) {
        if (seen.has(key)) defects.push({ p, i, kind: `yinelenen paragraf (s.${seen.get(key)})`, text: t.slice(0, 90) });
        else seen.set(key, p);
      }
    });
  }

  // sadakat ve uzunluk
  const fid = analyze(vol);
  if (fid) {
    for (const row of fid.rows) {
      if (row.score < 70) defects.push({ p: row.page, i: -1, kind: `sadakat ${row.score}`, text: (row.notes || []).join(' ') });
      if (row.ratio && row.ratio < 0.5) defects.push({ p: row.page, i: -1, kind: `kısa sayfa x${row.ratio.toFixed(2)}`, text: '' });
    }
  }

  const byKind = {};
  for (const d of defects) byKind[d.kind.replace(/\(\d+\)/, '')] = (byKind[d.kind.replace(/\(\d+\)/, '')] || 0) + 1;
  totalDefects += defects.length;
  REPORT.push({ vol, defects, byKind });
}

const lines = [];
for (const r of REPORT) {
  lines.push(`Cilt ${r.vol}: ${r.defects.length} nesnel kusur`);
  const kinds = Object.entries(r.byKind).sort((a, b) => b[1] - a[1]);
  for (const [k, n] of kinds) lines.push(`   ${k}: ${n}`);
}

if (md) {
  const out = ['# Nesnel Kusur Listesi', '', `Toplam: ${totalDefects}`, ''];
  for (const r of REPORT) {
    out.push(`## Cilt ${r.vol} (${r.defects.length})`, '');
    out.push('| Sayfa | # | Kusur | Metin |', '| ---: | ---: | --- | --- |');
    for (const d of r.defects.sort((a, b) => a.p - b.p).slice(0, 200)) {
      out.push(`| ${d.p} | ${d.i} | ${d.kind} | ${String(d.text).replace(/\|/g, '\\|').slice(0, 100)} |`);
    }
    out.push('');
  }
  fs.writeFileSync(path.join(ROOT, 'docs/clean-list.md'), out.join('\n'));
  console.log('yazıldı: docs/clean-list.md');
}

console.log(lines.join('\n'));
console.log(`\nTOPLAM NESNEL KUSUR: ${totalDefects}`);
