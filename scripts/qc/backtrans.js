// TR paragrafları İngilizceye geri çevirip (Google) kaynak EN ile karşılaştırmak için önbellek üretir
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const TR = process.argv[2] || path.join(ROOT, 'data', 'paragraphs_final.json');
const OUT = process.argv[3] || path.join(ROOT, 'data', 'back_en.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const SEP = '\n@@@\n';
const tr = JSON.parse(fs.readFileSync(TR, 'utf8'));
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};

const jobs = [];
for (const [p, arr] of Object.entries(tr)) {
  if (out[p]) continue;
  arr.forEach((t, i) => jobs.push({ p, i, t: t.slice(0, 900) }));
}
console.log('çevrilecek paragraf:', jobs.length);

const B = 5;
let done = 0;
async function run() {
  for (let k = 0; k < jobs.length; k += B) {
    const chunk = jobs.slice(k, k + B);
    const q = chunk.map((c) => c.t).join(SEP);
    const url = 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=tr&tl=en&q=' + encodeURIComponent(q);
    let text = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await fetch(url, { headers: { 'user-agent': UA } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        text = Array.isArray(j) ? j.join('') : String(j);
        break;
      } catch (e) {
        await new Promise((res) => setTimeout(res, 700 * (attempt + 1)));
      }
    }
    const parts = text.split(SEP);
    chunk.forEach((c, idx) => {
      if (!out[c.p]) out[c.p] = [];
      out[c.p][c.i] = (parts[idx] || '').trim();
    });
    done += chunk.length;
    if (k % 200 === 0) {
      fs.writeFileSync(OUT, JSON.stringify(out));
      console.log('  ', done + '/' + jobs.length);
    }
    await new Promise((res) => setTimeout(res, 120));
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('bitti');
}
run();
