// 1. GEÇİŞ — noktalama ve dizgi
const { run } = require('./lib');

const PAIRS = [
  [/\s*([,.;:!?…])(?=\s|$)/g, '$1'],            // boşluk + noktalama
  [/([,;:!?])(?=[^\s"”'’»)\]}…!?])/g, '$1 '],     // noktalama + boşluksuz devam
  [/(?<!\d)\.(?=[^\s"”'’»)\]}…!?0-9\d])/g, '. '], // cümle sonu nokta
  [/([!?])\s+([!?])/g, (m, a, b) => (a === b ? a : '?!')],
  [/\.{2,}/g, '…'],
  [/\u2026{2,}/g, '…'],
  [/([.!?…])(["»)\]])\./g, '$1$2'],   // tırnak/parantez sonrası fazla nokta
  [/([!?…])\./g, '$1'],               // "?." -> "?"
  [/\s*\.\s+\.\s*/g, '… '],          // ". ." -> "… "
  [/\s+\.(?=["»)]|$)/g, ''],          // " ." (tırnak/parantez önü) -> ""
  [/(\d{1,2}):\s+(\d{2})\b/g, '$1.$2'],   // "8: 30" -> "8.30"
  [/\.{2}(?!\.)/g, '.'],
  [/ +/g, ' '],
  [/\s+$/g, ''],
  [/^\s+/g, ''],
];

function fixQuotes(t) {
  let out = t;
  // kaçak tırnak yığını: "" "" "Deniz bu!" "" "" " -> "Deniz bu!"
  out = out.replace(/^(?:["']\s+){2,}/, '').replace(/(?:\s+["']){2,}$/, '');
  // sayfa bölünmesinden kalan baştaki kapanış parantezi / sondaki açılış parantezi
  out = out.replace(/^\)\s*/, '');
  out = out.replace(/\(\s*$/, '');
  // kapanış tırnaklarından sonra harf geliyorsa boşluk ekle (diyalog + anlatım)
  out = out.replace(/"([A-ZÇĞİÖŞÜ])/g, (m, ch, off, s) => {
    // açılış tırnağı mı? (paragraf başı veya boşluk/noktalama sonrası ise açılıştır)
    const prev = off > 0 ? s[off - 1] : '';
    if (off === 0 || /[\s(\[{,;:—–]/.test(prev)) return m;
    return '" ' + ch;
  });
  // açılış tırnağından sonra boşluk bırakma
  out = out.replace(/(^|[\s(\[{,;:—–])"\s+/g, '$1"');
  // uzun çizgi aralıkları
  out = out.replace(/\s*—\s*(?=[\p{L}\p{N}"«(])/gu, ' — ');
  out = out.replace(/(\p{L})\s*—(?=\s|$)/gu, '$1 —');
  // kesilen söz: "O zaman —" -> "O zaman—" (tırnak/satır sonu önünde boşluksuz)
  out = out.replace(/ —(?=[”"])/g, '—');
  // kapanış tırnağından önceki boşluğu at
  let open = false;
  let buf = '';
  for (const ch of out) {
    if (ch === '"') {
      if (!open) { buf += ch; open = true; }
      else { buf = buf.replace(/\s+$/, '') + ch; open = false; }
      continue;
    }
    buf += ch;
  }
  out = buf;
  return out;
}

run((t) => {
  let out = t;
  for (const [re, to] of PAIRS) out = out.replace(re, to);
  out = fixQuotes(out);
  out = out.replace(/ {2,}/g, ' ').trim();
  // parantez dengesi bozuksa dokunma
  const open = (out.match(/\(/g) || []).length;
  const close = (out.match(/\)/g) || []).length;
  if (open !== close) return t;
  return out;
}, { label: '1) noktalama' });
