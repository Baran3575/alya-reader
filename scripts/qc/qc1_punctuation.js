// 1. GEÇİŞ — noktalama ve dizgi
const { run } = require('./lib');

const PAIRS = [
  [/\s*([,.;:!?…])(?=\s|$)/g, '$1'],                 // boşluk + noktalama
  [/([,;:!?])(?=[^\s"“”'‘’»)\]}…!?])/g, '$1 '],       // noktalama + boşluksuz devam
  [/(?<!\d)\.(?=[^\s"“”'‘’»)\]}…!?0-9\d])/g, '. '],   // cümle sonu nokta
  [/([!?])\s+([!?])/g, (m, a, b) => (a === b ? a : '?!')],
  [/\.{2,}/g, '…'],
  [/\u2026{2,}/g, '…'],
  [/([.!?…])(["”»)\]])\./g, '$1$2'],                 // tırnak/parantez sonrası fazla nokta
  [/([!?…])\./g, '$1'],                              // "?." -> "?"
  [/\s*\.\s+\.\s*/g, '… '],                          // ". ." -> "… "
  [/\s+\.(?=["”»)]|$)/g, ''],                        // " ." (tırnak/parantez önü) -> ""
  [/(\d{1,2}):\s+(\d{2})\b/g, '$1.$2'],              // "8: 30" -> "8.30"
  [/\.{2}(?!\.)/g, '.'],
  [/ +/g, ' '],
  [/\s+$/g, ''],
  [/^\s+/g, ''],
];

// Kapanış tırnağından sonra boşlukla ayrılmış Türkçe çekim/iyelik eklerini bitişik yazar
// ("otaku hobileri" nin -> "otaku hobileri"nin, “o adam” a -> “o adam”a)
// Tek başına kelime olan bağlaç/soru sözcükleri (de, da, ne, ya, ve, o, ki, mi...) hariç tutulur.
const DETACHED_QUOTE_SUFFIX_RE =
  /([”"])\s+’?(?=(?:nin|nın|nun|nün|ın|in|un|ün|ndeki|ndaki|deki|daki|teki|taki|nden|ndan|den|dan|ten|tan|ni|nı|nu|nü|yi|yı|yu|yü|na|yla|yle|ları|leri|ların|lerin|lara|lere|larda|lerde|lardan|lerden|a|ı|i|u|ü)(?![\p{L}]))/gu;

function fixQuotes(t) {
  let out = t;
  // kaçak tırnak yığını: "" "" "Deniz bu!" "" "" " -> "Deniz bu!"
  out = out.replace(/^(?:["']\s+){2,}/, '').replace(/(?:\s+["']){2,}$/, '');
  // sayfa bölünmesinden kalan baştaki kapanış parantezi / sondaki açılış parantezi
  out = out.replace(/^\)\s*/, '');
  out = out.replace(/\(\s*$/, '');

  // Bitişik iki konuşma tırnağı: ." "Bu / .""Bu / .” “Bu / .”“Bu
  out = out.replace(/([.!?…])"([ \t]*)"(?=\S)/g, '$1" "');
  out = out.replace(/”([ \t]*)“/g, '” “');
  // Bozulmuş bitişik tırnak: .“” Kelime -> .” “Kelime
  out = out.replace(/([.!?…])“”\s*(?=[\p{L}…])/gu, '$1” “');

  // Kapanış tırnağından sonra büyük harfle anlatım başlıyorsa boşluk ekle (açılış tırnaklarına dokunma)
  out = out.replace(/([”"])([A-ZÇĞİÖŞÜ])/g, (m, q, ch, off, s) => {
    if (q === '“') return m;
    const prev = off > 0 ? s[off - 1] : '';
    if (off === 0 || /[\s(\[{,;:—–"“‘«]/.test(prev)) return m;
    return q + ' ' + ch;
  });

  // Açılış kıvrık tırnağından sonra ve kapanış kıvrık tırnağından önce boşluk bırakma
  out = out.replace(/“\s+/g, '“');
  out = out.replace(/\s+”/g, '”');

  // Düz tırnak çiftleri dengeliyse ve karışık tırnak yoksa açılış/kapanış iç boşluklarını temizle
  const straightCount = (out.match(/"/g) || []).length;
  const hasCurlyOrCjk = /[“”「」『』]/.test(out);
  if (straightCount > 0 && straightCount % 2 === 0 && !hasCurlyOrCjk) {
    let open = false;
    let buf = '';
    for (const ch of out) {
      if (ch === '"') {
        if (!open) {
          buf += ch;
          open = true;
        } else {
          buf = buf.replace(/[ \t]+$/, '') + ch;
          open = false;
        }
        continue;
      }
      if (open && buf.endsWith('"') && (ch === ' ' || ch === '\t')) {
        continue;
      }
      buf += ch;
    }
    out = buf;
  } else if (straightCount > 0) {
    out = out.replace(/(^|[\s(\[{,;:—–])"\s+/g, '$1"');
  }

  // Kapanış tırnağından sonra kopmuş Türkçe ekleri birleştir
  out = out.replace(DETACHED_QUOTE_SUFFIX_RE, '$1');

  // uzun çizgi aralıkları
  out = out.replace(/\s*—\s*(?=[\p{L}\p{N}"“«(])/gu, ' — ');
  out = out.replace(/(\p{L})\s*—(?=\s|$)/gu, '$1 —');
  // kesilen söz: "O zaman —" -> "O zaman—" (tırnak/satır sonu önünde boşluksuz)
  out = out.replace(/ —(?=[”"])/g, '—');

  return out;
}

const URL_MASK_RE =
  /(?:https?:\/\/|(?:www|discord)\.)\S+|(?<![\p{L}\p{N}])[a-z0-9-]+\.(?:com|org|net|me|gg|io|jp)(?:\/\S*)?(?![\p{L}\p{N}])/gu;

function fixPunctuation(t) {
  const urls = [];
  let out = t.replace(URL_MASK_RE, (m) => {
    urls.push(m);
    return `__URL_${urls.length - 1}__`;
  });
  for (const [re, to] of PAIRS) out = out.replace(re, to);
  out = fixQuotes(out);
  out = out.replace(/ {2,}/g, ' ').trim();
  out = out.replace(/__URL_(\d+)__/g, (_, idx) => urls[Number(idx)]);
  // parantez dengesi bozuksa dokunma
  const open = (out.match(/\(/g) || []).length;
  const close = (out.match(/\)/g) || []).length;
  if (open !== close) return t;
  return out;
}

if (require.main === module) {
  run(fixPunctuation, { label: '1) noktalama' });
}

module.exports = { PAIRS, DETACHED_QUOTE_SUFFIX_RE, fixQuotes, fixPunctuation };
