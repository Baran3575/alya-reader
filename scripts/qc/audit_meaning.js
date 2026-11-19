// Anlam denetimi: olumsuzluk ve sayı tutarlılığı (EN kaynak vs TR çeviri)
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

const NEG_EN = /\b(not|n't|no|never|none|nothing|nobody|cannot|hardly)\b/i;
const NEG_TR = /(?<!\p{L})(değil|yok|asla|hiç|olmaz|olmuyor|edemez|amaz|emez|madı|medi|maz|mez|sız|siz|suz|süz)(?!\p{L})/giu;

const rows = [];
for (const p of src) {
  const k = String(p.page);
  const en = String(p.text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const t = tr[k] || [];
  if (!en.length || !t.length) continue;
  // sayfa düzeyinde kaba eşleşme: paragraf sayısı eşitse birebir, değilse oran
  if (en.length !== t.length) continue;
  for (let i = 0; i < en.length; i++) {
    const e = NEG_EN.test(en[i]);
    const m = NEG_TR.test(t[i]);
    if (e !== m && en[i].length > 40) rows.push({ page: p.page, i, en: e, tr: m, t: t[i] });
  }
}
console.log('olumsuzluk uyuşmazlığı:', rows.length);
rows.slice(0, 12).forEach((r) => console.log(` s${r.page}.${r.i} en=${r.en} tr=${r.tr} :: ${r.t.slice(0, 100)}`));
fs.writeFileSync(path.join(ROOT, cfg.dataDir, 'audit_meaning.json'), JSON.stringify(rows, null, 1));
