// Dizgi normalizasyonu: tarama kaynaklı noktalama yığılmaları, tilde tekrarları,
// aşırı harf uzatmaları ve çift boşlukları tek tipleştirir.
// Kullanım: node scripts/norm_typo.js [dosya] [--dry]
const fs = require('fs');
const path = require('path');

const RULES = [
  ['tire yığılması', (t) => t.replace(/-+([!?]+)/g, '$1')],
  ['noktalama öncesi tilde', (t) => t.replace(/\s*~+\s*([!?….]+)/g, '$1')],
  ['diyalog sonu tilde', (t) => t.replace(/~+(?=[”"』)\]]|$)/g, '…')],
  ['cümle sınırı tilde', (t) => t.replace(/~+\s+(?=[A-ZÇĞİÖŞÜ])/gu, '… ')],
  ['genel tilde', (t) => t.replace(/~+\s*,/g, ',').replace(/~+\s*/g, ', ').replace(/,\s*,+/g, ',').replace(/,\s*([.!?…])/g, '$1')],
  ['karışık ünlem/soru', (t) => t.replace(/[!?]*\?[!?]*![!?]*/g, '?!').replace(/[!?]*![!?]*\?[!?]*/g, '?!')],
  ['ünlem tekrarı', (t) => t.replace(/!{2,}/g, '!')],
  ['soru işareti tekrarı', (t) => t.replace(/\?{2,}/g, '?')],
  ['nokta tekrarı', (t) => t.replace(/\.{2,}/g, '…').replace(/([!?…])\./g, '$1').replace(/([!?])\s+([!?])/g, (m, a, b) => (a === b ? a : '?!'))],
  ['harf uzatma', (t) => {
    let s = t;
    s = s.replace(/(?<!\p{L})[Ee]t{2,}o(?!\p{L})/gu, (w) => (w[0] === w[0].toUpperCase() ? 'Etto' : 'etto'));
    s = s.replace(/(?<!\p{L})[Hh]m{2,}(?!\p{L})/gu, (w) => (w[0] === w[0].toUpperCase() ? 'Hmm' : 'hmm'));
    return s.replace(/(?<!\p{L})([IVXLCDM]+)(?!\p{L})|(\p{L})\2{2,}/giu, (m, roman) => (roman ? roman : m[0]));
  }],
  ['noktalama öncesi boşluk', (t) => t.replace(/ +([,.;:!?…])/g, '$1')],
  ['çift boşluk', (t) => t.replace(/ {2,}/g, ' ')],
];

function normalizeTypography(text) {
  let s = text;
  for (const [, fn] of RULES) s = fn(s);
  return s.trim();
}

function processFile(file, dry = false) {
  const abs = path.resolve(file);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));

  const hits = new Map();
  let changedParas = 0;
  for (const arr of Object.values(data)) {
    for (let i = 0; i < arr.length; i++) {
      let t = arr[i];
      for (const [name, fn] of RULES) {
        const before = t;
        t = fn(t);
        if (t !== before) hits.set(name, (hits.get(name) || 0) + 1);
      }
      t = t.trim();
      if (t !== arr[i]) {
        arr[i] = t;
        changedParas++;
      }
    }
  }

  console.log(dry ? '(dry-run)' : 'uygulandı');
  console.log('değişen paragraf:', changedParas);
  for (const [k, v] of [...hits].sort((a, b) => b[1] - a[1])) console.log('  ', k.padEnd(24), v);

  if (!dry) {
    fs.writeFileSync(abs, JSON.stringify(data));
    console.log('yazıldı:', abs);
  }
  return { changedParas, hits };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const file = args.find((a) => !a.startsWith('--')) || 'data/paragraphs_final.json';
  processFile(file, dry);
}

module.exports = { normalizeTypography, RULES, processFile };
