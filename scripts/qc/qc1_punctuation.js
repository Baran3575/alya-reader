// 1. GEÇİŞ — noktalama ve dizgi
const { run } = require('./lib');
const { orientCurlyQuotes, reattachQuoteSuffixes } = require('./qc6_typography');

const PAIRS = [
  [/\s*([,.;:!?…])(?=\s|$)/g, '$1'],            // boşluk + noktalama
  [/([,;:!?])(?=[^\s"“”'’»)\]}…!?])/g, '$1 '],    // noktalama + boşluksuz devam
  [/(?<!\d)\.(?=[^\s"“”'’»)\]}…!?0-9\d])/g, '. '], // cümle sonu nokta
  [/([!?])\s+([!?])/g, (m, a, b) => (a === b ? a : '?!')],
  [/\.{2,}/g, '…'],
  [/\u2026{2,}/g, '…'],
  [/([.!?…])(["”»)\]])\./g, '$1$2'],  // tırnak/parantez sonrası fazla nokta
  [/([!?…])\./g, '$1'],               // "?." -> "?"
  [/\s*\.\s+\.\s*/g, '… '],          // ". ." -> "… "
  [/\s+\.(?=["”»)]|$)/g, ''],         // " ." (tırnak/parantez önü) -> ""
  [/(\d{1,2}):\s+(\d{2})\b/g, '$1.$2'],   // "8: 30" -> "8.30"
  [/\.{2}(?!\.)/g, '.'],
  [/ +/g, ' '],
  [/\s+$/g, ''],
  [/^\s+/g, ''],
];

function fixQuotes(t) {
  let out = t;
  // kaçak tırnak yığını: "" "" "Deniz bu!" "" "" " -> "Deniz bu!"
  out = out.replace(/^(?:["“”']\s*){2,}(?=[^\s"“”'])/u, '“').replace(/(?<=[^\s"“”'])(?:\s*["“”']){2,}$/u, '”');
  // sayfa bölünmesinden kalan baştaki kapanış parantezi / sondaki açılış parantezi
  out = out.replace(/^\)\s*/, '');
  out = out.replace(/\(\s*$/, '');
  // bağlamsal kıvrık tırnak yönlendirme ve ayrık ek birleştirme
  out = orientCurlyQuotes(out);
  // kapanış tırnaklarından sonra büyük harfle yeni cümle geliyorsa boşluk ekle (diyalog + anlatım)
  out = out.replace(/”([A-ZÇĞİÖŞÜ])/gu, '” $1');
  // açılış tırnağından sonra boşluk bırakma
  out = out.replace(/“\s+/g, '“');
  // kapanış tırnağından önceki boşluğu at
  out = out.replace(/\s+”/g, '”');
  // uzun çizgi aralıkları
  out = out.replace(/\s*—\s*(?=[\p{L}\p{N}“"«(])/gu, ' — ');
  out = out.replace(/(\p{L})\s*—(?=\s|$)/gu, '$1 —');
  // kesilen söz: "O zaman —" -> "O zaman—" (tırnak/satır sonu önünde boşluksuz)
  out = out.replace(/ —(?=[”"])/g, '—');
  out = reattachQuoteSuffixes(out);
  return out;
}

function cleanPunctuation(t) {
  let out = t;
  for (const [re, to] of PAIRS) out = out.replace(re, to);
  out = fixQuotes(out);
  out = out.replace(/ {2,}/g, ' ').trim();
  return out;
}

if (require.main === module) {
  run(cleanPunctuation, { label: '1) noktalama' });
}

module.exports = { cleanPunctuation, fixQuotes };
