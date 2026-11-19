// Dizgi normalizasyonu: tarama kaynaklı noktalama yığılmaları, tilde tekrarları,
// aşırı harf uzatmaları, kıvrık tırnak/kesme işaretleri, kopuk tırnak ekleri ve çift boşlukları tek tipleştirir.
// Kullanım: node scripts/norm_typo.js [dosya] [--dry]
const fs = require('fs');
const path = require('path');
const { DETACHED_QUOTE_SUFFIX_RE } = require('./qc/qc1_punctuation');

function curlyQuotesAndApostrophes(text) {
  let out = '';
  let openDouble = false;
  const chars = [...text];
  const letterOrDigit = /[\p{L}\p{N}]/u;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '“') {
      openDouble = true;
      out += ch;
      continue;
    }
    if (ch === '”') {
      openDouble = false;
      out += ch;
      continue;
    }
    if (ch === '"') {
      const prev = i > 0 ? chars[i - 1] : '';
      const next = i + 1 < chars.length ? chars[i + 1] : '';
      if (!prev || /[\s(\[{—–]/.test(prev)) {
        out += '“';
        openDouble = true;
      } else if (!next || /[\s,.;:!?…)\]}—–]/.test(next) || openDouble) {
        out += '”';
        openDouble = false;
      } else {
        out += openDouble ? '”' : '“';
        openDouble = !openDouble;
      }
      continue;
    }
    if (ch === "'") {
      const prev = i > 0 ? chars[i - 1] : '';
      const next = i + 1 < chars.length ? chars[i + 1] : '';
      if (letterOrDigit.test(prev) && letterOrDigit.test(next)) out += '’';
      else if (!prev || /[\s(“«(\[]/.test(prev)) out += '‘';
      else out += '’';
      continue;
    }
    out += ch;
  }
  return out;
}

const RULES = [
  // düz tırnak ve kesme işaretlerini kıvrık tipografiye çevir
  ['kıvrık tırnak/kesme', /["']/g, null],
  // kapanış tırnağından sonra kopmuş Türkçe ekleri birleştir
  ['kopuk tırnak eki', DETACHED_QUOTE_SUFFIX_RE, '$1'],
  // ünlem/soru yığılması: en fazla üç işaret
  ['noktalama yığılması', /([!?])\1{3,}/g, (m, c) => c.repeat(3)],
  ['karışık noktalama', /[!?]{4,}/g, (m) => (m.includes('!') ? '!!!' : '???')],
  // tilde / dalga tekrarı
  ['tilde tekrarı', /~{2,}/g, '~'],
  ['uzun çizgi tekrarı', /—{3,}/g, '——'],
  // üç nokta: ASCII üç noktayı tek karaktere çevir, en fazla iki karakter (……)
  ['üç nokta dönüşümü', /\.{3,}/g, '…'],
  ['üç nokta yığılması', /…{3,}/g, '……'],
  // harf uzatma: aynı harf 5+ kez -> 4
  ['harf uzatma', /(\p{L})\1{4,}/gu, (m, c) => c.repeat(4)],
  // çift boşluk
  ['çift boşluk', / {2,}/g, ' '],
  // noktalama öncesi boşluk
  ['noktalama öncesi boşluk', / +([,.;:!?])/g, '$1'],
];

function normalizeText(text, hits = null) {
  let t = text;
  for (const [name, re, rep] of RULES) {
    const before = t;
    if (name === 'kıvrık tırnak/kesme') {
      if (re.test(t)) t = curlyQuotesAndApostrophes(t);
    } else {
      t = t.replace(re, rep);
    }
    if (hits && t !== before) hits.set(name, (hits.get(name) || 0) + 1);
  }
  return t.trim();
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const file = args.find((a) => !a.startsWith('--')) || 'data/paragraphs_final.json';
  const abs = path.resolve(file);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));

  const hits = new Map();
  let changedParas = 0;
  for (const arr of Object.values(data)) {
    for (let i = 0; i < arr.length; i++) {
      const t = normalizeText(arr[i], hits);
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
}

module.exports = { RULES, curlyQuotesAndApostrophes, normalizeText };
