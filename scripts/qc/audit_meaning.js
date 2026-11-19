// Anlam denetimi: olumsuzluk ve sayı tutarlılığı (EN kaynak vs TR çeviri)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

const NEG_EN = /\b(not|n['’]t|no|never|none|nothing|nobody|cannot|hardly)\b/i;
const NEG_TR = /(?<!\p{L})(değil|yok|asla|hiç|hiçbir|kimse|olmaz|olmuyor|edemez|amaz|emez|madı|medi|madım|medim|madın|medin|madık|medik|madınız|mediniz|maz|mez|mıyor|miyor|muyor|müyor|madan|meden|sız|siz|suz|süz)(?!\p{L})/iu;
const NUM_RE = /\b\d+(?:[.,]\d+)?\b/g;

function extractNumbers(s) {
  return (String(s || '').match(NUM_RE) || []).map((n) => n.replace(',', '.'));
}

function auditMeaning(src, tr) {
  const rows = [];
  for (const p of src) {
    const k = String(p.page);
    const en = String(p.text || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const t = tr[k] || [];
    if (!en.length || !t.length) continue;
    if (en.length !== t.length) continue;
    for (let i = 0; i < en.length; i++) {
      const e = NEG_EN.test(en[i]);
      const m = NEG_TR.test(t[i]);
      if (e !== m && en[i].length > 40) {
        rows.push({ page: p.page, i, en: e, tr: m, t: t[i] });
      }
      const enNums = extractNumbers(en[i]);
      if (enNums.length > 0) {
        const trNums = extractNumbers(t[i]);
        const missing = enNums.filter((num) => !trNums.includes(num));
        if (missing.length > 0 && en[i].length > 20) {
          rows.push({ page: p.page, i, type: 'number', missing, t: t[i] });
        }
      }
    }
  }
  return rows;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const volIdx = args.indexOf('--volume');
  const vol = volIdx !== -1 ? args[volIdx + 1] : '4';
  const defaultSrc = vol === '4.5' ? 'data45/source.json' : 'data/source.json';
  const defaultTr = vol === '4.5' ? 'data45/paragraphs_final.json' : 'data/paragraphs_final.json';
  const srcPath = process.env.ALYA_SRC_FILE
    ? path.resolve(process.env.ALYA_SRC_FILE)
    : path.join(ROOT, defaultSrc);
  const trPath = process.env.ALYA_TR_FILE
    ? path.resolve(process.env.ALYA_TR_FILE)
    : path.join(ROOT, defaultTr);

  const src = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  const tr = JSON.parse(fs.readFileSync(trPath, 'utf8'));
  const rows = auditMeaning(src, tr);

  console.log('olumsuzluk/sayı uyuşmazlığı:', rows.length);
  rows.slice(0, 12).forEach((r) => console.log(` s${r.page}.${r.i} ${r.type === 'number' ? `missing=${r.missing.join(',')}` : `en=${r.en} tr=${r.tr}`} :: ${r.t.slice(0, 100)}`));
  if (args.includes('--write')) {
    const outFile = vol === '4.5' ? 'data45/audit_meaning.json' : 'data/audit_meaning.json';
    fs.writeFileSync(path.join(ROOT, outFile), JSON.stringify(rows, null, 1));
  }
}

module.exports = { auditMeaning, NEG_EN, NEG_TR, extractNumbers };
