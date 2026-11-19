// Geri çeviri (EN) ile kaynak EN arasında paragraf/sayfa sadakat skoru
const fs = require('fs');
const path = require('path');
const { getVolume } = require('../volumes');
const ROOT = path.join(__dirname, '..', '..');
const vol = process.argv[2] || '4';
const cfg = getVolume(vol, ROOT);
if (!cfg) {
  console.error(`Bilinmeyen cilt: ${vol}`);
  process.exit(1);
}
const src = JSON.parse(fs.readFileSync(cfg.absSourceFile, 'utf8'));
const tr = JSON.parse(fs.readFileSync(cfg.absTrFile, 'utf8'));
const bt = JSON.parse(fs.readFileSync(cfg.absBackEnFile, 'utf8'));

const STOP = new Set(('a an the and or but if then than that this these those of to in on at for with from by as is are was were be been being have has had do does did not no nor so such it its he she they we you i me him her them us my your his their our what which who whom when where why how all any both each few more most other some own same too very can will just should now also into over under about after before between during through out up down again further once here there').split(' '));
const stem = (w) => w.replace(/(ing|ed|es|s|ly)$/, '').slice(0, 6);
const toks = (t) => new Set((t.toLowerCase().match(/[a-z']+/g) || []).filter((w) => w.length > 2 && !STOP.has(w)).map(stem));

const rows = [];
let lowPages = [];
for (const p of src) {
  const enText = (p.text || '').replace(/Page\s+\d+/gi, '');
  const enSet = toks(enText);
  const trs = tr[String(p.page)] || [];
  const bts = bt[String(p.page)] || [];
  if (!enText.trim() || !trs.length) continue;
  let covered = new Set();
  trs.forEach((t, i) => {
    const s = toks(bts[i] || '');
    let hit = 0;
    for (const w of s) if (enSet.has(w)) hit++;
    const prec = s.size ? hit / s.size : 0;
    for (const w of s) if (enSet.has(w)) covered.add(w);
    rows.push({ page: p.page, i, prec, extra: [...s].filter((w) => !enSet.has(w)).slice(0, 8), t });
  });
  const cov = enSet.size ? covered.size / enSet.size : 0;
  if (cov < 0.62) lowPages.push({ page: p.page, cov, words: enSet.size });
}
rows.sort((a, b) => a.prec - b.prec);
lowPages.sort((a, b) => a.cov - b.cov);

const out = [];
out.push(`GERİ ÇEVİRİ SADAKAT SKORU — Cilt ${vol}`);
out.push(`ölçülen paragraf: ${rows.length}`);
const avg = rows.reduce((a, r) => a + r.prec, 0) / rows.length;
out.push(`ortalama içerik örtüşmesi: ${(avg * 100).toFixed(1)}%`);
out.push(`düşük örtüşmeli paragraf (<%45): ${rows.filter((r) => r.prec < 0.45).length}`);
out.push(`\nEN içeriği en az kapsanan sayfalar (olası atlama/yanlış anlama): ${lowPages.length}`);
lowPages.slice(0, 15).forEach((p) => out.push(`  s${p.page}  kapsam ${(p.cov * 100).toFixed(0)}%  (EN ${p.words} içerik kelimesi)`));
out.push('\nEn düşük örtüşmeli 20 paragraf:');
rows.slice(0, 20).forEach((r) => {
  out.push(`\n  s${r.page}.${r.i}  örtüşme ${(r.prec * 100).toFixed(0)}%`);
  out.push('  BT: ' + (bt[String(r.page)]?.[r.i] || '').slice(0, 150));
  out.push('  TR: ' + r.t.slice(0, 150));
  if (r.extra.length) out.push('  kaynakta olmayan: ' + r.extra.join(', '));
});
const outRel = path.posix.join(cfg.dataDir, 'bt_score.txt');
fs.writeFileSync(path.join(ROOT, outRel), out.join('\n'));
console.log(out.slice(0, 12).join('\n'));
console.log('\nrapor: ' + outRel);
