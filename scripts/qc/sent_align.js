// EN cümlelerini geri çeviriyle eşler; karşılığı zayıf EN cümlelerini (= olası atlama/yanlış anlama) listeler
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const STOP = new Set(
  (
    'a an the and or but if then than that this these those of to in on at for with from by as is are was were be been being have has had do does did not no nor so such it its he she they we you i me him her them us my your his their our what which who whom when where why how all any both each few more most other some own same too very can will just should now also into over under about after before between during through out up down again further once here there'
  ).split(' ')
);
const stem = (w) => w.replace(/(ing|ed|es|s|ly)$/, '').slice(0, 6);
const toks = (t) =>
  new Set(
    (String(t || '').toLowerCase().match(/[a-z']+/g) || [])
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map(stem)
  );

function runSentAlign(vol = '4', writeReport = false) {
  const v = String(vol || '4');
  const dir = v === '4' ? 'data' : 'data' + v.replace(/\./g, '');
  const srcPath = path.join(ROOT, dir, 'source.json');
  const btPath = path.join(ROOT, dir, 'back_en.json');

  if (!fs.existsSync(srcPath) || !fs.existsSync(btPath)) {
    return {
      skipped: true,
      reason: !fs.existsSync(btPath) ? `back_en.json bulunamadı (${dir}/back_en.json)` : `source.json bulunamadı (${dir}/source.json)`,
      misses: [],
      total: 0,
      weak: 0,
    };
  }

  const src = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  const bt = JSON.parse(fs.readFileSync(btPath, 'utf8'));

  const misses = [];
  let total = 0;
  let weak = 0;
  for (const p of src) {
    const en = (p.text || '')
      .replace(/Page\s+\d+/gi, '')
      .replace(/(Goldenagato|mp4directs|jnovels|zerobooks|glucosetl|discord\.gg|novelupdates|lightnovelreader)/gi, '');
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
        misses.push({ page: p.page, score: best, en: s.trim().slice(0, 170), tr: '' });
      }
    }
  }
  misses.sort((a, b) => a.page - b.page);
  const pct = total > 0 ? ((weak / total) * 100).toFixed(1) : '0.0';
  const out = [`CÜMLE EŞLEME — Cilt ${v}`, `EN cümle: ${total} | karşılığı zayıf: ${weak} (%${pct})`, ''];
  for (const m of misses.slice(0, 80)) out.push(`s${m.page}  [${(m.score * 100).toFixed(0)}%] ${m.en}`);

  if (writeReport) {
    fs.writeFileSync(path.join(ROOT, dir, 'sent_align.txt'), out.join('\n'));
  }
  return { skipped: false, misses, total, weak, out };
}

if (require.main === module) {
  const vol = process.argv[2] || '4';
  const res = runSentAlign(vol, true);
  if (res.skipped) {
    console.log(`CÜMLE EŞLEME — Cilt ${vol}: ${res.reason}, atlandı.`);
  } else {
    console.log(res.out.slice(0, 3).join('\n'));
    console.log(res.out.slice(3, 12).join('\n'));
  }
}

module.exports = { runSentAlign };
