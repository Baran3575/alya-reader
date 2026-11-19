// EN cümlelerini geri çeviriyle eşler; karşılığı zayıf EN cümlelerini (= olası atlama/yanlış anlama) listeler
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'volumes.json'), 'utf8'));
const vol = String(process.argv[2] || (manifest.find((v) => v.enabled) || manifest[0]).id);
const cfg = manifest.find((v) => String(v.id) === vol);
if (!cfg) throw new Error('Bilinmeyen cilt: ' + vol);
const src = JSON.parse(fs.readFileSync(path.join(ROOT, cfg.dataDir, 'source.json'), 'utf8'));
const bt = JSON.parse(fs.readFileSync(path.join(ROOT, cfg.dataDir, 'back_en.json'), 'utf8'));

const STOP = new Set(('a an the and or but if then than that this these those of to in on at for with from by as is are was were be been being have has had do does did not no nor so such it its he she they we you i me him her them us my your his their our what which who whom when where why how all any both each few more most other some own same too very can will just should now also into over under about after before between during through out up down again further once here there').split(' '));
const stem = (w) => w.replace(/(ing|ed|es|s|ly)$/, '').slice(0, 6);
const toks = (t) => new Set((t.toLowerCase().match(/[a-z']+/g) || []).filter((w) => w.length > 2 && !STOP.has(w)).map(stem));

const misses = [];
let total = 0, weak = 0;
for (const p of src) {
  const en = (p.text || '').replace(/Page\s+\d+/gi, '').replace(/(Goldenagato|mp4directs|jnovels|zerobooks)/gi, '');
  const bts = bt[String(p.page)] || [];
  const btSets = bts.map((b) => toks(b || ''));
  const sents = en.match(/[^.!?]+[.!?]+["”]?/g) || [];
  for (const s of sents) {
    const es = toks(s);
    if (es.size < 4) continue;
    total++;
    let best = 0;
    for (const b of btSets) {
      if (!b.size) continue;
      let hit = 0;
      for (const w of es) if (b.has(w)) hit++;
      const r = hit / es.size;
      if (r > best) best = r;
    }
    if (best < 0.34) {
      weak++;
      misses.push({ page: p.page, score: best, en: s.trim().slice(0, 170), tr: bts.join(' ').slice(0, 0) });
    }
  }
}
misses.sort((a, b) => a.page - b.page);
const out = [`CÜMLE EŞLEME — Cilt ${vol}`, `EN cümle: ${total} | karşılığı zayıf: ${weak} (%${((weak / total) * 100).toFixed(1)})`, ''];
for (const m of misses.slice(0, 80)) out.push(`s${m.page}  [${(m.score * 100).toFixed(0)}%] ${m.en}`);
fs.writeFileSync(path.join(ROOT, cfg.dataDir, 'sent_align.txt'), out.join('\n'));
console.log(out.slice(0, 3).join('\n'));
console.log(out.slice(3, 12).join('\n'));
