// 6) tipografi: düz/ters tırnak -> bağlama göre “ ” , kesme -> ’ , iç alıntı -> ‘ ’ , ayrık ekleri birleştir
const { load, save } = require('./lib');

const DETACHED_QUOTE_SUFFIX_RE =
  /([”’])\s+(?:(nın|nin|nun|nün|ın|in|un|ün|yı|yi|yu|yü|nı|ni|nu|nü|ndan|nden|dan|den|tan|ten|ndaki|ndeki|daki|deki|nda|nde|ta|te|yla|yle|ları|leri|ların|lerin|lara|lere|lardan|lerden|lık|lik|luk|lük|a|e|ı|i|u|ü|na)(?!\p{L})|(ya|ye)(?!\p{L})(?!\s+da(?!\p{L})))/gu;

function reattachQuoteSuffixes(text) {
  return text.replace(DETACHED_QUOTE_SUFFIX_RE, (m, q, s1, s2) => q + (s1 || s2));
}

function orientCurlyQuotes(text) {
  let t = text;

  // 1) Japonca köşeli tırnak sonundaki kaçak çift tırnağı düzelt: 「... “ -> 「...」
  t = t.replace(/「([^「」\n]*?)\s*[“”"]/gu, '「$1」');

  // 2) İki cümle arasında bitişmiş kapanış+açılış tırnağını ayır: olurdu.“” Bu -> olurdu.” “Bu
  t = t.replace(/([.!?…])[“”"]{2}\s*(?=[\p{L}\p{N}])/gu, '$1” “');

  // 3) Koro/çoklu tırnak yığınlarını tek temiz çift tırnağa indirge: “”“ Affedersiniz.”” -> “Affedersiniz.”
  t = t.replace(/^(?:[“”"\u201e]\s*){2,}([^“”"\u201e\n]+?)(?:\s*[“”"\u201e]){2,}$/gu, (m, body) => '“' + body.trim() + '”');
  t = t.replace(/(^|\s)(?:[“”"\u201e]\s*){2,}([^“”"\u201e\n]+?)(?:\s*[“”"\u201e]){2,}(?=$|\s|[.,!?;:])/gu, (m, pre, body) => pre + '“' + body.trim() + '”');

  // 4) Tek tırnak / kesme işareti bağlamsal yönlendirme
  const chars = [...t];
  let step1 = '';
  const letterOrNum = /[\p{L}\p{N}]/u;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === "'") {
      const prev = chars[i - 1] || '';
      const next = chars[i + 1] || '';
      if (letterOrNum.test(prev) && letterOrNum.test(next)) step1 += '’';
      else if (!prev || /[\s(“«(\[{—–]/.test(prev)) step1 += '‘';
      else step1 += '’';
      continue;
    }
    step1 += ch;
  }

  // 5) Çift tırnakları (“ ” ") çevre bağlamına ve açık/kapalı durumuna göre yönlendir
  const arr = [...step1];
  let out = '';
  let isOpen = false;
  const isQuote = (c) => c === '"' || c === '“' || c === '”' || c === '\u201e';

  const hasClosingAhead = (fromIdx) => {
    for (let j = fromIdx + 1; j < arr.length; j++) {
      if (isQuote(arr[j])) return true;
    }
    return false;
  };

  for (let i = 0; i < arr.length; i++) {
    const ch = arr[i];
    if (!isQuote(ch)) {
      out += ch;
      continue;
    }

    const prev = out.length > 0 ? out[out.length - 1] : '';
    const next = i + 1 < arr.length ? arr[i + 1] : '';

    // Paragraf/parantez/boşluk sonrası açılış konumu
    if (!prev || /[\s(\[{—–]/.test(prev)) {
      if (!next) {
        out = out.replace(/\s+$/, '') + '”';
        isOpen = false;
      } else if (/\s/.test(next)) {
        if (!prev || /[(\[{—–]/.test(prev) || !isOpen) {
          out += '“';
          isOpen = true;
          while (i + 1 < arr.length && arr[i + 1] === ' ') i++;
        } else {
          out = out.replace(/\s+$/, '') + '”';
          isOpen = false;
        }
      } else {
        out += '“';
        isOpen = true;
      }
      continue;
    }

    // Satır sonu veya kapanış noktalama/parantez önü -> kesin kapanış tırnağı
    if (!next || /[,.;:!?…)\]}]/.test(next)) {
      out += '”';
      isOpen = false;
      continue;
    }

    // Solunda harf/noktalama, sağında boşluk var
    if (/\s/.test(next)) {
      if (isOpen) {
        out += '”';
        isOpen = false;
      } else if (/[\p{L}\p{N},;:]/u.test(prev) && hasClosingAhead(i)) {
        // Örn: Masachika da” Evet ... sahne“ -> Masachika da “Evet
        out += ' “';
        isOpen = true;
        while (i + 1 < arr.length && arr[i + 1] === ' ') i++;
      } else {
        // Önceki sayfadan devreden bölünmüş konuşmanın kapanışı (örn: var.”)
        out += '”';
        isOpen = false;
      }
      continue;
    }

    // Solunda da sağında da harf/rakam/işaret var (örn: “otaku hobileri”nin veya bir”komik“)
    if (isOpen) {
      out += '”';
      isOpen = false;
    } else {
      out += ' “';
      isOpen = true;
    }
  }

  const postSpaced = out.replace(/([,.;:!?…]”)([\p{L}])/gu, '$1 $2');
  return reattachQuoteSuffixes(postSpaced);
}

if (require.main === module) {
  const data = load();
  let changed = 0;
  for (const pg of Object.keys(data)) {
    data[pg] = data[pg].map((t) => {
      const next = orientCurlyQuotes(t);
      if (next !== t) changed++;
      return next;
    });
  }
  save(data);
  console.log(`6) tipografi: ${changed} paragraf bağlamsal tırnak/ek kurallarıyla düzeltildi`);
}

module.exports = { orientCurlyQuotes, reattachQuoteSuffixes, DETACHED_QUOTE_SUFFIX_RE };
