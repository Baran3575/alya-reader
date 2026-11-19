// Dizgi normalizasyonu: tarama kaynaklı noktalama yığılmaları, tilde tekrarları,
// aşırı harf uzatmaları, kıvrık tırnak/kesme işaretleri, kopuk tırnak ekleri ve çift boşlukları tek tipleştirir.
// Kullanım: node scripts/norm_typo.js [--volume <v>] [dosya] [--dry]
const fs = require('fs');
const path = require('path');
const { resolveVolume, parseVolumeArg } = require('./lib/volumes');
const { DETACHED_QUOTE_SUFFIX_RE } = require('./qc/qc1_punctuation');

const URL_MASK_RE =
  /(?:https?:\/\/|(?:www|discord)\.)\S+|(?<![\p{L}\p{N}])[a-z0-9-]+\.(?:com|org|net|me|gg|io|jp)(?:\/\S*)?(?![\p{L}\p{N}])/gu;

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
  // çift/üç nokta düzeltmeleri
  ['üç nokta dönüşümü', /\.{2,}/g, '…'],
  ['üç nokta artı nokta', /…\.+/g, '…'],
  // ünlem/soru sonrası kaçak nokta
  ['ünlem/soru nokta', /([!?])\.+/g, '$1'],
  // ünlem/soru yığılması: en fazla üç işaret
  ['noktalama yığılması', /([!?])\1{3,}/g, (m, c) => c.repeat(3)],
  ['karışık noktalama', /[!?]{4,}/g, (m) => (m.includes('!') ? '!!!' : '???')],
  // tilde / dalga tekrarı
  ['tilde tekrarı', /~{2,}/g, '~'],
  ['uzun çizgi tekrarı', /—{3,}/g, '——'],
  // üç nokta yığılması: en fazla iki karakter (……)
  ['üç nokta yığılması', /…{3,}/g, '……'],
  // harf uzatma: aynı harf 5+ kez -> 4
  ['harf uzatma', /(\p{L})\1{4,}/gu, (m, c) => c.repeat(4)],
  // çift boşluk
  ['çift boşluk', / {2,}/g, ' '],
  // noktalama öncesi boşluk
  ['noktalama öncesi boşluk', / +([,.;:!?])/g, '$1'],
];

function normalizeText(text, hits = null) {
  const urls = [];
  let t = String(text || '').replace(URL_MASK_RE, (m) => {
    urls.push(m);
    return `__URL_${urls.length - 1}__`;
  });
  for (const [name, re, rep] of RULES) {
    const before = t;
    if (name === 'kıvrık tırnak/kesme') {
      if (re.test(t)) t = curlyQuotesAndApostrophes(t);
    } else {
      t = t.replace(re, rep);
    }
    if (hits && t !== before) hits.set(name, (hits.get(name) || 0) + 1);
  }
  t = t.replace(/__URL_(\d+)__/g, (_, idx) => urls[Number(idx)]);
  return t.trim();
}

function resolveTargetFile(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--volume' || a === '--vol' || a === '-v') {
      i++;
      continue;
    }
    if (a.startsWith('--')) continue;
    return path.resolve(a);
  }
  const volKey = parseVolumeArg(args, '4');
  const vol = resolveVolume(volKey);
  if (!vol) {
    console.error(`Bilinmeyen cilt: ${volKey}`);
    process.exit(1);
  }
  return vol.finalFile;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const abs = resolveTargetFile(args);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));

  const hits = new Map();
  let changedParas = 0;
  for (const arr of Object.values(data)) {
    if (!Array.isArray(arr)) continue;
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

module.exports = { URL_MASK_RE, RULES, curlyQuotesAndApostrophes, normalizeText };
